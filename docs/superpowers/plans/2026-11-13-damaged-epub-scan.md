# 扫描时发现损坏 EPUB Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 扫描时真正打开 EPUB 做健康检查：打不开的单独成「文件损坏」审核批次，由管理员逐本选导入 / 跳过；能自动修正的照常导入并标记；已入库 EPUB 补查一次、状态变化直接写库；阅读损坏的书给出明确原因。

**Architecture:** 新模块 `services/epub-health.ts` 用阅读器的 `EpubParser`（含内存修正）打开文件并给出 `ok / repaired / damaged + reason`。`scan-walker.ts` 在处理 EPUB 时调用它，把结果分到新书（带 `repaired`）、`damaged` 审核项或直接写库。批次构建把 `damaged` 项单独成批；应用时按逐项决定入库或写跳过记录。

**Tech Stack:** Node.js + Express + TypeScript + better-sqlite3 + jest + adm-zip；Vue 3 + Element Plus + vitest。

**Spec:** `docs/superpowers/specs/2026-11-13-damaged-epub-scan-design.md`

## Global Constraints

- 分支 `feature/damaged-epub`（从 `main` 开），完成后合并进 `main` 再合并进 `study`（由主控做，不推送）。提交信息结尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 只检查 EPUB（扩展名 `epub`，不区分大小写）；不改 TXT / PDF / UMD 的扫描行为；不改全局 `FINGERPRINT_VERSION` 与指纹算法；不改磁盘上的原文件。
- 新常量 `HEALTH_CHECK_VERSION = 1`；新列 `books.health_check_version INTEGER`、`books.damage_reason TEXT`；新表 `scan_skipped_files(file_path TEXT PRIMARY KEY, file_size INTEGER NOT NULL, file_mtime REAL, skipped_at TEXT DEFAULT CURRENT_TIMESTAMP)`。
- 状态值 `damaged`；审核项类型 `damaged`，payload `{ file_path, file_size, file_mtime, reason }`。
- 单本检查超时 **15000ms**（`Promise.race`，接受后台解析继续）；超时原因「解析超时」。
- 原因文案（固定）：`文件不完整（可能下载或复制中断）`、`缺少书籍目录（content.opf）`、`没有可读的章节`、`解析超时`、`无法解析：<简短错误>`（简短错误去掉路径，最多 80 字）。
- 判定只用「打开失败」与「零章节」，不用启发式。
- 跳过记录：批次应用时写；路径 + 大小 + 修改时间三项全等才算没变；书库已有同路径的书时不查跳过记录。
- `damaged` 项必须逐本决定（accept = 导入 / reject = 跳过）才能应用：后端应用接口拒绝 422，前端禁用按钮。
- 前端：颜色只用主题变量，图标用 Tabler，复用 `main.css` 共享类；视图不直接调 axios。
- 本地实测用数据库副本，后端加 `USAGE_STATS=off`；不写真实 `data/` 与 `books/`。

## Review Focus

- 超大 EPUB（几十 MB）扫描：检查应在超时内完成或按超时处理，扫描不卡死。Task 1 测超时分支（假解析器）。
- 已入库 EPUB 文件没变、检查版本已是最新：第二次扫描不再打开文件、不产生任何审核项或提醒。Task 3 测。
- 跳过后文件没变 → 不再提示；文件变了（大小或 mtime）→ 重新检查并再次提示。Task 3 测。
- 「已入库的损坏书」被换成完整文件：扫描后状态回 `normal`、`damage_reason` 清空。Task 3 / Task 4 测。
- 自动模式下扫描同时有新书和损坏文件：新书照常入库，损坏批次保持 pending 并有铃铛提醒。Task 4 测。

---

### Task 1: EPUB 健康检查模块

**Files:**
- Modify: `backend/src/plugins/parser-epub.ts`（`load` 记录是否走了内存修正）
- Create: `backend/src/services/epub-health.ts`
- Test: `backend/tests/services/epub-health.test.ts`（用 adm-zip 现场生成夹具，参考 `src/plugins/parser-epub.test.ts` 的 `makeEpub` / `breakEndRecord`）

