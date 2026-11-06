# 学习总结 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每本书一份按主题组织的学习总结：AI 后台生成初版、只追加式更新、所见即所得编辑、修改记录（可查看、可恢复）、📖 点回原文；入口页列出所有书的总结；全部能力通过 `/api/v1` 对外提供（App、小程序可调用）。

**Architecture:** 后端新增独立模块：`study-summary`（存储、版本、并发保护）、`summary-doc`（Tiptap JSON 文档的纯函数）、`summary-ai`（提示词、分批、输出解析）、`summary-job`（后台任务）、路由 `/study`。前端新增 `api/study.ts`、`utils/summary-doc.ts`、Tiptap 编辑器组件、总结页与入口页。公共文件只做接入（建表、路由挂载、前端路由、侧栏、两个入口按钮、启动时任务恢复）。

**Tech Stack:** Express + better-sqlite3 + zod + Jest；Vue 3 + Element Plus + Vitest + happy-dom；新增 `@tiptap/vue-3@2.11.5`、`@tiptap/starter-kit@2.11.5`、`@tiptap/pm@2.11.5`（精确版本）。

**Spec:** `docs/superpowers/specs/2026-11-06-study-summary-design.md`

## Global Constraints

- 只在长期分支 `study` 开发，**不合并回 main**；main 只单向合并进 study。学习总结代码放独立文件，公共文件只做最少接入。
- 学习版镜像：同一 Docker Hub 仓库，tag 加 `-study` 后缀，**不得产生 `latest` / `edge` / 无后缀版本号**。
- AI 只在用户点击「生成总结」「更新」时调用；复用 `aiManager.chat(prompt, db)`；未配置 → 400 `AI_NOT_CONFIGURED`，文案复用 `routes/reader.ts` 的 `AI_NOT_CONFIGURED_MSG`。
- 更新只追加：已有内容不修改、不移动；补充追加到对应主题（二级标题）末尾，新主题追加到文末。
- 「已整理的笔记」只记录真正送进 AI 的笔记；`kind='highlight'` 的导图根节点不作为输入。引用标识 `h:<highlightId>` / `n:<mindNodeId>`。
- 任务失败 / 服务重启：不写入内容、不产生版本、已整理集合不变。
- 并发保护：保存带修订号，不一致 → 409 `BUSINESS_CONFLICT` 并返回最新总结；任务进行中保存 → 409。
- 版本来源：`ai_generate`（AI 生成）、`ai_update`（AI 补充）、`user`（我）、`restore`（恢复）；用户编辑 30 分钟内的连续保存合并为同一个版本（我的决定，满足 spec「一次编辑会话」）。
- 去原文规则同学习导图：划线 `?highlight=<id>`；知识点有出处 `?chapter=<i>&find=<名称>`，后文先确认（文案「这是你还没读到的后文，可能会剧透。确定查看吗？」，标题与按钮「查看后文」，取消「取消」）；无出处 `?chapter=<chapter_index>`；引用的笔记已删除 → 「原笔记已删除」。
- API `{ success, code, data }`、`authMiddleware`、只访问本人数据；挂 `/api` 与 `/api/v1`；补 `docs/api.md`。UI 中文；确认框带 `cancelButtonText: '取消'`；颜色取主题变量；手机断点 `max-width: 768px`。
- 前端 API 调用只经 `frontend/src/api/`；测试：后端 `npx jest`，前端 `npx vitest run`；纯函数测试先行。
- **对外 API（用户决定）**：网页只是客户端之一；业务逻辑（含 Markdown 导出、引用解析、版本恢复）全部在后端；读取支持 `format=json|blocks|markdown`；写入按节点白名单校验；`docs/api.md` 写清文档结构、blocks 结构、任务轮询流程，只加字段不破坏已有字段。

## Review Focus

1. **AI 输出不守规矩**：返回 Markdown 代码块包裹的 JSON、编造不存在的引用、主题名为空、整体不是 JSON → 有效部分照用、编造引用丢弃、全无效时任务失败且不写入（Task 3 `parse*` 测试）。
2. **用户改过主题标题或删了主题后再更新**：AI 收到的是当前文档的二级标题；AI 指定的主题不存在 → 作为新主题追加，不丢内容（Task 2 `appendAdditions` 测试）。
3. **编辑中 AI 补充完成 / 两个标签页同时编辑**：旧修订号保存被拒并返回最新内容，前端载入最新内容并提示（Task 4 `saveUserDoc` 测试 + Task 8 手测）。
4. **笔记很多（数百条、单条批注很长）**：按批送 AI，单条过长截断；中途某批失败 → 整个任务失败、不写入（Task 3 `splitBatches` 与 Task 5 失败测试）。
5. **书已删除 / 笔记已删除**：入口页仍显示总结（标「书已不存在」）、不能更新；引用点击提示「原笔记已删除」（Task 4 `listSummaryOverview`、Task 6 `resolveRef` 测试）。
6. **第三方客户端写入异常文档**：未知节点类型、`<script>` 之类的 HTML 文本、超深嵌套、超大文档 → 422，不入库（Task 2 `isValidDoc` 白名单测试）。

