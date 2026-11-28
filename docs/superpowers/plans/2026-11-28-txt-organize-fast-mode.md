# TXT 目录整理 快速模式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 发起 TXT 目录整理时可选「快速」（规则预判 + AI 只判可疑行，默认）或「完全 AI」（现有做法）。

**Architecture:** 新增纯函数模块 `prelabel.ts` 给候选行预标注；`judgeCandidates` 增加 `mode`，快速模式只把未预标注的行分批发给 AI 并合并标签；任务表记 `mode`，路由接收 `mode`（缺省 fast）；前端发起时弹出二选一对话框，进度与审核页显示模式。下游 structure / writer / apply 不变。

**Tech Stack:** Node + Express + TypeScript + better-sqlite3 + jest；Vue 3 + Element Plus + vitest。

**Spec:** `docs/superpowers/specs/2026-11-28-txt-organize-fast-mode-design.md`

## Global Constraints

- 风格跟随所改文件；中文注释 / 文案；不引入新依赖。
- 后端测试：`backend/` 下 `node --experimental-vm-modules node_modules/jest/bin/jest.js <files>`（yarn 不在 PATH）；类型检查 `npx tsc --noEmit`。前端：`frontend/` 下 `npx vue-tsc --noEmit`、`npx vitest run`。
- 不读 `.env`，不 push。每个任务单独提交，中文提交信息，结尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 模式值：`'fast' | 'full'`；API 缺省 `fast`；旧任务（DB 默认）`full`。
- 规则只取保守方向：拿不准一律不标、交给 AI。
- 规则 1 正文阈值 `bodyChars >= 300`。
- 快速模式 note 文案：`快速模式：规则判定 X 行，AI 判定 Y 行`。

## Review Focus

1. 每卷从「第一章」重新编号且只有编号的书：真章节不得被规则 2 标为 stray_number（Task 1 测试）。
2. 单个错号（第100章写成第1000章）后，后续只有编号的真章节不被误删（Task 1 测试）。
3. 快速模式下可疑行为 0：不调用 AI、任务正常进入 review、`batches_total` 为 0（Task 2 测试）。
4. 已有进行中任务时用另一种模式再发起：返回原任务，不新建（Task 3 测试）。
5. 旧前端 / 其他客户端 POST 不带 body：按 fast 发起，不报 422（Task 3 测试）。

---

### Task 1: 规则预标注 prelabel.ts

**Files:**
- Create: `backend/src/services/txt-organize/prelabel.ts`
- Test: `backend/tests/services/txt-organize/prelabel.test.ts`

**Interfaces:**
- Consumes: `Candidate`（candidates.ts）、`Label`（judge.ts）、`chapterNumberValue(num: string): number`（plugins/parser-txt.ts，失败返回 NaN）
- Produces: `export function prelabelCandidates(candidates: Candidate[]): Array<Label | null>` — 与 candidates 下标对齐，`null` = 交给 AI。

算法（设计文档「last 的维护」）：
- 「有章名章节行」：去空白后匹配可选的「第X卷/部」前缀 + `第N章` + 非空章名；N 可为阿拉伯 / 全角 / 中文数字，`chapterNumberValue` 得 NaN 视为不匹配。
- 状态：`last`（初始 0）、`established`（初始 false）、`pending: number | null`、已见行文字集合。
- 有章名章节行 N：
  - N == last + 1：last = N；若 pending 非空或 N == 1，established = true；pending = null。若 established 且 `bodyChars >= 300` 且行文字未见过 → `{ type: 'chapter' }`。
  - 否则若 pending != null 且 N == pending + 1：last = N，established = true，pending = null（不标，交 AI）。
  - 否则：pending = N，established = false（不标）。
- 整行只有编号（复用 structure.ts 的 `isStrictStrayNumber`，并限 `章`）且 established 且 N ≤ last → `{ type: 'noise', noiseKind: 'stray_number' }`。
- 卷 / 部行（匹配 `^第\S+?[卷部]` 且不含 `第N章`）：established = false。
- 所有行处理完后记入已见集合。

- [ ] **Step 1: 写失败测试** `prelabel.test.ts`，用最小 Candidate 构造器（`text`、`bodyChars`，其余给默认值），用例与期望：
  - `连续有章名章节且正文足够 → chapter`：「第一章 山村」(500)、「第二章 青牛镇」(500)、「第三章 七玄门」(500) → 全部 `chapter`。
  - `正文不足 300 → null`：第二章 bodyChars 100 → 该行 `null`。
  - `重复的同一行文字 → 第二次 null`。
  - `跳号 → null，随后两个连续章节重建链`：1,2,5,6,7 → 5、6 为 null，7 为 chapter。
  - `单个错号不让 last 跳上去`：有章名 1、2、「第1000章 x」、3 → 1000 为 null，3 为 chapter（N == last+1 且 pending 非空 → 链继续）；之后只有编号的「第5章」→ null（last 仍为 3，若 last 跳到 1000 会被误标为 stray_number）；只有编号的「第2章」→ stray_number。
  - `孤立编号 ≤ last → stray_number`：章 1..3 后「第2章」→ `{type:'noise',noiseKind:'stray_number'}`；「第3章」也是；「第4章」（> last）→ null。
  - `无章名的下一章不标`：章 1..78 后「第七十九章」→ null。
  - `卷行后规则 2 暂停`：章 1..3、「第二卷 新地」、「第一章」（只有编号）→ null；「第二章」→ null。
  - `每卷重新编号且有章名`：章 1..3、「第二卷」、「第一章 归来」「第二章 再战」「第三章 x」→ 第一章 null（N≠last+1，pending=1），第二章 null（重建链），第三章 chapter。
  - `卷前缀章节`：「第五卷名震一方第一章 甲」起连续 → 按 chapter 规则判定。
  - `中文数字解析失败 → null`：「第壹章 甲」→ null。