**Interfaces:**
- Produces:
  - `EpubParser` 新增只读属性 `repaired: boolean`（`load` 第一次失败、修正后成功时为 true）。
  - `export type EpubHealth = { status: 'ok' } | { status: 'repaired' } | { status: 'damaged'; reason: string }`
  - `export const EPUB_CHECK_TIMEOUT_MS = 15000`
  - `export function classifyZipDamage(buf: Buffer): string | null`：纯函数；没有 EOCD（`PK\x05\x06`）或没有 central directory（`PK\x01\x02`）→ `文件不完整（可能下载或复制中断）`；否则 `null`。
  - `export async function checkEpubHealth(filePath: string, opts?: { timeoutMs?: number; createParser?: () => { load(p: string): Promise<void>; getChapters(): Promise<unknown[]>; repaired?: boolean; dispose?(): void } }): Promise<EpubHealth>`：解析成功且章节 > 0 → ok / repaired；章节 0 → `没有可读的章节`；解析失败 → 先 `classifyZipDamage`，再看错误信息是否指向缺少 opf（`缺少书籍目录（content.opf）`），否则 `无法解析：<简短错误>`；超时 → `解析超时`。结束时调用 `dispose`（若有）。
- [x] **Step 1: 写失败测试**：正常 EPUB → ok；尾部条目数写错 → repaired；截断到一半的 EPUB → damaged + 「文件不完整…」；zip 完整但没有 content.opf / container.xml 指向不存在的 opf → damaged + 「缺少书籍目录（content.opf）」；spine 为空 → 「没有可读的章节」；`createParser` 返回永不 resolve 的 load、`timeoutMs: 50` → 「解析超时」；错误信息含绝对路径时原因里不含路径且 ≤ 80 字。
- [x] **Step 2: 运行** `cd backend && npx jest tests/services/epub-health.test.ts src/plugins/parser-epub.test.ts` → FAIL
- [x] **Step 3: 实现**
- [x] **Step 4: 运行** → PASS；`npx tsc --noEmit`
- [x] **Step 5: 提交** `feat: EPUB 健康检查（打不开 / 已自动修正）`

### Task 2: 数据库与类型

**Files:**
- Modify: `backend/src/db.ts`（两列 + 一张表，迁移一次写完）
- Modify: `backend/src/types/index.ts`（`DamagedPayload`、`ScanResult.damaged`、`NewBookPayload.repaired?: boolean`、书状态联合类型加 `damaged`、`Book.damage_reason?`、`health_check_version?`）
- Create: `backend/src/services/scan-skips.ts`
- Test: `backend/tests/services/scan-skips.test.ts`、db 迁移测试（沿用现有 db 测试写法）

**Interfaces:**
- Produces:
  - `export interface DamagedPayload { file_path: string; file_size: number; file_mtime: number | null; reason: string }`
  - `scan-skips.ts`：`isSkippedUnchanged(db, filePath: string, size: number, mtime: number): boolean`、`recordSkip(db, p: { file_path; file_size; file_mtime })`（upsert）、`clearSkip(db, filePath: string)`。
  - `export const HEALTH_CHECK_VERSION = 1`（放在 `services/epub-health.ts` 或 `scan-versions.ts`，二选一，在 Task 3 引用）。
- [x] **Step 1: 写失败测试**：迁移后两列一表存在且对已有库幂等；`recordSkip` 后同大小同 mtime → true，大小或 mtime 不同 → false；`clearSkip` 后 false。
- [x] **Step 2: 运行** → FAIL
- [x] **Step 3: 实现**
- [x] **Step 4: 运行** → PASS；`npx tsc --noEmit`（`ScanResult.damaged` 新增后，现有构造 ScanResult 的地方补 `damaged: []`）
- [x] **Step 5: 提交** `feat: 损坏 EPUB 的数据库字段、跳过记录与类型`

### Task 3: 扫描接入健康检查

**Files:**
- Modify: `backend/src/services/scan-walker.ts`
- Test: `backend/tests/services/scan-walker*.test.ts`（沿用现有扫描测试的临时目录 + 临时库写法；`checkEpubHealth` 用 `jest.mock` 控制结果）

**Interfaces:**
- Consumes: Task 1 `checkEpubHealth`；Task 2 `scan-skips`、`HEALTH_CHECK_VERSION`、`DamagedPayload`。
- Produces: `ScanResult.damaged`；扫描任务结果里的计数 `health: { damaged_existing: number; recovered: number; repaired: number }`（挂在 runScanTask 内部，用于 Task 5 的提醒）。
- 规则：
  1. **需要处理的文件**（`processFile` 路径）且扩展名为 epub：先 `checkEpubHealth`。
     - ok / repaired：照常生成新书；repaired 时 `NewBookPayload.repaired = true`，计数 repaired++。payload 带 `health_check_version`（应用时写入）。
     - damaged 且书库里已有同路径的书：直接 `UPDATE books SET status='damaged', damage_reason=?, file_size=?, file_mtime=?, health_check_version=? WHERE id=?`，计数 damaged_existing++，不生成审核项。
     - damaged 且是新文件：`isSkippedUnchanged` 为 true → 什么都不做；否则加入 `damaged` 列表（payload 见 Global Constraints）。
  2. **复用指纹的文件**（`shouldReuseFingerprint` 为 true 的分支）且是 epub 且 `health_check_version !== HEALTH_CHECK_VERSION`：做一次检查并直接写库——damaged 且原状态不是 damaged → 设 damaged + 原因（damaged_existing++）；ok / repaired 且原状态是 damaged → 设 normal、清原因（recovered++）；任何结果都写 `health_check_version`。不生成审核项。（预取查询需要带上 `health_check_version`。）
  3. 原状态是 `damaged` 且文件没变、版本已最新：不检查、不提示。
  4. 取消扫描时的部分结果也带上 `damaged`。
