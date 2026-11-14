# AI 查证（多轮搜索认书）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 填充（单本预览 + 批量）在初步填充后进入多轮查询循环：AI 自己决定搜什么、打开条目核对、确认豆瓣书目，再据此给出书名 / 作者建议、封面、评分、改编作品。

**Architecture:** 新模块 `services/book-lookup-agent.ts` 是纯循环（依赖注入 chat 与四个搜索函数，便于测试）；`services/book-lookup.ts` 接上真实依赖、开关、节流与兜底，返回统一的 `LookupOutcome`。预览与批量都只调用 `lookupBook`。协议是每轮 AI 只回一个 JSON 动作，三个插件都只用现有 `chat()`。

**Tech Stack:** Node.js + Express + TypeScript + better-sqlite3 + jest；Vue 3 + Element Plus + vitest。

**Spec:** `docs/superpowers/specs/2026-11-13-ai-lookup-agent-design.md`

## Global Constraints

- 在 `main` 上开发，每个任务提交到 `main`；全部完成后合并进 `study`。提交信息结尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 上限：每本最多 **8 次操作**，其中认书阶段最多 **5 次**；连续 **2 次**无法解析的回答 → 结束循环走兜底。
- 每轮请求用 `aiManager.chat(prompt, db, { reasoningEffort: 'low' })`。
- AI 只能引用已出现过的编号（豆瓣书 `B1…`、影视 `M1…`、猫耳 `D1…`，整个循环内唯一）；封面、评分、改编只来自程序实际取回的数据。
- 写入规则不变：批量只自动写空字段且非 low；书名只进待确认；锁定字段不动；错标时全部进待确认。
- 作者：保留国籍前缀（如「[英] J.R.R.托尔金」），去掉译者；豆瓣原文写进 evidence。
- 开关 settings 键 `ai_lookup_enabled`，值 `'0'` 为关，缺省或其他值为开（默认开）。关闭 = 走兜底。
- 不升级 `AI_FILL_VERSION`。
- 所有外部请求走主机白名单（`request(url, headers, 4, allowHost)`）；批量时外部请求排队、最小间隔 3000ms（与改编检索共用同一条队列）。
- 发给 AI 的条目详情只保留作者、译者、出版社、年份、简介前 150 字；每个候选一行。
- 前端颜色只用主题变量；图标用 Tabler；不在视图里直接调 axios。
- 本地实测：数据库副本，起后端加 `USAGE_STATS=off`。

## Review Focus

- AI 回答带 ```json 代码块或前后夹杂文字 → 仍能解析（用 `extractJsonObject`）。由 Task 2 测试覆盖。
- AI 在认书阶段直接发 `search_movie`，或在改编阶段又发 `confirm_book` → 视为无效回答（计入连续解析失败），不崩溃。由 Task 2 测试覆盖。
- 搜索函数抛错 / 超时 → 这一步记为「0 条（出错）」继续循环，不终止整本。由 Task 2 测试覆盖。
- 同一本书同时被两个预览请求查证（双击）→ 进度互不污染，后一次覆盖前一次即可，接口不报错。由 Task 4 测试覆盖。
- 豆瓣条目页结构变了，解析不到作者 → `open_book` 结果只显示能解析出的字段，确认仍以联想结果里的作者为准。由 Task 1 测试覆盖。

---

### Task 1: 豆瓣书目检索与条目页解析；外部请求共用节流

**Files:**
- Modify: `backend/src/utils/cover.ts`
- Create: `backend/src/utils/external-throttle.ts`
- Modify: `backend/src/services/adaptations.ts`（`throttledSearch` 改用共用节流）
- Create: `backend/tests/fixtures/douban-subject-lotr.html`（用真实 https://book.douban.com/subject/<魔戒某版本>/ 页面裁剪出 `#info`、`#link-report`、`rating_num`、`#db-tags-section` 部分）
- Test: `backend/tests/utils/cover.test.ts`、`backend/tests/utils/external-throttle.test.ts`

