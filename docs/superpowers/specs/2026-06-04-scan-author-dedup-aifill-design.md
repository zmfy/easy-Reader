# 扫描作者提取 + 同书名作者软重复 + AI 填充作者校验与查看视图

**日期**：2026-06-04
**分支**：`scan_books_ai1`
**状态**：设计已确认，待写实现计划

## 背景与问题

1. **软重复漏判**：内容不同但同书的多个版本（如《黄金瞳(典当)》"精校版" vs "校对版"，同作者打眼）指纹不同，当前扫描只用指纹做硬去重，软重复算出后被丢弃，导致同书名+同作者的不同版本不被识别。
2. **AI 填充无校验、无可见性**：AI 凭书名从知识库查找，结果可能张冠李戴；填充进度只有计数，看不出哪些书填充成功/失败、填了什么。

## 目标

- 扫描入库即从文件名提取作者写入 `author` 字段。
- 基于"书名+作者"识别软重复；自动模式下与硬重复同样处理，审核模式下进审核批次。
- AI 填充用扫描得到的作者做 ground-truth 校验，区分"已填充/填充失败/未尝试"，并在书库提供筛选与角标查看。

## 非目标

- 不优化 AI 填充速度（并发、封面抓取保持现状）。
- 不改硬指纹去重逻辑。
- 不动 `soft_groups`（编辑距离/章节结构那套，留给将来 AI agent）。

---

## Part 1：扫描提取作者 + 同书名作者软重复

### 1.1 文件名提取作者

新增工具 `extractAuthorFromName(name: string): string | null`（置于 `src/utils/title-normalizer.ts`）：
- 去扩展名后，匹配 `作者[：:]\s*(.+?)\s*$`，返回 trim 后的作者名；无匹配返回 `null`。
- 例：`《黄金瞳(典当)》（精校版全本）作者：打眼` → `打眼`；`绿林七宗罪大史记` → `null`。

### 1.2 扫描写入 author

- `processFile`（`scan-walker.ts`）：算出 `title=basename` 后调用 `extractAuthorFromName`，把结果放入 `ScannedBookEx.author`。标题字段仍存原始文件名（不改）。
- `NewBookPayload` 增加 `author?: string`（types）。`toNewPayload` 透传 author。
- `upsertBookByPath`（`batch-applier.ts`）：
  - **INSERT** 时写入 `author`。
  - **UPDATE** 时**仅当现有 author 为空**才写入（`author = COALESCE(NULLIF(author,''), ?)` 语义），避免覆盖 AI 已填充或人工编辑过的作者。

### 1.3 软重复检测

`buildCandidateGroups`（`dedup-grouper.ts`）新增返回字段 `title_author_groups: ScannedBook[][]`：
- 分组键 = `lookupKey(title)` + `'::'` + `normalizeAuthor(author)`（`lookupKey` 从 `title-lookup.ts` 引入，剥离《》/注释/`作者：`后归一化；`normalizeAuthor` 见 2.4）。
- 仅纳入 author 非空的书；排除已在 hard 组的书（复用现有 `inHard`）。
- 条件：同键 ≥2 本 **且** ≥2 个不同 fingerprint（指纹相同的已是 hard 组）。
- 不改动 `soft_groups` 的现有三来源逻辑。

### 1.4 入库与分发

- `ScanResult` 增加 `soft_duplicate_groups: DuplicateGroupPayload[]`。
- scan-walker 把 `title_author_groups` 转成 `DuplicateGroupPayload`：`canonical_file_path` 由现有 `pickCanonical`（章节最多）给默认值，成员 `decision_type: 'soft'`（`DuplicateMemberPayload.decision_type` 类型扩为 `'hard' | 'ai' | 'soft'`）。
- `buildBatchFromScan` 把 `soft_duplicate_groups` 与 hard/ai 一并作为 `duplicate_group` 批次项写入；`summary_counts.duplicate_groups` 计入；`isEmpty` 也计入。
- **分发不分软硬**：自动模式 → 整批 `applyBatch` 自动应用（软重复同硬重复，自动定正本、其余标 duplicate 隐藏）；审核模式 → 整批 pending，前端复用现有 `DuplicateGroupCard.vue`（已支持选正本/剔除成员/拒绝整组），零前端改动。

### 1.5 应用逻辑

`batch-applier` 的 `duplicate_group` 处理本就通用（读 canonical_file_path + members + 可选 rejected_members），软重复无需新增分支。

---

## Part 2：AI 填充作者校验 + 状态 + 查看视图

### 2.1 数据库

`db.ts` 的 `booksAlters` 增加 `"ALTER TABLE books ADD COLUMN ai_fill_status TEXT"`：
- `'filled'`：AI 调用成功并接受结果。
- `'failed'`：AI 调用抛错，或 Pass B 作者不一致被拒。
- `NULL`：未尝试。