---

### Task 1: 分支整理与学习版发布

**Files:**
- Modify（study 分支）: `.github/workflows/docker-publish.yml`、`CHANGELOG.md`、`README.md`（说明学习版镜像 tag）
- 无代码测试；验证靠 git 状态与工作流语法检查

- [ ] **Step 1:** 当前分支改名：`git branch -m feat/study-notes-phase1 study`（远端改名在 Step 6 一起确认）。
- [ ] **Step 2:** 通用提交挪到 main：`git switch main && git cherry-pick beb29e7 913c5a8 6a10f68 d441aae`；冲突按 main 现状解决；`docker compose config -q` 通过；`docker compose build` 用 `.env.example` 的国内源能构建成功。
- [ ] **Step 3:** `git switch study && git merge main`：解决冲突（重点：README、`.github/workflows/docker-publish.yml`、CHANGELOG）；后端 `npx jest && npx tsc --noEmit`、前端 `npx vitest run && npx vue-tsc --noEmit` 全过。
- [ ] **Step 4:** study 上改发布工作流：触发改为 `branches: [study]`、`tags: ['study-v*.*.*']`；metadata 用 `flavor: latest=false,suffix=-study`；tags：study 分支推送 → `edge`（加后缀即 `edge-study`）；`study-vX.Y.Z` → 从 tag 名去掉 `study-v` 取版本号，产生 `X.Y.Z-study`、`X.Y-study`、`latest-study`（用 `type=raw` 显式写出）；Release 说明从 CHANGELOG 中 `## [X.Y.Z-study]` 一节取（awk 匹配串同步改）。DOCKERHUB.md 同步步骤保留但只在 main 运行（study 工作流删除该步骤，避免学习版覆盖仓库说明）。
- [ ] **Step 5:** main 的工作流确认不会响应 `study-v*` 标签（`v*.*.*` 通配会匹配 `study-v1.0.0` 吗：GitHub tags 过滤从开头匹配，`v*.*.*` 不匹配 `study-v…`；在 Step 4 的说明注释里写明）。CHANGELOG 顶部加「## [Unreleased-study]」一节，记录学习版独有功能。
- [ ] **Step 6:** **向用户确认后**推送：`git push origin main`、`git push -u origin study`、`git push origin --delete feat/study-notes-phase1`。未确认前不推送。
- [ ] **Step 7: 提交**（Step 4、5 的改动）`git commit -m "ci: 学习版镜像发布（-study 后缀，不覆盖 latest）"`；更新 `tasks/todo.md` 分支策略各项勾选。

### Task 2: 总结文档模型（后端纯函数）

**Files:**
- Create: `backend/src/services/summary-doc.ts`
- Test: `backend/tests/services/summary-doc.test.ts`

**Interfaces:**
- Produces:
  - `type DocNode = { type: string; attrs?: Record<string, unknown>; content?: DocNode[]; text?: string; marks?: Array<{ type: string }> }`（Tiptap JSON；根 `{ type: 'doc', content }`）
  - `interface ThemeBlock { theme: string; paragraphs: Array<Array<{ text: string } | { ref: string }>> }`（AI 解析后的统一结构：每段由文字片段与引用交替组成）
  - `buildDoc(themes: ThemeBlock[]): DocNode` — 主题 → `heading{level:2}`，段落 → `paragraph`，引用 → 行内原子节点 `{ type: 'noteRef', attrs: { ref } }`
  - `listThemes(doc: DocNode): string[]` — 顶层 level 2 标题文本，按出现顺序
  - `appendAdditions(doc: DocNode, additions: ThemeBlock[]): DocNode` — 返回新文档（不改入参）：同名主题（去首尾空白后全等）追加到该主题区段末尾（下一个 level 2 标题之前），找不到的作为新主题追加到文末
  - `extractRefs(doc: DocNode): string[]`（去重，文档顺序）
  - `docText(doc: DocNode): string`（纯文本，用于搜索，引用节点不输出）
  - `isValidDoc(x: unknown): x is DocNode`（白名单：节点 `doc` `heading`(level 2|3) `paragraph` `bulletList` `orderedList` `listItem` `codeBlock` `hardBreak` `text` `noteRef`(attrs.ref 匹配 `^(h|n):[\w-]{1,64}$`)；标记 `bold` `italic` `code`；其他任何类型或多余 attrs → false；深度 ≤ 20、节点数 ≤ 20000）
  - `docToBlocks(doc: DocNode): Array<{ type: 'h'; level: 2 | 3; text: string } | { type: 'p'; parts: Array<{ text: string; bold?: true; italic?: true; code?: true } | { ref: string }> } | { type: 'list'; ordered: boolean; items: Array<parts 同上> } | { type: 'code'; text: string }>`（嵌套列表拍平为一层，文本前加缩进「  」）
  - `docToMarkdown(title: string, doc: DocNode, refLabel: (ref: string) => string): string` — `# <书名> · 学习总结`；h2 → `## `、h3 → `### `、列表、代码块、行内代码、加粗/斜体；文本中 Markdown 特殊字符转义；引用 → `（出自：<refLabel(ref)>）`