**Interfaces:**
- Produces:
  - `export interface DoubanBookHit { title: string; author?: string; year?: string; pic?: string; url: string }`（只含书条目，`pic` 为 book-default 时省略）
  - `export function parseDoubanBookHits(json: string, limit = 10): DoubanBookHit[]`
  - `export async function searchDoubanBooks(query: string): Promise<DoubanBookHit[]>`（出错抛出，由调用方记录）
  - `export interface DoubanSubjectDetail { author?: string; translator?: string; publisher?: string; year?: string; intro?: string; tags: string[]; rating?: number }`
  - `export function parseDoubanSubjectDetail(html: string): DoubanSubjectDetail`
  - `export async function fetchDoubanSubjectDetail(url: string): Promise<DoubanSubjectDetail>`（url 必须过 `isAllowedDoubanSubjectUrl`，否则抛错）
  - `export function throttled<T>(fn: () => Promise<T>, intervalMs = 3000): Promise<T>` 与 `export function _resetExternalThrottle(): void`（`external-throttle.ts`）

- [ ] **Step 1: 写失败测试**
  - `parseDoubanBookHits`：混入作者条目（type `a`）被过滤；book-default 封面的条目保留但没有 `pic`；`limit` 生效；非 JSON 返回 `[]`。
  - `parseDoubanSubjectDetail(fixture)`：`author` 含「托尔金」；`publisher`、`year` 非空；`intro.length <= 150`；`tags` 非空；`rating` 为数字。
  - `parseDoubanSubjectDetail('<html></html>')` → `{ tags: [] }`（其余字段 undefined，不抛错）。
  - `throttled`：连续三次调用，第二、三次开始时间与前一次间隔 ≥ `intervalMs`（用 jest fake timers）；前一个抛错不阻塞后一个。
- [ ] **Step 2: 运行** `cd backend && npx jest tests/utils/cover.test.ts tests/utils/external-throttle.test.ts` → FAIL（函数不存在）
- [ ] **Step 3: 实现上述函数**；`searchDoubanBooks` 复用 `fetchDoubanSuggest`（已有，私有）。`adaptations.ts` 的 `throttledSearch` 改为 `throttled(() => searchCandidates(title), ADAPTATION_SEARCH_INTERVAL_MS)`，`_resetAdaptationThrottle` 内部调用 `_resetExternalThrottle`。
- [ ] **Step 4: 运行** 上面两个测试 + `npx jest tests/services/adaptations.test.ts` → PASS
- [ ] **Step 5: 提交** `feat: 豆瓣书目检索与条目页解析，外部检索共用节流`

### Task 2: 查证循环（纯逻辑）