### 2.2 fillBookInfo 加 hint

- `AiPlugin.fillBookInfo` 签名加可选第三参 `hint?: { title?: string; author?: string }`（types 接口 + 6 个插件 deepseek/qwen/minmax/openai/claude/ollama）。
- prompt 拼接：有 `hint.title` 时加"书名：《{title}》"，有 `hint.author` 时加"作者：{author}"。**追加指令：若无法确认是这本书，`author` 与 `summary` 都留空，不要猜测。**
- `aiManager.fillBookInfo(rawText, db, hint)` 透传 hint。

### 2.3 填充编排（`ai-batch-fill.ts`，每本书）

已知量：`knownTitle = lookupKey(原始 title)`；`knownAuthor =` DB author（扫描已写）trim，空则 `extractAuthorFromName(title)`。

```
若 knownAuthor 非空：
  Pass A = fillBookInfo(rawText, {title: knownTitle, author: knownAuthor})
  found  = (Pass A.author 非空) 或 (Pass A.summary 非空)
  若 found → 采用 Pass A，status='filled'，author 保持 knownAuthor
  否则 → 进 Pass B
否则（knownAuthor 为空）：
  直接 Pass B

Pass B = fillBookInfo(rawText, {title: knownTitle})   // 仅书名
  aiAuthor = Pass B.author
  若 knownAuthor 为空 → 采用 Pass B（含 aiAuthor），status='filled'
  否则若 authorsMatch(aiAuthor, knownAuthor) → 采用 Pass B，status='filled'，author 保持 knownAuthor
  否则 → status='failed'，不写入任何字段
```

- 仅 `status='filled'` 时执行字段写入（沿用现有 `maybeSet` 的"非空+未人工编辑"保护；author 不被 AI 覆盖，始终保留 knownAuthor）。
- AI 调用抛错 → 进 `result.failed`，`status='failed'`。
- `ai_fill_status` 在成功/失败分支写入；`stampFillVersion` 仍在 finally（避免反复重试）。
- 封面抓取逻辑不变。

### 2.4 作者比对 `authorsMatch(a, b)`

新增工具（`src/utils/author-match.ts`，复用 `title-normalizer` 的 `levenshtein`）：
- `normalizeAuthor(s)`：全角→半角、去所有空白、去尾部"著/编著/着"、`toLowerCase`。
- 比对顺序：
  1. 任一方归一化后为空 → `false`。
  2. 完全相等 → `true`。
  3. 一方包含另一方（`na.includes(nb) || nb.includes(na)`）→ `true`。
  4. 模糊：`1 - levenshtein(na,nb)/max(len) >= 2/3` → `true`。
  5. 否则 `false`。

### 2.5 候选选择

`selectFillCandidates` 不变（缺 author 或 summary 且版本落后）。作者多数已由扫描写入，实际主要由"缺 summary"驱动。

### 2.6 路由与前端

- `/library` 增查询参 `ai_fill=filled|failed|none|all`（默认 all，admin）：`filled`/`failed` → `WHERE ai_fill_status = ?`；`none` → `WHERE ai_fill_status IS NULL`。返回的 book 带 `ai_fill_status`。
- `Library.vue`：顶部加"AI填充状态"筛选（已填充/填充失败/未尝试/全部，仅 admin）；书卡角标：已填充 ✅ / 失败 ⚠️。`Book` 类型加 `ai_fill_status`。
- 详情页沿用现有 author/简介/分类/标签/封面展示，便于核对效果。

---

## 测试策略

- **单元**：`extractAuthorFromName`（多种文件名/无作者）；`buildCandidateGroups.title_author_groups`（黄金瞳同作者不同指纹成组、不同作者不成组、指纹相同不重复计入、author 空跳过）；`authorsMatch`（相等/包含/2-3 模糊/不一致四类）；`ai-batch-fill` 的 Pass A→B 分支与 status 判定（mock fillBookInfo）。
- **回归**：现有 88+ 测试全绿；硬去重、编码检测不受影响。
- **集成/手测**：扫描后 author 入库；自动模式黄金瞳两版自动归并、审核模式进批次可选正本；AI 填充后 `ai_fill_status` 正确，书库筛选与角标可见。

## 风险

- LLM "找不到"判据（author+summary 皆空）依赖 prompt 遵从度，跨 6 家 provider 表现可能不一；模糊作者比对 2/3 阈值可能偶有误判，但仅影响 filled/failed 标记，不破坏数据（failed 不写字段）。
- `upsertBookByPath` 改 author 写入需谨慎不覆盖人工编辑值。