- [x] **Step 1: 写失败测试**：新文件 damaged → result.damaged 1 条、new_books 无此文件；跳过记录匹配 → 不出现；跳过后文件 mtime 变化 → 再次出现；新文件 repaired → new_books 中 `repaired: true`；已入库书文件变化且 damaged → 直接写 damaged、无审核项；已入库书检查版本过期且 damaged → 直接写 damaged；已入库 damaged 书检查版本过期且现在 ok → 回 normal、原因清空；版本最新且文件没变 → `checkEpubHealth` 未被调用；TXT 文件不调用 `checkEpubHealth`。
- [x] **Step 2: 运行** → FAIL
- [x] **Step 3: 实现**
- [x] **Step 4: 运行** → PASS；全量 `npx jest`
- [x] **Step 5: 提交** `feat: 扫描时检查 EPUB，损坏的单独待审核`

### Task 4: 批次构建、应用与自动模式

**Files:**
- Modify: `backend/src/services/batch-builder.ts`、`backend/src/services/batch-applier.ts`、`backend/src/routes/scan-batches.ts`、`backend/src/services/scan-walker.ts`（自动模式分发）
- Test: 对应的 batch-builder / batch-applier / scan-batches 路由测试文件

**Interfaces:**
- Consumes: Task 2/3 的类型与 `scan-skips`。
- 规则：
  - `entriesOf` 加 `damaged`（type `damaged`）；`buildBatchesFromScan` 把 damaged 项**另外成批**（不参与与其他条目的并查集合块），每批同样受 `SCAN_BATCH_SIZE` 限制；`summary_counts` 加 `damaged`。
  - 应用：`damaged` 项 `accept` → 插入（或按路径更新）书：`status='damaged'`、`damage_reason`、`file_size`、`file_mtime`、`file_format='epub'`、`title`=文件名去扩展名、`author`=文件名提取、`fingerprint` 用 `computeFingerprint(path,'epub')`、`fingerprint_version`、`health_check_version`；`clearSkip`。`reject` → `recordSkip`。结果计数新增 `damaged_imported`、`damaged_skipped`。
  - `new` 项应用时（`upsertBookByPath`）：写 `health_check_version`（payload 带）、`damage_reason = NULL`。
  - 应用接口：批次里有 `damaged` 项且 `admin_decision` 为空 → 422 `VALIDATION_ERROR`「请先为每本损坏的书选择导入或跳过」。`applyBatch` 自身也做同样检查（抛错，供自动模式判断）。
  - 自动模式：只应用不含 `damaged` 项的批次；含 damaged 的批次保持 pending 并 `notifyScanReview()`。
- [x] **Step 1: 写失败测试**：新书 + 损坏混合扫描结果 → 两个批次，损坏批次只含 damaged；summary_counts.damaged 正确；未决定时应用接口 422；accept 后书库有 damaged 书且原因正确；reject 后有跳过记录、书库无此书；自动模式 → 新书已入库、损坏批次 pending、有 scan_review 提醒；new 项应用会清空 `damage_reason`。
- [x] **Step 2: 运行** → FAIL
- [x] **Step 3: 实现**
- [x] **Step 4: 运行** → PASS；全量 `npx jest`
- [x] **Step 5: 提交** `feat: 损坏 EPUB 单独成批，逐本导入或跳过`

### Task 5: 书库筛选、阅读提示、扫描提醒

**Files:**
- Modify: `backend/src/routes/library.ts`（`?status=problems` 含 damaged；新增 `?status=damaged`）
- Modify: `backend/src/routes/reader.ts`（章节 / 内容接口：书 `status==='damaged'` → `errorResponse(res, 409, 'BUSINESS_CONFLICT', ...)`，消息 `文件不完整或已损坏：<damage_reason>。请重新获取文件后重新扫描`；状态正常但解析失败时，用 Task 1 的分类生成同样格式的消息，分类不出时保持「无法读取章节」）
- Modify: `backend/src/services/notices.ts`（新提醒 kind `scan_health`：damaged_existing / recovered / repaired 任一非零时发一条，文案如「扫描发现 2 本 EPUB 已损坏，1 本恢复正常，3 本已自动修正」，链接 `/library/problems`）
- Modify: `backend/src/services/scan-walker.ts`（扫描结束时调用该提醒）
- Test: 对应路由 / notices 测试