- [ ] **Step 2: 运行确认失败**：`... jest.js tests/services/txt-organize/prelabel.test.ts` → FAIL（模块不存在）。
- [ ] **Step 3: 实现** `prelabelCandidates`（上面算法）。
- [ ] **Step 4: 运行确认通过** → PASS。
- [ ] **Step 5: 提交** `feat(organize): 快速模式的规则预标注（干净章节 / 孤立编号）`

### Task 2: judge 快速模式

**Files:**
- Modify: `backend/src/services/txt-organize/judge.ts`（`candidateLine`、`buildPrompt`、`judgeBatch`、`judgeCandidates`）
- Test: `backend/tests/services/txt-organize/judge.test.ts`

**Interfaces:**
- Consumes: `prelabelCandidates`（Task 1）
- Produces: `export type OrganizeMode = 'fast' | 'full'`；`judgeCandidates(candidates, book, db, onBatch?, mode: OrganizeMode = 'full'): Promise<JudgeResult>`（mode 放最后、默认 full，现有调用与测试不变）。`JudgeResult` 不变（`batches` = 实际 AI 批数）。

行为：
- `full`：与现在逐字节一致（prompt 不含 `prevChapter`）。
- `fast`：`pre = prelabelCandidates(candidates)`；`suspects = candidates.filter((_, i) => !pre[i])`；在 suspects 上按原逻辑分批（300 / 重叠 20 取前面的 suspects / 两次失败拆分 / 网络重试）。
  - 每条可疑行行尾多 `\tprevChapter=<文字>`：它之前最近一个已知 `chapter` 标签（规则或前批 AI）的候选行原文，没有则空。
  - 结构摘要：用全部候选在本批第一条可疑行之前的已知标签（规则 + AI；未知的跳过）计算。
  - 提示词在 INSTRUCTIONS 后追加一句（仅 fast）：`已省略程序判定为正常章节或孤立编号的行，序号不连续是正常的；prevChapter 是该行之前最近的章节标题。`
  - 合并：规则标签与 AI 标签按 id 填回 `labels`；结尾两项校验照旧。
  - suspects 为空：不调用 AI，`batches: 0`，`onBatch` 不调用。
  - notes 末尾追加 `快速模式：规则判定 ${规则数} 行，AI 判定 ${suspects.length} 行`。

- [ ] **Step 1: 写失败测试**（mock `aiManager.chat` 的方式沿用 judge.test.ts 现有写法）：
  - `fast 只把可疑行发给 AI`：候选 = 3 个干净章节 + 1 个「第二章」（只有编号）+ 1 个「第三卷结束。」→ chat 只被调用 1 次，prompt 含 `#4`，不含 `#0`/`#1`/`#2`/`#3` 的行；返回 labels 长度 5，`labels[3]` 为 stray_number，`labels[4]` 为 AI 给的 noise/text。
  - `fast 可疑行带 prevChapter`：prompt 中 `#4` 行含 `prevChapter=第三章 七玄门`（按用例实际文字）。
  - `fast 全部被规则判定 → 不调用 AI`：chat 调用 0 次，`batches === 0`，notes 含 `快速模式：规则判定 3 行，AI 判定 0 行`。
  - `full 行为不变`：现有用例全部通过；新增断言 full 的 prompt 不含 `prevChapter`。
- [ ] **Step 2: 运行确认新用例失败。**
- [ ] **Step 3: 实现**上述行为（`candidateLine` 加可选 prevChapter 参数；`buildPrompt` 加可选附加说明）。
- [ ] **Step 4: 运行** `judge.test.ts` 全部通过。
- [ ] **Step 5: 提交** `feat(organize): AI 判定支持快速模式（只判可疑行）`

### Task 3: 任务 mode 入库、路由与文档

**Files:**
- Modify: `backend/src/db.ts`（txt_organize_jobs 建表加列 + ALTER 迁移，沿用 `try { exec } catch {}` 写法）
- Modify: `backend/src/services/txt-organize/job.ts`（`OrganizeJob.mode`、`JOB_COLUMNS`、`requestOrganize`、runJob 调 `judgeCandidates(..., job.mode)`、`OrganizedDuplicatePayload.mode`）
- Modify: `backend/src/routes/reader.ts`（POST body 校验）
- Modify: `docs/api.md`（organize 一节）、`CHANGELOG.md`（[Unreleased] 一句）
- Test: `backend/tests/services/txt-organize/job.test.ts`、`backend/tests/routes/organize.test.ts`