**Files:**
- Create: `backend/src/services/book-lookup-agent.ts`
- Test: `backend/tests/services/book-lookup-agent.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `DoubanBookHit`、`DoubanSubjectDetail`；`AdaptationCandidate`（`utils/adaptation-sources.ts`）；`Adaptation`、`ADAPTATION_TYPES`、`looksLikeShortDrama`（`services/adaptations.ts`）；`extractJsonObject`。
- Produces:
  - `export interface LookupInput { fileName: string; embedded?: string; title: string; author?: string; bookType?: string; summary?: string; mismatchReason?: string }`
  - `export type LookupStep = { kind: 'search_book' | 'search_movie' | 'search_drama'; query: string; count: number; error?: boolean } | { kind: 'open_book'; id: string; label: string } | { kind: 'confirm_book'; id: string; label: string; why?: string } | { kind: 'no_book'; why?: string } | { kind: 'pick_adaptations'; count: number } | { kind: 'invalid' }`
  - `export interface ConfirmedBook { hit: DoubanBookHit; title: string; author?: string; doubanAuthor?: string; why?: string; detail?: DoubanSubjectDetail }`
  - `export interface LookupDeps { chat(prompt: string): Promise<string>; searchBook(q: string): Promise<DoubanBookHit[]>; openBook(url: string): Promise<DoubanSubjectDetail>; searchMovie(q: string): Promise<AdaptationCandidate[]>; searchDrama(q: string): Promise<AdaptationCandidate[]>; onStep?(steps: LookupStep[]): void }`
  - `export interface LookupAgentResult { status: 'ok' | 'failed'; confirmed?: ConfirmedBook; noBook: boolean; seenBooks: DoubanBookHit[]; adaptations: Adaptation[]; steps: LookupStep[] }`（`failed` = 连续两次无效回答或 chat 抛错，调用方走兜底；次数用完不算 failed，只是该阶段无结果）
  - `export const LOOKUP_LIMITS = { total: 8, identify: 5 }`
  - `export function parseLookupAction(raw: string, phase: 'identify' | 'adapt', known: Set<string>): LookupAction | null`
  - `export function normalizeDoubanAuthor(raw: string): string`
  - `export async function runBookLookup(input: LookupInput, deps: LookupDeps): Promise<LookupAgentResult>`

- [ ] **Step 1: 写失败测试**（deps 全部用 jest.fn 假实现）
  - `parseLookupAction`：识别 8 种动作（见 spec「每一轮的协议」）；identify 阶段只接受 `search_book / open_book / confirm_book / no_book`，adapt 阶段只接受 `search_movie / search_drama / pick_adaptations / done`；`open_book` / `confirm_book` 引用未知编号 → `null`；`pick_adaptations` 里未知编号被丢弃、已知的保留；带代码块包裹的 JSON 能解析；`search_*` 的 query 去空白后为空 → `null`。
  - `normalizeDoubanAuthor('[英] J.R.R.托尔金 / 丁棣 译')` → `'[英] J.R.R.托尔金'`；`'刘慈欣'` → `'刘慈欣'`；`'[美] 乔治·R.R.马丁 著'` → `'[美] 乔治·R.R.马丁'`。
  - 「魔戒全集」场景：chat 依次返回 search_book「魔戒全集」→ search_book「魔戒」→ open_book B1 → confirm_book B1（title「魔戒全集」author「[英] J.R.R.托尔金 / 丁棣 译」）→ search_movie「指环王」→ pick_adaptations [M1] types {M1:"电影"} → done。searchBook 第一次返回 `[]`、第二次返回 1 条。期望：`status 'ok'`，`confirmed.hit.url` 为该条，`confirmed.author === '[英] J.R.R.托尔金'`，`confirmed.doubanAuthor` 保留原文，`adaptations[0].type === '电影'`，steps 依次为 search_book(0)、search_book(1)、open_book、confirm_book、search_movie、pick_adaptations。
  - 认书阶段第 5 次操作后仍未确认 → 进入改编阶段，`confirmed` 为空、`noBook` 为 false；总操作数不超过 8（第 9 次 chat 不会被调用）。
  - `no_book` → `noBook: true`，随后照常进入改编阶段。
  - 连续两次无效回答 → `status 'failed'`；一次无效后接有效回答 → 计数清零、继续。
  - searchBook 抛错 → step `{ kind: 'search_book', count: 0, error: true }`，循环继续。
  - `onStep` 每完成一步被调用一次，参数是到目前为止的全部 steps。
  - 发给 chat 的 prompt 中：每个候选一行且带编号；条目详情的简介不超过 150 字；含 `fileName`、`title`、`author`。
- [ ] **Step 2: 运行** `npx jest tests/services/book-lookup-agent.test.ts` → FAIL
- [ ] **Step 3: 实现**。提示词要点（措辞由实现者定）：你在帮图书管理员核实这本书是豆瓣上的哪一本；可以换说法、用原名 / 别名 / 加作者搜；套装 / 全集搜不到时试单书名或系列名；确认前比对作者，必要时 open_book 看出版信息；`confirm_book` 的 `title` 填这个文件在书库里应显示的书名（套装保留整套名、去营销语），`author` 按「保留国籍、不含译者」；网络小说豆瓣常没有条目，搜一两次没有就 `no_book`；只回一个 JSON。改编阶段沿用 `buildAdaptationPrompt` 的规则文字（类型、短剧、同名排除），候选行格式与之相同但用 `M/D` 编号。每轮 prompt = 规则 + 书的信息 + 历史（每步一行 + 该步结果的候选行）。
- [ ] **Step 4: 运行** 同上 → PASS
- [ ] **Step 5: 提交** `feat: AI 查证循环（多轮搜索认书、挑改编）`

### Task 3: 接上真实依赖、开关、节流与兜底

**Files:**
- Create: `backend/src/services/book-lookup.ts`
- Test: `backend/tests/services/book-lookup.test.ts`

**Interfaces:**
- Consumes: Task 1、Task 2 全部导出；`doubanSuggestList`、`doubanFallbackQuery`（cover.ts，已有）；`findAdaptations`；`aiManager.chat`。
- Produces:
  - `export function isLookupEnabled(db: Database.Database): boolean`（`ai_lookup_enabled !== '0'`）
  - `export interface LookupOutcome { confirmed?: ConfirmedBook & { rating?: number }; noBook: boolean; coverCandidates: DoubanCandidate[]; adaptations: Adaptation[]; steps: LookupStep[]; usedFallback: boolean }`
  - `export async function lookupBook(input: LookupInput, db: Database.Database, opts?: { throttle?: boolean; onStep?: (steps: LookupStep[]) => void }): Promise<LookupOutcome>`
- 规则：
  - 开关关 → 直接兜底。兜底 = 现有行为：`doubanSuggestList(title)`（搜不到时 `doubanFallbackQuery` 重试，已在其中）+ `findAdaptations({ title, author, summary }, db, { throttle })`；`confirmed` 为空，`usedFallback: true`。
  - 开关开 → `runBookLookup`；`status 'failed'` → 兜底（steps 保留已发生的部分）。
  - `coverCandidates`：已确认条目（有 pic）排第一，其余 `seenBooks` 中带 pic 的按出现顺序，去重，最多 6 个；转成 `DoubanCandidate`（`subjectUrl` = hit.url）。
  - 确认后：若 `confirmed.detail?.rating` 已有则直接用，否则不额外请求（评分由预览 apply / 批量写入时取）。
  - `throttle: true` 时四个搜索函数和 `openBook` 都包在 `throttled(...)` 里。

- [ ] **Step 1: 写失败测试**（`jest.mock` cover / adaptation-sources / adaptations / ai-manager / book-lookup-agent 视需要）
  - 开关 `'0'` → 不调用 `runBookLookup`，调用 `doubanSuggestList` 与 `findAdaptations`，`usedFallback: true`。
  - 开关缺省、agent 返回 ok + confirmed → `coverCandidates[0].subjectUrl === confirmed.hit.url`，没有调用 `doubanSuggestList`。
  - agent 返回 failed → 走兜底，`steps` 与 agent 返回的一致。
  - `throttle: true` 时 searchBook 经过 `throttled`（mock `external-throttle` 断言被调用）。
- [ ] **Step 2: 运行** `npx jest tests/services/book-lookup.test.ts` → FAIL
- [ ] **Step 3: 实现**
- [ ] **Step 4: 运行** → PASS
- [ ] **Step 5: 提交** `feat: 查证接入真实检索、开关与兜底`

### Task 4: 单本预览接入查证（书名栏、进度、过程）

**Files:**
- Modify: `backend/src/services/ai-fill-preview.ts`
- Create: `backend/src/services/lookup-progress.ts`
- Modify: `backend/src/routes/library.ts`（新路由）
- Test: `backend/tests/services/ai-fill-preview.test.ts`、`backend/tests/services/lookup-progress.test.ts`、`backend/tests/routes/`（沿用现有 library 路由测试文件的写法，若无则新建 `lookup-progress-route.test.ts`）

**Interfaces:**
- Consumes: Task 3 `lookupBook`、`LookupStep`。
- Produces:
  - `LockableField` 改为 `'title' | 'author' | 'summary' | 'category'`（`LOCKABLE` 同步加 `title`）。
  - `AiFillPreview.suggested.title?: string`；`AiFillPreview.lookupTrace: LookupStep[]`；`AiFillPreview.lookupUsedFallback: boolean`。
  - `lookup-progress.ts`：`setLookupProgress(bookId: string, steps: LookupStep[]): void`、`getLookupProgress(bookId: string): { steps: LookupStep[]; done: boolean } | null`、`finishLookupProgress(bookId: string): void`（标记 done，60 秒后删除）、`startLookupProgress(bookId: string): void`（清空并开始）。
  - 路由 `GET /api/library/:id/ai-fill/progress`（`authMiddleware, adminMiddleware`）→ `{ steps, done }`；没有记录时 `{ steps: [], done: false }`。
- 合并规则（`buildAiFillPreview`）：
  - `lookupBook` 输入：`fileName` = 文件名，`embedded` = evidence 中的内置信息，`title` = 错标时 `contentMismatch.title`，否则 AI 书名或清洗书名；`author` 同理；`mismatchReason` 错标时给。
  - 已确认且非错标：`suggested.title` = `confirmed.title`（与当前书名去掉空白、书名号后不同时才给），`confidence.title = 'high'`，`evidence.title` / `evidence.author` = 「豆瓣：《{hit.title}》{doubanAuthor} {year}」+（有 why 时）「；{why}」；`confirmed.author` 存在时覆盖 `suggested.author`，`confidence.author = 'high'`。
  - 已确认且错标：`contentMismatch.title` / `author` 用确认结果，`reason` 末尾追加豆瓣依据；不给 `suggested.title`。
  - `coverCandidates` 书封部分改用 `outcome.coverCandidates`；改编用 `outcome.adaptations`（海报仍按现有 `ADAPTATION_COVER_LIMIT` 排在书封后）。
  - 调用前 `startLookupProgress`，`onStep` → `setLookupProgress`，结束（含异常）`finishLookupProgress`。

- [ ] **Step 1: 写失败测试**
  - mock `lookupBook` 返回 confirmed（title「魔戒全集」author「[英] J.R.R.托尔金」），当前书名「魔戒全集 精校版」→ `suggested.title === '魔戒全集'`、`confidence.title === 'high'`、`evidence.author` 含「豆瓣」；当前书名「魔戒全集」→ 没有 `suggested.title`。
  - 错标 + confirmed → 没有 `suggested.title`，`contentMismatch.title` 为确认书名。
  - `lookupTrace` 等于 outcome.steps；`lookupUsedFallback` 透传。
  - `lockedFields` 能包含 `'title'`（书的 manually_edited_fields 含 title 时）。
  - lookup-progress：start → set → get 返回步骤；finish 后 `done: true`，推进 60 秒（fake timers）后 `getLookupProgress` 为 null；同一本书再次 start 会清空旧步骤。
  - 路由：非管理员 403；有进度时返回步骤。
- [ ] **Step 2: 运行** 相关测试 → FAIL
- [ ] **Step 3: 实现**
- [ ] **Step 4: 运行** → PASS；`npx tsc --noEmit` 通过
- [ ] **Step 5: 提交** `feat: 单本 AI 填充预览接入查证，新增书名建议与进度接口`

### Task 5: 采用书名（单本 apply 与待确认页）

**Files:**
- Modify: `backend/src/services/ai-fill-apply.ts`
- Modify: `backend/src/services/ai-suggestions.ts`
- Test: `backend/tests/services/ai-fill-apply.test.ts`、`backend/tests/services/ai-fill-apply-schema.test.ts`、`backend/tests/routes/ai-suggestions.test.ts`

**Interfaces:**
- Consumes: Task 4 的 `LockableField`（含 title）。
- Produces:
  - `AiFillApplyInput.title?: string`、`suggested.title?: string`；schema `title: z.string().trim().min(1).max(200).optional()`，`FIELD_LABELS.title = '书名'`。`LOCKABLE` 加 `title`，但书名与其他字段不同：**只要书名被改了就锁定**（不论是否等于 AI 建议，spec「单本预览的书名栏」），书名未变则不动锁定状态。
  - `FillSuggestField` 改为包含 `'title'`；`FILL_SUGGEST_FIELDS` 仍为 `['author','summary','category']`（批量比对不自动生成书名），书名建议由 Task 6 显式写入 `data.fields.title`。
  - 采纳待确认：勾选 title 时，错标判定存在 → 现有 `acceptContentMismatch`；否则 `data.fields.title` 存在 → 作为 `input.title` 交给 `applyAiFill`。列表接口里错标书名仍优先于 `data.fields.title`。
- [ ] **Step 1: 写失败测试**：apply 带 title 且等于 suggested.title → 书名更新且锁定；带不同的 title → 更新且锁定；title 与当前书名相同 → 不更新、锁定状态不变；title 为空串 → 422「书名」；待确认采纳 `fields.title`（无错标）→ 书名更新；有错标时仍按正文书名。
- [ ] **Step 2: 运行** → FAIL
- [ ] **Step 3: 实现**
- [ ] **Step 4: 运行** → PASS
- [ ] **Step 5: 提交** `feat: AI 填充可采用书名建议`

### Task 6: 批量填充接入查证

**Files:**
- Modify: `backend/src/services/ai-batch-fill.ts`
- Test: `backend/tests/services/ai-batch-fill.test.ts`（新增 `jest.mock('../../src/services/book-lookup')`；原有断言 `doubanSuggest` / `findAdaptations` 的用例改为通过 mock 的 `lookupBook` 返回兜底结果来表达）

**Interfaces:**
- Consumes: Task 3 `lookupBook(input, db, { throttle: true })`；Task 5 的 `data.fields.title`；`downloadCoverFromPic`、`fetchRating`（cover.ts）。
- 流程改动（在现有 `fillBookInfo` 之后）：
  1. `fillBookInfo`（passA / passB 逻辑不变）后、作者不一致判失败之前调用 `lookupBook`。输入同 Task 4（错标时查正文那本）。
  2. 作者判定：若 `fillStatus === 'failed'` 且 `confirmed.author` 存在且 `authorsMatch(confirmed.author, knownAuthor)` → 改为 `'filled'`，`info.author = confirmed.author`。其余情况保持原判定。
  3. 已确认且非错标：`info.author` 改为 `confirmed.author`，置信度视为 high（只在当前作者为空时自动写入，与现有 `maybeSet` 一致）；确认书名与当前书名（去空白 / 书名号）不同 → `suggestion.fields.title = { value, current, confidence: 'high', evidence }`；author 建议的 evidence 用豆瓣依据。
  4. 已确认且错标：`recordContentMismatch` 用确认结果（同 Task 4 规则）。
  5. 改编：用 `outcome.adaptations`，不再单独调用 `findAdaptations`。
  6. 封面 / 评分：取 `outcome.coverCandidates[0]`；`needCover` → `downloadCoverFromPic(pic, id)`；`needRating` → `confirmed.rating ?? fetchRating({ url: subjectUrl })`。没有候选时生成默认封面（不变）。审计 `title_used` 改为实际确认的书名或输入书名。
  7. 查证中的 AI 额度 / 鉴权错误：`lookupBook` 内部 chat 抛错时 agent 返回 failed 会吞掉错误——**额度 / 鉴权错误必须向上抛**，让现有暂停逻辑处理。在 `book-lookup.ts` 的 chat 包装里用 `isQuotaError` / `isAuthError` 判断后重新抛出（补 Task 3 的一条测试）。
- [ ] **Step 1: 写失败测试**
  - 文件名作者「托尔金」、fillBookInfo 返回作者「J.R.R.托尔金」被判失败的情况下，lookup 确认作者「[英] J.R.R.托尔金」→ 不再失败，`succeeded` 含该书。
  - lookup 确认作者与文件名作者不符 → 仍失败（原有行为）。
  - 确认书名不同 → 保存的建议含 `fields.title`，`confidence 'high'`，evidence 含「豆瓣」。
  - 封面取 `coverCandidates[0].pic`，评分用 `confirmed.rating`。
  - 查证抛额度错误 → 任务暂停、该书不盖版本戳（与 fillBookInfo 额度错误同样断言）。
  - 原有批量用例全部通过。
- [ ] **Step 2: 运行** `npx jest tests/services/ai-batch-fill.test.ts tests/services/book-lookup.test.ts` → FAIL
- [ ] **Step 3: 实现**
- [ ] **Step 4: 运行** → PASS
- [ ] **Step 5: 提交** `feat: 批量 AI 填充接入查证`

### Task 7: 开关与费用估算（后端 + 设置页）

**Files:**
- Modify: `backend/src/services/cost-estimator.ts`
- Modify: `frontend/src/views/Settings.vue`（AI 设置区，放在「填充并发」附近）
- Modify: `frontend/src/utils/ai-settings.ts`（若保存逻辑在此）
- Test: `backend/tests/services/cost-estimator.test.ts`、`frontend/src/utils/ai-settings.test.ts`

**Interfaces:**
- Produces:
  - `export const LOOKUP_CALLS_PER_BOOK = 4`（实测后可调，变动写进 CHANGELOG）
  - `EstimateInput.lookup: boolean`；`estimateCalls` 开启时 `fill = books_to_fill * (1 + LOOKUP_CALLS_PER_BOOK)`；`estimateFromCurrentDb` 读 `isLookupEnabled(db)`。
  - 设置页：开关「AI 查证」，说明文字「AI 填充时多轮搜索豆瓣，核对书名、作者后再取封面、评分和改编；会增加 AI 调用次数」。保存为 `ai_lookup_enabled = '1' | '0'`，读取时缺省视为开。
- [ ] **Step 1: 写失败测试**：`estimateCalls({ ai_fill: true, books_to_fill: 10, lookup: true }).fill === 50`；`lookup: false` → 10；前端读取缺省为开、`'0'` 为关。
- [ ] **Step 2: 运行** 后端 jest + `cd frontend && npx vitest run src/utils/ai-settings.test.ts` → FAIL
- [ ] **Step 3: 实现**
- [ ] **Step 4: 运行** → PASS
- [ ] **Step 5: 提交** `feat: AI 查证开关与费用估算`

### Task 8: 前端预览对话框（书名栏、进度、查证过程）

**Files:**
- Modify: `frontend/src/types/index.ts`（`AiFillPreview`、`AiFillApplyInput`、`AiFillLockableField` 加 title；新增 `LookupStep` 类型，与后端一致）
- Modify: `frontend/src/api/library.ts`（`aiFillProgress(id: string)`；`aiFillPreview` 超时改为 300000）
- Modify: `frontend/src/views/BookDetail.vue`（等待期间每 1500ms 轮询进度，传给对话框；预览返回或取消即停止）
- Modify: `frontend/src/components/AiFillPreviewDialog.vue`
- Modify: `frontend/src/utils/ai-fill-form.ts`（`buildApplyPayload` 带 title）
- Test: `frontend/src/utils/ai-fill-form.test.ts`；新增 `frontend/src/utils/lookup-step-text.ts` + `lookup-step-text.test.ts`

**Interfaces:**
- Produces:
  - `export function lookupStepText(step: LookupStep): string`：
    - `search_book` → `搜豆瓣书「{query}」→ {count} 条`（error 时 `→ 出错`）
    - `search_movie` → `搜豆瓣影视「{query}」→ {count} 条`；`search_drama` → `搜猫耳「{query}」→ {count} 条`
    - `open_book` → `打开 {label}`；`confirm_book` → `确认：{label}`（有 why 加 `（{why}）`）
    - `no_book` → `豆瓣没有这本书`（有 why 加 `（{why}）`）；`pick_adaptations` → `选出 {count} 个改编`；`invalid` → `AI 回答无法识别`
  - 对话框新增 prop `progress?: LookupStep[]`：加载中显示最后一步的 `lookupStepText`（没有时显示原加载文案）。
  - 结果区：`textFields` 最前加 `{ key: 'title', label: '书名', max: 200 }`，只在 `suggested.title` 存在时显示该行；可折叠「查证过程」列出全部步骤；`lookupUsedFallback` 为 true 时折叠标题后加「（未查证，按书名直接搜索）」。
- [ ] **Step 1: 写失败测试**：`lookupStepText` 各分支；`buildApplyPayload` 在勾选采用书名时带 `title` 与 `suggested.title`，未勾选时 title 为当前书名。
- [ ] **Step 2: 运行** `npx vitest run src/utils` → FAIL
- [ ] **Step 3: 实现**
- [ ] **Step 4: 运行** `npx vitest run && npx vue-tsc --noEmit` → PASS
- [ ] **Step 5: 提交** `feat: AI 填充预览显示查证进度与过程，可采用书名`

### Task 9: 文档、实测、合并

**Files:**
- Modify: `docs/api.md`（`GET /api/library/:id/ai-fill/progress`；预览响应新增 `suggested.title`、`lookupTrace`、`lookupUsedFallback`；apply 新增 `title`；设置项 `ai_lookup_enabled`）
- Modify: `CHANGELOG.md`（`[Unreleased]` 下 `### 新增`：AI 查证；`### 修复` 中 83564c0 那条改写为「搜不到时的兜底」或并入新增条目；说明不会自动重跑已填充的书，可用「重置全部填充记录」）
- Commit: 设计文档 `docs/superpowers/specs/2026-11-13-ai-lookup-agent-design.md` 与本计划

- [ ] **Step 1: 全量检查** `cd backend && npx tsc --noEmit && npx jest`；`cd frontend && npx vue-tsc --noEmit && npx vitest run` → 全部通过（jest 偶发超时的用例单独重跑确认）
- [ ] **Step 2: 本地实测**（数据库副本、`USAGE_STATS=off`、真实 AI key）：单本预览《魔戒全集》（确认托尔金、有封面 / 评分 / 电影改编、过程可展开、进度在跳）；三体全集（确认整套条目）；一本网络小说（no_book，1～2 次搜索即结束）；一本错标书（错标提示用确认结果）；关闭开关后预览显示「未查证」；批量 5 本（节流间隔 ≥3 秒、批次计数正确、待确认有书名建议）。记录每本的 AI 调用次数，据此确认 `LOOKUP_CALLS_PER_BOOK`。
- [ ] **Step 3: 提交文档** `docs: AI 查证设计、计划、API 与更新日志`
- [ ] **Step 4: 合并** `git checkout study && git merge --no-edit main`；`grep -rn '^<<<<<<<\|^>>>>>>>' .` 无结果；study 上跑一遍 jest / vitest
- [ ] **Step 5: 更新** `tasks/todo.md` 与进度记忆