**Interfaces:**
- Consumes: Task 1 `classifyZipDamage` 等；Task 3 的 `health` 计数。
- Produces: `notifyScanHealth(counts: { damaged_existing: number; recovered: number; repaired: number }, db?)`。
- [x] **Step 1: 写失败测试**：problems 列表含 damaged 书；`?status=damaged` 只返回 damaged；damaged 书请求章节 → 409 且消息含原因；前端阅读器显示后端消息（若当前写死「无法读取章节」则改为优先用后端 message，放在 Task 6）；三项计数全零不发提醒，非零发一条且文案正确。
- [x] **Step 2: 运行** → FAIL
- [x] **Step 3: 实现**
- [x] **Step 4: 运行** → PASS；全量 `npx jest`
- [x] **Step 5: 提交** `feat: 损坏书筛选、阅读提示与扫描提醒`

### Task 6: 前端

**Files:**
- Modify: `frontend/src/types/index.ts`、`frontend/src/api/scan-batches.ts`、`frontend/src/api/library.ts`
- Modify: `frontend/src/views/ScanBatchReview.vue`（「文件损坏」一栏：文件名、大小、原因、每本「导入 / 跳过」单选（`.segmented` 或 el-radio-group），选择即调用现有逐项决定接口；有未决定项时「应用」按钮禁用并提示「还有 N 本损坏的书没选」；新书行 `repaired` 时显示「已自动修正」标签；批次摘要显示损坏数）
- Modify: `frontend/src/views/ScanBatchList.vue`（批次摘要显示损坏数）
- Modify: `frontend/src/views/ProblemBooks.vue`（「损坏」筛选与计数、行标签「损坏」+ 原因）
- Modify: `frontend/src/components/BookCard.vue`（`damaged` → 标签「损坏」，与乱码同样的显示方式）
- Modify: 阅读器加载章节失败的提示处（`frontend/src/views/Reader.vue` 或 `composables/useReader`）：优先显示后端返回的 `message`
- Create: `frontend/src/utils/scan-review.ts`（纯函数 `undecidedDamagedCount(items): number`）+ 测试
- Test: `frontend/src/utils/scan-review.test.ts`
- [x] **Step 1: 写失败测试**：`undecidedDamagedCount` 只统计 type 为 damaged 且无 admin_decision 的项。
- [x] **Step 2: 运行** `cd frontend && npx vitest run src/utils/scan-review.test.ts` → FAIL
- [x] **Step 3: 实现**
- [x] **Step 4: 运行** `npx vitest run && npx vue-tsc --noEmit` → PASS
- [x] **Step 5: 提交** `feat: 扫描审核页「文件损坏」一栏与问题书籍「损坏」筛选`

### Task 7: 文档与实测

**Files:**
- Modify: `docs/api.md`（状态值 damaged、`?status=damaged`、审核项类型 damaged 与 payload、应用接口的 422、`NewBookPayload.repaired`、提醒 kind `scan_health`）
- Modify: `CHANGELOG.md` `[Unreleased]` `### 新增`
- [x] **Step 1: 全量检查**：backend `npx tsc --noEmit && npx jest`；frontend `npx vue-tsc --noEmit && npx vitest run`
- [x] **Step 2: 本地实测**（数据库副本 + 临时书目录，`USAGE_STATS=off`）：临时书目录放一本正常 EPUB、`books/郎咸平说：新帝国主义在中国2.epub` 的副本（截断）、一本尾部条目数写错的 EPUB（用 adm-zip 生成或 `breakEndRecord`），以审核模式扫描：损坏批次单独出现、原因为「文件不完整…」；选「跳过」应用后再扫描不再出现；改动该文件 mtime 后再扫描重新出现；选「导入」后问题书籍里出现「损坏」、打开提示原因；修正类 EPUB 新书行有「已自动修正」。自动模式再扫一次：新书入库、损坏批次 pending、铃铛有提醒。已入库 EPUB 的补查：第一次扫描后 `health_check_version` 都写上，第二次扫描不再打开。截图审核页与问题书籍页。
- [x] **Step 3: 提交** `docs: 损坏 EPUB 检查的 API 文档与更新日志`