- [ ] **Step 1: 写失败测试**：`buildDoc makes h2 per theme and inline noteRef`；`listThemes returns top-level h2 texts only`（h3 不算）；`appendAdditions appends to the end of the matching theme section`（插在下一个 h2 前，原有节点逐个 `toEqual` 不变）；`appendAdditions adds unknown themes at the end`；`appendAdditions matches renamed heading by current text`（文档标题已被用户改成「进程与作业」，AI 给「进程与作业」→ 追加到该节）；`appendAdditions does not mutate input`；`extractRefs dedupes in order`；`docText skips refs and joins blocks with newlines`；`isValidDoc rejects non-doc root, deep nesting and oversized docs`；`isValidDoc rejects unknown node/mark types and bad ref attrs`（`{type:'image'}`、`{type:'link'}` 标记、`ref:'x:1'`）；`docToBlocks flattens lists and keeps refs`；`docToMarkdown renders headings, lists, code and refs`；`docToMarkdown escapes markdown specials`（`*` `#` `_`）。
- [ ] **Step 2: 运行确认失败** `cd backend && npx jest tests/services/summary-doc.test.ts`
- [ ] **Step 3: 实现** → PASS
- [ ] **Step 4: 提交** `git commit -m "feat: 学习总结文档模型（主题、追加、引用）"`

### Task 3: AI 提示词、分批与输出解析

**Files:**
- Create: `backend/src/services/summary-ai.ts`
- Test: `backend/tests/services/summary-ai.test.ts`

**Interfaces:**
- Consumes: Task 2 `ThemeBlock`
- Produces:
  - `interface StudyNote { ref: string; kind: 'highlight' | 'concept' | 'event' | 'person' | 'custom'; chapterIndex: number; text: string; summary?: string; note?: string; parentLabel?: string }`（划线 text = 原文；知识点 text = 名称）
  - `splitBatches(notes: StudyNote[], opts?: { maxNotes?: number; maxChars?: number }): StudyNote[][]` — 默认 `maxNotes = 60`、`maxChars = 12000`（按序装箱；单条序列化超过 1000 字时截断其 note/text 尾部加「…」）
  - `buildGeneratePrompt(bookTitle: string, notes: StudyNote[]): string`
  - `buildUpdatePrompt(bookTitle: string, themes: string[], notes: StudyNote[]): string`
  - `parseThemes(raw: string, validRefs: Set<string>): ThemeBlock[]` — 生成与更新共用输出格式：`{"themes":[{"title":"…","paragraphs":["文字 [[h:xxx]] 文字 [[n:yyy]]", …]}]}`；段落里 `[[ref]]` 切成引用片段；不在 validRefs 的引用丢弃（文字保留）；空标题主题、空段落丢弃；解析不到任何有效主题 → 抛 `SummaryAiOutputError`
  - `class SummaryAiOutputError extends Error`