**Interfaces:**
- Consumes: `OrganizeMode`、`judgeCandidates(..., mode)`（Task 2）
- Produces: `requestOrganize(bookId, user, db = getDb(), mode: OrganizeMode = 'fast')`；`OrganizeJob.mode: OrganizeMode`；`OrganizedDuplicatePayload.mode?: OrganizeMode`（旧 payload 无此字段）；API `POST /reader/:bookId/organize` body `{ mode?: 'fast' | 'full' }`，job 视图含 `mode`。

- [ ] **Step 1: 写失败测试**：
  - job.test：`requestOrganize 缺省 mode 为 fast`、`mode=full 时入库 full 且 runJob 以 full 调用 judgeCandidates`（沿用现有 mock 方式断言调用参数）、`已有进行中任务时以另一模式发起返回原任务`（`id` 相同、`mode` 为原值）、`审核 payload 带 mode`。
  - organize.test：`POST 不带 body → 200 且 job.mode === 'fast'`、`POST {mode:'full'} → job.mode === 'full'`、`POST {mode:'x'} → 422 VALIDATION_ERROR`、`GET 返回 job.mode`。
- [ ] **Step 2: 运行确认失败。**
- [ ] **Step 3: 实现**：列 `mode TEXT NOT NULL DEFAULT 'full'`；INSERT 写入 mode；路由用 zod `z.object({ mode: z.enum(['fast','full']).optional() })`，`req.body ?? {}`，校验失败 422 `参数校验失败`；api.md 写明 mode 含义与缺省；CHANGELOG 加「AI 整理目录可选快速模式（默认）或完全 AI 模式」。
- [ ] **Step 4: 运行** 两个测试文件 + 全量后端测试 + `npx tsc --noEmit` 通过。
- [ ] **Step 5: 提交** `feat(organize): 整理任务记录模式，发起接口可选 fast / full（缺省 fast）`

### Task 4: 前端选择对话框与模式显示

**Files:**
- Modify: `frontend/src/types/index.ts`（`OrganizeJob.mode?: 'fast' | 'full'`、`OrganizedDuplicatePayload.mode?`）
- Modify: `frontend/src/api/reader.ts`（`requestOrganize(bookId, mode)` 发送 `{ mode }`）
- Modify: `frontend/src/views/Reader.vue`（`handleRequestOrganize` 的 `ElMessageBox.confirm` 换成带两项单选的对话框；进度文字）
- Modify: `frontend/src/components/OrganizedDuplicateCard.vue`（meta 行加整理方式）
- Test: 现有前端测试中涉及 requestOrganize 的地方同步；如无，可不新增

**Interfaces:**
- Consumes: API `mode` 字段（Task 3）

文案（照抄）：
- 对话框标题：`AI 整理目录`；说明：`AI 会重新整理这本书的目录，管理员审核后对所有读者生效。`
- 选项一（默认选中）：`快速（推荐）` — `程序先判断明显的章节和正文里夹杂的编号，AI 只看拿不准的行。长篇约快 3–4 倍。原书若在某处写错（如重复的章节标题），可能不会被发现。`
- 选项二：`完全 AI` — `每一行都由 AI 判断，结果最稳，长篇可能要半小时以上。`
- 按钮：`开始整理` / `取消`。
- 进度：`正在整理（快速）…` / `正在整理（完全 AI）…`，`mode` 缺失时不带括号。
- 审核卡片：`整理方式 快速` / `整理方式 完全 AI`；payload 无 mode 时不显示。

- [ ] **Step 1: 实现**（对话框用 `el-dialog` + `el-radio-group`，样式用主题变量与 main.css 共享类，跟随 Reader.vue 现有写法）。
- [ ] **Step 2: 运行** `npx vue-tsc --noEmit`、`npx vitest run` 通过。
- [ ] **Step 3: 浏览器实测**（控制器做）：对话框默认选中快速、取消不发请求、选完全 AI 发出 `{mode:'full'}`、进度文字带模式。
- [ ] **Step 4: 提交** `feat(organize): 发起整理时选择快速 / 完全 AI，进度与审核页显示整理方式`

### Task 5: 真书验证（控制器）

- [ ] 用当前分支重建 `easyreader-app:e2e` 镜像，在 er-e2e 上以快速模式整理《凡人修仙传》：记录用时、AI 批数、规则 / AI 行数。
- [ ] 导出目录，与 `.superpowers/sdd/2026-11-27-txt-ai-organize/fanren-full-ai-toc-20261128.txt`（2461 条）diff；分卷结构须一致，每条差异回原文解释。
- [ ] 《鬼吹灯》快速模式跑一次：确认部 / 卷结构正确、没有真章节被删（对照原文目录）。
- [ ] 结果写入 progress，必要时调整规则后回到 Task 1 补测试。
