# 学习笔记 第二期：AI 展开知识小图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对任一划线点「AI 展开」，得到以它为中心的候选知识节点（事件/概念/人物），可保留、继续展开、跳回原文出处（全书检索，后文加标记）；保留的节点按划线存成小树。

**Architecture:** 后端新增三块纯逻辑 + 一个编排：`book-text`（整书段落文本，LRU 缓存）、`mind-source`（出处检索与「后文」判定）、`mind-expand`（提示词构建 / JSON 解析 / 编排：阅读边界→上下文→缓存→AI→出处）、`mind-nodes`（保留链、列表、删除子树）。前端新增 `MindExpandPanel.vue`（电脑右侧抽屉 / 手机底部面板）+ 纯函数 `mind-tree.ts`（合并已保留节点与本次候选成树、取祖先链），Reader.vue 只做接线。

**Tech Stack:** Express + better-sqlite3 + zod + Jest；Vue 3 + Element Plus + Vitest（happy-dom 已在第一期加入）。

**Spec:** `docs/superpowers/specs/2026-11-05-study-notes-mindmap-design.md`（本计划实现「分期 2. AI 展开小图」）。第一期（划线与批注）已在分支 `feat/study-notes-phase1` 完成并验收，本期在同一分支继续。

## Global Constraints

- 所有数据按 `user_id` 私有（`ai_expansions` 缓存除外：跨用户共享，不含个人数据）。
- 只有用户点击「AI 展开」/「继续展开」/「重新生成」才调用 AI；只在 AI 已配置（Reader.vue 现有 `aiReady`）时显示 AI 入口。
- AI 调用一律 `aiManager.chat(prompt, db)`，输出先经 `cleanAiText`（去 `<think>`）。
- 每次展开返回 5–8 个候选，`kind` 只能是 `event` / `concept` / `person`，每个附一句话 `summary`。解析失败 → 422 `AI_BAD_OUTPUT`，文案「AI 返回格式不正确，请重试」，不写任何数据。
- **防剧透**：阅读边界 = max(该用户 `reading_progress` 的 (chapter_index, paragraph_index), 划线所在 (chapter_index, 段落))；送给 AI 的原文不得超过边界。
- **出处检索**：全书检索（用户决定）；出处在边界之后的标 `later: true`，前端显示「📖 后文·<章节名>」弱化样式；之前的显示「📖 <章节名>」。出处由系统检索，不让 AI 给章节。
- **缓存键**：(book_id, 中心词, 划线所在 chapter_index)；不含用户路径；「重新生成」= `force: true` 覆盖缓存。
- **保留**：未保留的候选只在前端面板状态里；保留一个深层候选时自动连同到划线根节点的祖先链一起保留（服务端 find-or-create，幂等）。
- 布局（用户决定）：宽屏右侧抽屉，`max-width: 768px` 时底部面板（半屏，可展开全屏）。
- 删除划线时一并删除其导图节点；有批注或有导图节点时删除前确认，文案「删除后批注和导图节点也会一起删除，确定删除这条划线吗？」，按钮「删除划线」。
- 本期不做：总导图画布、节点手动新增/改名/写批注（第三期）、出题复习（第四期）。
- API 响应 `{ success, code, data }`；路由挂 `authMiddleware`；补 `docs/api.md`、`docs/development.md`。UI 文案中文。前端测试用 `npx vitest run`（`npm test` 是 watch 模式）。

## Review Focus