- [ ] **Step 1: 写失败测试**：`splitBatches respects maxNotes and maxChars and keeps order`；`splitBatches truncates a single oversized note`；`buildGeneratePrompt lists notes with refs in chapter order and asks for JSON themes`（断言含每个 `[[h:…]]`/`[[n:…]]` 标识、书名、「只输出 JSON」）；`buildUpdatePrompt includes current theme titles and says existing content must not be rewritten`；`parseThemes reads fenced json`（```json 包裹）；`parseThemes splits [[ref]] into ref pieces`；`parseThemes drops unknown refs but keeps text`；`parseThemes drops empty titles/paragraphs`；`parseThemes throws SummaryAiOutputError on non-json or no valid themes`。
- [ ] **Step 2: 运行确认失败** `cd backend && npx jest tests/services/summary-ai.test.ts`
- [ ] **Step 3: 实现** → PASS（提示词要求：中文；按主题归纳、把相关笔记串起来写成连贯段落；每个论点用 `[[标识]]` 标注依据；不得编造笔记中没有的内容；更新时只为新笔记写补充，优先放入已有主题）
- [ ] **Step 4: 提交** `git commit -m "feat: 学习总结 AI 提示词、分批与输出解析"`

### Task 4: 存储、版本、并发保护与笔记收集

**Files:**
- Create: `backend/src/services/study-summary.ts`
- Modify: `backend/src/db.ts`（`database.exec(STUDY_SUMMARY_DDL)` 紧跟 `MIND_DDL` 之后；启动恢复处追加 `failStaleSummaryJobs(database)`）
- Test: `backend/tests/services/study-summary.test.ts`

**Interfaces:**
- Consumes: Task 2 `DocNode`、`docText`、`listThemes`；Task 3 `StudyNote`；`listHighlights`、`listMindNodes`
- Produces:
  - `STUDY_SUMMARY_DDL`：`study_summaries(id PK, user_id, book_id, doc TEXT, included_refs TEXT /* JSON 数组 */, revision INTEGER, created_at, updated_at, UNIQUE(user_id, book_id))`；`study_summary_versions(id PK, summary_id, doc TEXT, source TEXT, description TEXT, created_at, updated_at)`；`study_summary_jobs(id PK, user_id, book_id, kind TEXT /* generate|update */, status TEXT /* running|done|failed */, done INTEGER, total INTEGER, error TEXT, created_at, finished_at)`
  - `interface StudySummary { id; book_id; doc: DocNode; included_refs: string[]; revision: number; created_at; updated_at }`
  - `collectNotes(db, userId, bookId): StudyNote[]` — 按 `chapterIndex` 再按创建时间排序；排除 `kind='highlight'` 节点；知识点带父节点名称（父为划线根时用划线原文前 30 字）
  - `getSummary(db, userId, bookId): StudySummary | null`
  - `newNotes(notes: StudyNote[], summary: StudySummary | null): StudyNote[]`
  - `writeAiResult(db, userId, bookId, doc: DocNode, sentRefs: string[], source: 'ai_generate' | 'ai_update', description: string): StudySummary` — 单事务：写/建总结、`revision + 1`、`included_refs ∪ sentRefs`、插入版本
  - `saveUserDoc(db, userId, bookId, doc: DocNode, baseRevision: number): { ok: true; summary: StudySummary } | { ok: false; reason: 'conflict' | 'busy' | 'not_found'; summary?: StudySummary }` — 有 running 任务 → busy；修订号不符 → conflict（附最新）；成功 `revision + 1`；最近一个版本为 `user` 且其 `updated_at` 距今 < 30 分钟 → 更新该版本 doc 与 updated_at，否则插入 `user` 版本（description「手动修改」）
  - `listVersions(db, userId, bookId): Array<{ id; source; description; created_at; updated_at }>`（新→旧）；`getVersion(db, userId, bookId, versionId): { id; doc; source; description; updated_at } | null`
  - `restoreVersion(db, userId, bookId, versionId, baseRevision: number): 同 saveUserDoc 的返回类型` — 用版本 doc 覆盖当前、`revision + 1`、插入 `source='restore'` 版本（description「恢复到 MM-DD HH:mm 的版本」，时间取被恢复版本的 updated_at，按服务器本地时区）；不合并进用户编辑会话；任务进行中 busy、修订号不符 conflict
  - `deleteSummary(db, userId, bookId): boolean`（连带版本；有 running 任务时返回 false）
  - `listSummaryOverview(db, userId, q?: string): Array<{ bookId; bookTitle: string | null /* 书已删除为 null */; hasSummary: boolean; themes: string[]; noteCount: number; newNoteCount: number; updatedAt: string | null; lastSource: string | null; job: SummaryJob | null }>` — 包含「有笔记」或「有总结」的书；`q` 匹配书名或 `docText`（子串、不区分大小写）；按 `updatedAt` 倒序，无总结的排后
  - `interface SummaryJob { id; book_id; kind; status; done; total; error; created_at; finished_at }`；`failStaleSummaryJobs(db): void`

- [ ] **Step 1: 写失败测试**（`:memory:` 库，建 HIGHLIGHTS_DDL、MIND_DDL、STUDY_SUMMARY_DDL 与最小 books 表）：`collectNotes excludes highlight-kind nodes and orders by chapter`；`newNotes is everything not in included_refs`；`writeAiResult creates summary, bumps revision, unions refs and adds a version`；`saveUserDoc rejects stale revision with latest summary`；`saveUserDoc is busy while a job is running`；`saveUserDoc merges saves within 30 minutes into one user version`（把上个版本 updated_at 改成 31 分钟前 → 新增版本）；`versions are user-scoped`（u2 取不到 u1 的版本）；`deleteSummary removes versions and refuses while running`；`listSummaryOverview includes books with notes but no summary and deleted books with summary`（books 中无记录 → bookTitle null）；`listSummaryOverview filters by title and doc text`；`failStaleSummaryJobs marks running jobs failed`；`restoreVersion writes a restore version and keeps history`（恢复后版本数 +1、旧版本仍在、当前 doc 等于被恢复版本）；`restoreVersion rejects stale revision and running job`。
- [ ] **Step 2: 运行确认失败** `cd backend && npx jest tests/services/study-summary.test.ts`
- [ ] **Step 3: 实现** → PASS；接入 `db.ts` 两处；`npx tsc --noEmit`
- [ ] **Step 4: 提交** `git commit -m "feat: 学习总结存储、版本与并发保护"`

### Task 5: 后台任务

**Files:**
- Create: `backend/src/services/summary-job.ts`
- Test: `backend/tests/services/summary-job.test.ts`

**Interfaces:**
- Consumes: Task 2–4；`aiManager.chat`
- Produces:
  - `startSummaryJob(db, userId, bookId, bookTitle: string, kind: 'generate' | 'update'): { job: SummaryJob; started: boolean } | { error: 'no_notes' | 'no_new_notes' | 'has_summary' }` — 同用户同书已有 running → 返回该任务、`started:false`；`generate` 在已有总结时 → `has_summary`（已有总结只能更新，我的决定：避免重新生成冲掉用户修改）；在内存里异步执行（不 await），立即返回
  - `getCurrentJob(db, userId, bookId): SummaryJob | null`（最近一个）
  - 执行流程：`generate` = 第一批 `buildGeneratePrompt` → `buildDoc`，其余批作为更新 `appendAdditions`；`update` = 每批 `buildUpdatePrompt`（主题列表取当时的累积文档）→ `appendAdditions`；每批完成 `done + 1`；全部成功后**一次** `writeAiResult`（description：生成「初版，N 个主题」；更新「新增 K 条到『主题A』『主题B』」，新主题「新建主题『X』」）；任一批失败 → 任务 failed、error 为可读原因（AI 输出无法解析 →「AI 返回的内容无法解析，请重试」；其余 → AI 错误信息前 200 字），不写入
  - 测试用 `jest.mock('../../src/ai/ai-manager')` 控制 `chat` 返回

- [ ] **Step 1: 写失败测试**：`generate writes one doc and one version after all batches`（3 批，chat 被调 3 次，版本 1 条，source ai_generate）；`update appends only and keeps existing nodes`；`same book job is not started twice`；`a failing batch fails the job and writes nothing`（第 2 批抛错 → revision 不变、版本数不变、included_refs 不变）；`refs not sent to AI are not marked included`（maxNotes 设小、模拟中途失败）；`generate refuses when summary exists`；`no_new_notes when nothing new`。
- [ ] **Step 2: 运行确认失败** `cd backend && npx jest tests/services/summary-job.test.ts`
- [ ] **Step 3: 实现** → PASS（测试里用可 await 的 `waitJob(jobId)` 辅助，或导出 `runSummaryJob` 供测试直接 await；startSummaryJob 内部调用它）
- [ ] **Step 4: 提交** `git commit -m "feat: 学习总结后台生成与追加更新任务"`

### Task 6: API 路由与文档

**Files:**
- Create: `backend/src/routes/study-summary.ts`
- Modify: `backend/src/index.ts`（`api.use('/study', studySummaryRoutes)`）、`docs/api.md`（新增「学习总结（学习版）」一节）
- Test: `backend/tests/services/study-ref.test.ts`

**Interfaces:**
- Consumes: Task 4、5；`listMindNodesWithLater`（判断后文）；`findReadableBook` 同等逻辑（书或文件不存在时 later=false、canOpen=false）
- Produces（全部 `authMiddleware`，前缀 `/api/study`）：
  - `GET /summaries?q=` → `listSummaryOverview`
  - `GET /books/:bookId/summary?format=json|blocks|markdown` → `{ summary: StudySummary | null, bookTitle: string | null, noteCount, newNoteCount, job: SummaryJob | null }`；`format=blocks` 时 `summary.doc` 换成 `summary.blocks`（`docToBlocks`）；`format=markdown` 时换成 `summary.markdown`（`docToMarkdown`，refLabel 用 `resolveRef` 拼「书名 第 N 章」，章节标题按需取一次该书目录，取不到用「第 N 章」；已删除笔记写「原笔记已删除」）；其他 format 值 422
  - `POST /books/:bookId/summary/versions/:versionId/restore` body `{ revision }` → 200 summary；409 / 404 同 PUT
  - `PUT /books/:bookId/summary` body `{ doc, revision }`（zod；`isValidDoc`；JSON 体积 ≤ 2MB）→ 200 summary；409 `BUSINESS_CONFLICT`（`data` 为最新 summary，message「总结已在别处更新」或「正在整理中，请稍后再改」）；404
  - `DELETE /books/:bookId/summary` → 200 / 404 / 409（任务进行中）
  - `POST /books/:bookId/summary/jobs` body `{ kind: 'generate' | 'update' }` → 202 `job`（已在运行也返回 202 与该任务）；400 `AI_NOT_CONFIGURED`；422 `VALIDATION_ERROR`（「这本书还没有笔记」/「没有新笔记」/「已有总结，请使用更新」）；书不存在 404（书已删除不能更新）
  - `GET /books/:bookId/summary/jobs/current` → `SummaryJob | null`
  - `GET /books/:bookId/summary/versions`、`GET /books/:bookId/summary/versions/:versionId`
  - `GET /books/:bookId/refs/:ref` → `resolveRef(db, userId, book | null, ref)`：`{ exists: false }` 或 `{ exists: true, type: 'highlight' | 'node', text: string /* 划线原文或「名称：摘要」，≤ 200 字 */, target: { highlight: string } | { chapter: number; find?: string }, later: boolean, canOpen: boolean }`
  - `resolveRef` 放在 `backend/src/services/study-summary.ts` 并导出（纯数据库 + 可选 `listMindNodesWithLater`）

- [ ] **Step 1: 写失败测试** `study-ref.test.ts`：`resolveRef returns highlight target`；`resolveRef returns chapter+find for node with source`；`resolveRef falls back to chapter_index for node without source`；`resolveRef reports exists=false for deleted or others' notes`；`resolveRef canOpen=false when book is missing`。
- [ ] **Step 2: 运行确认失败** `cd backend && npx jest tests/services/study-ref.test.ts`
- [ ] **Step 3: 实现** `resolveRef` → PASS；实现路由（模式同 `routes/reader.ts`：zod 校验、`successResponse` / `errorResponse`）；挂载；写 `docs/api.md`
- [ ] **Step 4: 验证** `cd backend && npx jest && npx tsc --noEmit`；用数据副本起开发后端（见 memory「开发实测步骤」），curl 走一遍（同时经 `/api` 与 `/api/v1`）：列表 → 创建任务（未配置 AI 时 400）→ 轮询任务 → 读取三种 format → 保存（旧修订号 409、非白名单节点 422）→ 版本列表 → 恢复 → 引用解析。`docs/api.md` 写明：文档节点白名单与示例、blocks 结构、任务状态值与轮询流程（建议间隔 2 秒）、修订号与 409 处理、引用标识格式。
- [ ] **Step 5: 提交** `git commit -m "feat: 学习总结 API 与文档"`

### Task 7: 前端 API、类型与文档工具

**Files:**
- Create: `frontend/src/api/study.ts`、`frontend/src/types/study.ts`、`frontend/src/utils/summary-doc.ts`
- Modify: `frontend/package.json`（Tiptap 三个包，精确版本）
- Test: `frontend/src/utils/summary-doc.test.ts`

**Interfaces:**
- Produces:
  - `types/study.ts`：`DocNode`、`StudySummary`、`SummaryJob`、`SummaryOverview`、`SummaryVersion`、`ResolvedRef`（字段同 Task 4/6）
  - `studyApi`：`listSummaries(q?)`、`getSummary(bookId)`、`saveSummary(bookId, doc, revision)`、`deleteSummary(bookId)`、`startJob(bookId, kind)`、`currentJob(bookId)`、`listVersions(bookId)`、`getVersion(bookId, id)`、`resolveRef(bookId, ref)`
  - `studyApi` 另含 `getSummaryMarkdown(bookId)`（`format=markdown`）、`restoreVersion(bookId, versionId, revision)`
  - `countThemes(doc: DocNode): number`
  - `SOURCE_LABEL: Record<'ai_generate' | 'ai_update' | 'user' | 'restore', string>` = `{ ai_generate: 'AI 生成', ai_update: 'AI 补充', user: '我', restore: '恢复' }`