1. **剧透边界**：读者进度在第 3 章，划线在第 3 章第 2 段、该章还有第 3–6 段 → 发给 AI 的文本不含第 3 段及之后、也不含第 4 章及之后（Task 3 测试 `never sends text beyond the reading boundary`）。
2. **AI 输出脏**：带 `<think>`、```json 代码块、前后说明文字、kind 非法、重复 label、label 等于中心词或路径上的词 → 能解析的保留、非法的丢弃；一个都不剩 → `AI_BAD_OUTPUT`（Task 3 `parseExpandResult` 测试）。
3. **出处找不到 / 大书**：label 在全书不出现 → `source: null`、不显示 📖；3000 章的书第二次展开不再重读文件（Task 1 缓存测试）。
4. **重复保留**：同一条祖先链保留两次、或兄弟节点共享祖先 → 不产生重复节点（Task 4 `keepChain is idempotent`）。
5. **删除级联**：删划线 → 其导图节点全删；删中间节点 → 子树全删；删书/删用户 → 清理（Task 4 测试）。

---

### Task 1: 整书段落文本与出处检索

**Files:**
- Create: `backend/src/services/book-text.ts`、`backend/src/services/mind-source.ts`
- Test: `backend/tests/services/book-text.test.ts`、`backend/tests/services/mind-source.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // book-text.ts
  export interface ChapterParas { index: number; title: string; paragraphs: string[] }
  /** 读取整书各章段落（复用 ai-reading.ts 的 chapterParagraphs）；按 book.id + file_path 做 LRU 缓存，容量 2 本 */
  export async function getBookText(book: Book): Promise<ChapterParas[]>
  export function clearBookTextCache(): void   // 测试用
  // mind-source.ts
  export interface Position { chapterIndex: number; paragraphIndex: number }
  export interface Source extends Position { chapterTitle: string }
  /** 选出处章节：① 章节标题包含 label 的最早一章；② 否则 label 出现次数最多的章，平局取较早；段落 = 该章首次出现的段落。全书不出现 → null。label 去首尾空白，长度 < 2 → null */
  export function findSource(chapters: ChapterParas[], label: string): Source | null
  export function isAfter(a: Position, b: Position): boolean   // 先比章再比段，严格大于
  ```

- [ ] **Step 1: 写失败测试** `book-text.test.ts`（照 `ai-reading-run.test.ts` 的 `jest.mock` 插件写法）：`reads every chapter into paragraphs`（2 章 HTML → paragraphs 正确、title 正确）；`caches per book`（同一本调用两次，`getChapterContent` 只被调 N 次）；`evicts least recently used beyond 2 books`。
- [ ] **Step 2: 写失败测试** `mind-source.test.ts`，fixture：0「项羽本纪」(段：项羽者下相人也 / 韩信亡楚归汉)、1「高祖本纪」(韩信 ×1)、2「淮阴侯列传」(韩信 ×3，第 2 段首次出现)、3「刺客列传」：
  - `prefers a chapter whose title contains the label`：`项羽` → `{chapterIndex:0, paragraphIndex:0, chapterTitle:'项羽本纪'}`。
  - `otherwise picks the chapter with most occurrences`：`韩信` → chapter 2, paragraphIndex 1。
  - `ties go to the earlier chapter`；`returns null when absent or label shorter than 2`。
  - `isAfter`：(2,0) vs (1,9) → true；(1,3) vs (1,3) → false；(1,2) vs (1,3) → false。
- [ ] **Step 3: 运行确认失败** `cd backend && npx jest tests/services/book-text.test.ts tests/services/mind-source.test.ts`。
- [ ] **Step 4: 实现**两个文件。
- [ ] **Step 5: 运行** → PASS；`npx tsc --noEmit` 干净。
- [ ] **Step 6: 提交** `git commit -m "feat: 整书段落文本缓存与知识点出处检索"`

### Task 2: 导图节点与展开缓存的存储

**Files:**
- Create: `backend/src/services/mind-nodes.ts`
- Modify: `backend/src/db.ts`、`backend/src/services/relation-cleanup.ts`、`backend/src/services/highlights.ts`（`deleteHighlight` 级联）
- Test: `backend/tests/services/mind-nodes.test.ts`；更新 `relation-cleanup.test.ts`、`highlights.test.ts`，以及手建 schema 的 `file-deleter-keep-file.test.ts`、`scan-walker-orphans.test.ts`（加两张表的桩）

**Interfaces:**
- Produces:
  ```ts
  export type MindKind = 'highlight' | 'event' | 'concept' | 'person' | 'custom'
  export interface MindNode {
    id: string; user_id: string; book_id: string; parent_id: string | null; chapter_index: number;
    highlight_id: string | null; label: string; kind: MindKind; summary: string | null; note: string | null;
    source_chapter: number | null; source_paragraph: number | null; sort: number; created_at: string;
  }
  export interface ChainItem { label: string; kind: Exclude<MindKind, 'highlight' | 'custom'>; summary?: string; source?: { chapterIndex: number; paragraphIndex: number } | null }
  export const MIND_DDL: string   // mind_nodes + ai_expansions 建表与索引
  export function listMindNodes(db, userId, bookId, highlightId?: string): MindNode[]   // ORDER BY sort, created_at
  /** 找到或创建划线根节点（kind 'highlight'，label = 划线原文前 30 字，parent_id null，chapter_index = 划线章节），
   *  再沿 chain 逐级「同父同 label」找或建；返回整条链（含根）。划线不存在/非本人 → null */
  export function keepChain(db, userId, bookId, highlightId: string, chain: ChainItem[]): MindNode[] | null
  export function deleteMindSubtree(db, userId, bookId, nodeId: string): number   // 返回删除条数，0 = 不存在
  export function deleteMindNodesOfHighlight(db, userId, bookId, highlightId: string): void
  ```
  ```sql
  CREATE TABLE IF NOT EXISTS mind_nodes (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, book_id TEXT NOT NULL, parent_id TEXT,
    chapter_index INTEGER NOT NULL, highlight_id TEXT, label TEXT NOT NULL, kind TEXT NOT NULL,
    summary TEXT, note TEXT, source_chapter INTEGER, source_paragraph INTEGER,
    sort INTEGER NOT NULL DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_mind_nodes_user_book ON mind_nodes(user_id, book_id);
  CREATE TABLE IF NOT EXISTS ai_expansions (
    book_id TEXT NOT NULL, center TEXT NOT NULL, chapter_index INTEGER NOT NULL,
    result TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (book_id, center, chapter_index)
  );
  ```
  `relation-cleanup`：`mind_nodes` 加入书、用户两个列表；`ai_expansions` 只加书列表。`deleteHighlight` 删除成功时同事务调用 `deleteMindNodesOfHighlight`。

- [ ] **Step 1: 写失败测试** `mind-nodes.test.ts`（内存库执行 `HIGHLIGHTS_DDL` + `MIND_DDL`，先建一条 u1 的划线）：
  - `keepChain creates root and chain`：chain `[楚汉之争(event), 鸿门宴(event)]` → 返回 3 个节点，根 `kind:'highlight'`、`parent_id:null`，后两者父子相连，`source_chapter/paragraph` 写入。
  - `keepChain is idempotent and shares ancestors`：再保留同链 → 节点总数仍 3；保留 `[楚汉之争, 刘邦(person)]` → 总数 4，刘邦的父是同一个「楚汉之争」。
  - `keepChain rejects others' highlight` → `null`。
  - `deleteMindSubtree removes descendants only`：删「楚汉之争」→ 删 3 条（楚汉之争、鸿门宴、刘邦），根仍在；u2 删 → 0。
  - `deleting a highlight removes its nodes`（`highlights.test.ts` 新增）：`deleteHighlight` 后该划线节点数 0。
- [ ] **Step 2: 运行确认失败** `cd backend && npx jest tests/services/mind-nodes.test.ts tests/services/highlights.test.ts`。
- [ ] **Step 3: 实现**；`db.ts` 在 `HIGHLIGHTS_DDL` 后 `exec(MIND_DDL)`；更新 cleanup 与相关测试桩/断言（两张表都要出现在 `relation-cleanup.test.ts` 的断言中，`ai_expansions` 只在书断言中）。
- [ ] **Step 4: 运行** `cd backend && npm test && npx tsc --noEmit` → 全绿。
- [ ] **Step 5: 提交** `git commit -m "feat: 导图节点与 AI 展开缓存存储"`

### Task 3: AI 展开编排（边界、上下文、提示词、解析、缓存、出处）

**Files:**
- Create: `backend/src/services/mind-expand.ts`
- Test: `backend/tests/services/mind-expand.test.ts`

**Interfaces:**
- Consumes: Task 1 `getBookText`、`findSource`、`isAfter`；Task 2 `MIND_DDL`（`ai_expansions`）；`highlights` 表；`reading_progress`（`chapter_index`、`paragraph_index`）；`aiManager.chat`；`cleanAiText`。
- Produces:
  ```ts
  export interface Candidate { label: string; kind: 'event' | 'concept' | 'person'; summary: string }
  export interface ExpandedCandidate extends Candidate {
    source: { chapterIndex: number; paragraphIndex: number; chapterTitle: string; later: boolean } | null
  }
  export class AiBadOutputError extends Error {}
  export function parseExpandResult(raw: string, exclude: string[]): Candidate[]   // 抛 AiBadOutputError 当结果为空
  export function buildExpandPrompt(input: {
    bookTitle: string; author?: string | null; chapterTitle: string; highlight: string;
    context: string; center: string; path: string[];
  }): string
  export async function expandHighlight(db: Database.Database, book: Book, userId: string, input: {
    highlightId: string; center?: string; path?: string[]; force?: boolean
  }): Promise<{ candidates: ExpandedCandidate[]; cached: boolean } | null>   // 划线不存在/非本人 → null
  ```
  编排规则：
  - `center` 缺省 = 划线原文（截前 30 字）；`path` = 从划线到 center 的上级 label（不含 center），用于提示词和 `exclude`。
  - 划线段落：在划线章节的段落中找包含 `highlight.text`（跨段时取其前 20 字）的段落，有多处取第一处；找不到取 0。
  - 边界 = `isAfter` 比较后较大的 (progress, 划线位置)；无进度记录时 = 划线位置。
  - 上下文 = 划线段落之前最多 3 段 + 划线段落 + 之后最多 2 段中**不超过边界**的部分；整体 `clipMiddle(…, 3000)`。
  - 缓存：`force` 为假且命中 `ai_expansions` → 用缓存的候选+出处（`later` 每次按当前用户边界重算），`cached: true`；否则调 AI、解析、对每个候选 `findSource`、`INSERT OR REPLACE` 缓存（存不含 `later` 的结果）。
  - 提示词要点（中文）：以「<center>」为中心，结合书名/章节/原文片段与上级路径发散 5–8 个相关知识点；可用自身知识；不编造原文情节；不确定的在 summary 中注明「（存疑）」；只输出 JSON 数组 `[{"label":"","kind":"event|concept|person","summary":""}]`。
  - `parseExpandResult`：去 `<think>`、去代码围栏、取第一个 `[` 到最后一个 `]` 解析；丢弃 kind 非法、label 空、label 与 exclude（含 center）相同、重复 label 的项；label/summary 去首尾空白，label 截 20 字、summary 截 80 字；最多保留 8 个。

- [ ] **Step 1: 写失败测试**（`jest.mock` ai-manager 与 plugin-manager；内存库建 highlights、reading_progress（含 paragraph_index 列）、MIND_DDL；书 6 章，第 5 章含「剧透」字样）：
  - `parseExpandResult tolerates think tags, fences and junk`、`drops invalid kinds, duplicates and excluded labels`、`throws AiBadOutputError when nothing usable`。
  - `never sends text beyond the reading boundary`：进度 (2, 1)，划线在第 2 章第 1 段 → prompt 不含第 2 章第 2 段起的文字、不含第 3 章以后文字。
  - `uses the highlight position when it is later than progress`：进度 (0,0)、划线在第 3 章 → 上下文含第 3 章划线段落。
  - `attaches sources and marks later ones`：AI 返回「梅丽莎」「剧透人物」→ 前者出处在边界前 `later:false`，后者出处在第 5 章 `later:true`；全书没有的 label → `source:null`。
  - `caches per book/center/chapter and force bypasses`：第二次同参调用不调 AI 且 `cached:true`；`force:true` 再调 AI；另一用户同参命中同一缓存但 `later` 按自己的进度计算。
  - `returns null for another user's highlight`。
- [ ] **Step 2: 运行确认失败** `cd backend && npx jest tests/services/mind-expand.test.ts`。
- [ ] **Step 3: 实现** `mind-expand.ts`。
- [ ] **Step 4: 运行** → PASS；`npx tsc --noEmit` 干净。
- [ ] **Step 5: 提交** `git commit -m "feat: AI 展开知识点（防剧透上下文、缓存、出处检索）"`

### Task 4: 路由、文档与前端 API

**Files:**
- Modify: `backend/src/routes/reader.ts`、`docs/api.md`、`docs/development.md`、`frontend/src/types/index.ts`、`frontend/src/api/reader.ts`

**Interfaces:**
- Consumes: Task 2、Task 3。
- Produces（HTTP，均需登录）：
  - `POST /api/reader/:bookId/highlights/:id/expand` body `{ center?: string(1–60), path?: string[](≤10 项，每项 ≤60), force?: boolean }` → `{ candidates: ExpandedCandidate[], cached: boolean }`；AI 未配置 400 `AI_NOT_CONFIGURED`（沿用 recap 路由的判断与文案）；划线不存在 404；`AiBadOutputError` → 422 `AI_BAD_OUTPUT`「AI 返回格式不正确，请重试」；其他 AI 错误 500 并带原因（同 recap 写法）。
  - `GET /api/reader/:bookId/mind-nodes?highlightId=` → `MindNode[]`
  - `POST /api/reader/:bookId/mind-nodes/keep` body `{ highlightId, chain: ChainItem[](1–10 项) }` → `MindNode[]`；划线不存在 404。
  - `DELETE /api/reader/:bookId/mind-nodes/:id` → `{ deleted: number }`；0 → 404。
- Produces（前端）：`types` 加 `MindNode`、`ExpandedCandidate`、`ChainItem`（字段同后端）；`readerApi.expandHighlight(bookId, highlightId, body)`、`getMindNodes(bookId, highlightId?)`、`keepMindChain(bookId, highlightId, chain)`、`deleteMindNode(bookId, id)`。

- [ ] **Step 1: 实现路由**（薄层，zod 校验，模式同 highlights 路由；expand 路由先查书存在并用 `findReadableBook`）。
- [ ] **Step 2: 文档**：`docs/api.md` 新增「AI 展开与导图节点」小节（`###` 端点标题，与书签同级）；`docs/development.md` API 列表补 4 条。
- [ ] **Step 3: 前端类型与 API 客户端**。
- [ ] **Step 4: 验证** `cd backend && npm test && npx tsc --noEmit`；`cd frontend && npm run typecheck`；启动后端 dev（临时 DATA_DIR），用 curl：未配置 AI 时 expand → 400；keep 一条链 → 返回含根节点；GET 列表；DELETE 中间节点 → `deleted` 正确，再删 → 404。
- [ ] **Step 5: 提交** `git commit -m "feat: AI 展开与导图节点 API"`

### Task 5: 前端展开面板

**Files:**
- Create: `frontend/src/utils/mind-tree.ts`、`frontend/src/utils/mind-tree.test.ts`、`frontend/src/components/MindExpandPanel.vue`

**Interfaces:**
- Consumes: Task 4 的 API 与类型。
- Produces:
  ```ts
  // mind-tree.ts
  export interface TreeNode {
    key: string;                 // 已保留：节点 id；候选：'c:' + 父 key + '/' + label
    label: string; kind: MindNode['kind']; summary: string | null;
    kept: boolean; nodeId: string | null;
    source: ExpandedCandidate['source'];   // 已保留节点由 source_chapter/paragraph 还原，chapterTitle/later 由调用方补，缺失为 null
    children: TreeNode[];
  }
  /** 已保留节点（同一划线）建树；candidates: 父 key → 本次展开的候选；与已保留子节点同 label 的候选不重复出现 */
  export function buildMindTree(kept: MindNode[], candidates: Record<string, ExpandedCandidate[]>, rootLabel: string): TreeNode
  /** 从根的子节点到 key 的 label/kind/summary/source 链，供 keepChain 使用 */
  export function chainTo(tree: TreeNode, key: string): ChainItem[]
  /** 从根到 key 的上级 label（不含 key 本身），供 expand 的 path */
  export function pathTo(tree: TreeNode, key: string): string[]
  ```
  ```ts
  // MindExpandPanel.vue
  props: { bookId: string; highlight: Highlight; chapters: Array<{ index: number; title: string }>; modelValue: boolean }
  emits: 'update:modelValue', 'jump'(payload: { chapterIndex: number; label: string })
  ```

- [ ] **Step 1: 写失败测试** `mind-tree.test.ts`：`builds kept nodes as solid tree`；`attaches candidates under their parent and hides ones already kept`；`chainTo returns labels from root child to the node`（候选在已保留节点下时，链包含已保留祖先）；`pathTo excludes the node itself`。
- [ ] **Step 2: 运行确认失败** `cd frontend && npx vitest run src/utils/mind-tree.test.ts`。
- [ ] **Step 3: 实现** `mind-tree.ts` → PASS。
- [ ] **Step 4: 实现面板**：
  - 布局：宽屏 `el-drawer` 右侧（`size="420px"`）；`max-width: 768px`（`@vueuse/core` 的 `useMediaQuery`）时 `direction="btt"`，默认 `size="55%"`，顶部把手按钮「展开全屏」/「收起」在 55% 与 100% 间切换。标题「AI 展开 · <划线前 12 字>」。
  - 打开时：`getMindNodes(bookId, highlight.id)` 载入已保留节点；若该划线还没有任何节点，自动以根为中心请求一次展开。
  - 树以缩进列表展示，按 kind 分色标签（事件/概念/人物），已保留实线、候选虚线；每个节点显示 label + summary。
  - 点节点出现操作：「保留」（仅候选，调用 `keepMindChain(chainTo(...))` 后刷新已保留节点、该候选变实线）、「继续展开」（`expandHighlight` with `center=label, path=pathTo`，结果挂到该节点下；加载中该节点显示转圈）、出处按钮（`source` 非空才显示：`later` 为假「📖 <章节名>」，为真「📖 后文·<章节名>」弱化灰色）、「删除」（仅已保留；有子节点时 `ElMessageBox.confirm('将同时删除它下面的 N 个节点，确定删除吗？', '删除节点', { confirmButtonText: '删除节点', type: 'warning' })`）。
  - 每次展开结果旁有「重新生成」（`force: true`），`cached` 为真时显示小字「来自缓存」。
  - 错误：422 显示「AI 返回格式不正确，请重试」，其他显示后端 message。
  - 已保留节点的出处：`chapterTitle` 用 props.chapters 取；`later` 不重算，统一显示「📖 <章节名>」。（我的决定：第二期不为已保留节点重算后文标记）
  - 点出处 → emit `jump`；手机布局下同时关闭面板。
- [ ] **Step 5: 验证** `cd frontend && npx vitest run && npm run typecheck && npm run build`。
- [ ] **Step 6: 提交** `git commit -m "feat: AI 展开面板（候选、保留、继续展开、出处）"`

### Task 6: 阅读器接线

**Files:**
- Modify: `frontend/src/components/HighlightMenu.vue`、`frontend/src/views/Reader.vue`

**Interfaces:**
- Consumes: Task 5 `MindExpandPanel`；第一期的 `HighlightMenu`（props `x,y,mode,hasNote,placement`）、`addHighlight`、`removeHighlight`、`jumpToChapter(index): Promise<boolean>`、`aiReady`。
- Produces：`HighlightMenu` 新 prop `aiEnabled: boolean`，新 emit `'expand'`；按钮文字「AI 展开」，`new` 与 `existing` 两种模式都有，仅 `aiEnabled` 时显示。

- [ ] **Step 1: 菜单**：加「AI 展开」按钮（图标 `IconSparkles`，与问书一致）。
- [ ] **Step 2: Reader 接线**：`new` 模式点「AI 展开」→ 先 `addHighlight`（同「划线」逻辑与校验）再打开面板；`existing` 模式直接打开该划线的面板。传 `aiEnabled = aiReady`。
- [ ] **Step 3: 跳原文**：面板 `jump` → `jumpToChapter(chapterIndex)`；为 `false` 时不处理；成功后在该章 `.chapter-content` 文本中找 `label` 首次出现处，用 Range 计算位置滚动到视口中央，并用一个临时 `<mark class="src-flash">` 包裹约 1.5 秒后移除（不得影响 `mark.hl`：插入前后不触发划线重绘的签名变化，或移除后调用 `refreshHighlights()`）。找不到 → `ElMessage.warning('原文中没有找到「<label>」')`。
- [ ] **Step 4: 删除划线确认**：有批注**或**有导图节点（打开菜单时用 `getMindNodes(bookId, id)` 的数量判断，或删除前查询一次）→ 确认文案见 Global Constraints；都没有直接删。
- [ ] **Step 5: 验证** `cd frontend && npx vitest run && npm run typecheck && npm run build`；说明能/不能手动验证的部分。
- [ ] **Step 6: 提交** `git commit -m "feat: 阅读器接入 AI 展开"`

### Task 7: 整体验收

- [ ] **Step 1:** 后端 `npm test && npx tsc --noEmit`；前端 `npx vitest run && npm run typecheck && npm run build`，记录数量。
- [ ] **Step 2:** `docker compose up -d --build` 部署分支 `feat/study-notes-phase1`，请用户浏览器验收：划线「项羽」类关键词 → AI 展开 → 保留 → 继续展开 → 📖 跳原文 / 📖 后文 → 删除节点 → 删除带节点的划线（有确认）；手机宽度下底部面板与全屏切换；AI 未配置时无入口。