- [ ] **Step 1:** 安装依赖：`cd frontend && npm install @tiptap/vue-3@2.11.5 @tiptap/starter-kit@2.11.5 @tiptap/pm@2.11.5 --save-exact`（若该版本在源上不存在，选源上 2.x 最新的、发布超过两周的同一版本号，三个包一致）
- [ ] **Step 2: 写失败测试**：`countThemes counts top-level h2`（Markdown 导出在后端，前端不重复实现）。
- [ ] **Step 3: 运行确认失败** `cd frontend && npx vitest run src/utils/summary-doc.test.ts`
- [ ] **Step 4: 实现** → PASS；`npx vue-tsc --noEmit`
- [ ] **Step 5: 提交** `git commit -m "feat: 学习总结前端 API 与类型"`

### Task 8: 编辑器组件与原文引用

**Files:**
- Create: `frontend/src/utils/note-ref-extension.ts`、`frontend/src/components/SummaryEditor.vue`
- Test: `frontend/src/utils/note-ref-extension.test.ts`

**Interfaces:**
- Consumes: Task 7 `DocNode`
- Produces:
  - `NoteRef`：Tiptap `Node.create({ name: 'noteRef', inline: true, group: 'inline', atom: true, selectable: true })`，属性 `ref`；渲染为 `<span class="note-ref" data-ref="…">📖</span>`；`parseHTML` 只认 `span.note-ref[data-ref]`，且粘贴进来的 HTML 中的 noteRef 被丢弃（不能手写伪造：粘贴规则 `transformPastedHTML` 去掉 `data-ref`）
  - `SummaryEditor.vue` props：`modelValue: DocNode`、`readonly: boolean`；emits：`update:modelValue(doc)`、`ref-click(ref, el)`、`ref-hover(ref, el)`；工具栏：加粗、斜体、H2、H3、无序列表、有序列表、行内代码、代码块、撤销、重做（Tabler 图标 + tooltip 中文）；手机工具栏横向滚动
- [ ] **Step 1: 写失败测试**：`noteRef round-trips JSON`（`new Editor({ extensions: [StarterKit, NoteRef], content: doc })` 后 `getJSON()` 等于输入）；`pasted html cannot create noteRef`。
- [ ] **Step 2: 运行确认失败** `cd frontend && npx vitest run src/utils/note-ref-extension.test.ts`
- [ ] **Step 3: 实现** → PASS；再实现 `SummaryEditor.vue`
- [ ] **Step 4: 验证** `npx vitest run && npx vue-tsc --noEmit`
- [ ] **Step 5: 提交** `git commit -m "feat: 学习总结编辑器与原文引用节点"`

### Task 9: 单本总结页

**Files:**
- Create: `frontend/src/views/StudySummary.vue`
- Modify: `frontend/src/router/index.ts`（`/book/:bookId/summary`，`requiresAuth`）

**Interfaces:**
- Consumes: Task 7、8

- [ ] **Step 1: 页面骨架与状态**：顶栏「← 返回」、标题「<书名> · 学习总结」（书已删除显示「书已不存在」标签）、「修改记录」、「导出」、「更新（N 条新笔记）」（N=0 禁用，tooltip「没有新笔记」）、更多菜单「删除总结」。无总结：空状态「还没有学习总结。AI 会根据这本书的 N 条笔记按主题整理。」+「生成总结」；没有笔记：「这本书还没有笔记，先在阅读器里划线或在学习导图里添加知识点。」
- [ ] **Step 2: 后台任务**：点生成/更新 → `startJob`（400/422 用 `ElMessage` 显示后端 message）→ 每 2 秒轮询 `currentJob` 直到 done/failed；进度条文案「正在整理 {done}/{total} 批…」；期间编辑器只读；done → 重新 `getSummary`；failed → 显示 error 与「重试」。页面加载时若有 running 任务直接进入轮询；离开页面停止轮询。
- [ ] **Step 3: 自动保存与冲突**：编辑后防抖 1500ms 调 `saveSummary(doc, revision)`；状态「保存中… / 已保存 HH:mm / 保存失败，重试」；409 → 用返回的最新 summary 覆盖编辑器并 `ElMessage.warning(后端 message)`；离开页面前若有未保存改动立即保存一次（`onBeforeRouteLeave` + `beforeunload` 提示）。
- [ ] **Step 4: 修改记录**：宽屏右侧 300px 面板 / 手机底部抽屉；条目：时间（`MM-DD HH:mm`，用户版本显示 `updated_at`）、来源标签（`SOURCE_LABEL`）、description；点「查看此版本」→ 只读 `SummaryEditor` 对话框（标题「<时间> 的版本」），对话框内「恢复此版本」→ 确认「当前内容会被这个版本替换，替换前的内容仍保留在修改记录里。确定恢复吗？」按钮「恢复」→ `restoreVersion`；409 处理同保存；任务进行中按钮禁用。`SOURCE_LABEL` 增加 `restore: '恢复'`。
- [ ] **Step 5: 原文引用**：hover（手机长按）→ `resolveRef` 后 `el-popover` 显示 text（缓存同一 ref 的结果）；click → `exists=false` 提示「原笔记已删除」；`canOpen=false` 提示「书已不存在，无法打开原文」；`later` → 确认（Global Constraints 文案）；然后 `router.push({ path: '/reader/' + bookId, query: target })`。
- [ ] **Step 6: 导出与删除**：导出 → `getSummaryMarkdown` 下载 `safeFileName(书名) + '-学习总结.md'`（复用 `utils/book-map.ts` 的 `safeFileName`）；删除 → 确认「删除后总结与全部修改记录都会删除，笔记本身不受影响。确定删除吗？」，按钮「删除总结」。
- [ ] **Step 7: 验证** `npx vitest run && npx vue-tsc --noEmit && npx vite build`
- [ ] **Step 8: 提交** `git commit -m "feat: 学习总结页（生成、更新、编辑、修改记录、去原文、导出）"`

### Task 10: 入口页与各处入口

**Files:**
- Create: `frontend/src/views/StudyNotes.vue`
- Modify: `frontend/src/router/index.ts`（`/notes`）、`frontend/src/layouts/DefaultLayout.vue`（navItems 在「书架」后加 `{ path: '/notes', label: '学习总结', icon: IconNotebook }`）、`frontend/src/views/BookDetail.vue`（「学习导图」旁加「学习总结」）、`frontend/src/views/BookMap.vue`（工具栏加「学习总结」）

- [ ] **Step 1: 入口页**：搜索框（防抖 300ms 调 `listSummaries(q)`）、排序「最近更新 / 书名」；卡片：书名（书已删除「书已不存在」）、`{themes.length} 个主题 · {noteCount} 条笔记 · {MM-DD} 更新（{SOURCE_LABEL}）`、主题标签最多 5 个、「有 N 条新笔记未整理」徽标；按钮：有总结「打开总结」（+ 有新笔记且书存在时「更新」），无总结「生成总结」；进行中的任务显示「整理中…」并禁用按钮。「更新」「生成总结」点击后跳到总结页并自动开始任务（`?start=update|generate`，总结页读取后用 `router.replace` 去掉参数）。空状态：「还没有任何笔记。在阅读器里划线、或在学习导图里添加知识点后，这里就能生成学习总结。」
- [ ] **Step 2: 入口按钮**：书籍详情、学习导图页加「学习总结」→ `/book/:bookId/summary`。
- [ ] **Step 3: 验证** `npx vitest run && npx vue-tsc --noEmit && npx vite build`
- [ ] **Step 4: 提交** `git commit -m "feat: 学习总结入口页、侧栏与书籍详情/导图入口"`

### Task 11: 整体验收

- [ ] **Step 1:** 后端 `npx jest && npx tsc --noEmit`；前端 `npx vitest run && npx vue-tsc --noEmit && npx vite build`。
- [ ] **Step 2:** 开发服务器 + 数据副本 + 已配置的 AI（用户的 DeepSeek 等，key 不写进任何文件）在 Chrome 实测：生成（进度、刷新后仍见进度）、编辑自动保存、两个标签页冲突提示、加新笔记后更新只追加、修改记录与查看 / 恢复版本、📖 悬停与跳转（含后文确认、已删除笔记）、导出 Markdown、删除总结、入口页搜索与徽标、手机 390 宽。
- [ ] **Step 3:** `docker compose up -d --build`（本机 `.env` 用国内源），请用户验收；更新 `tasks/todo.md` 与 CHANGELOG「Unreleased-study」。
