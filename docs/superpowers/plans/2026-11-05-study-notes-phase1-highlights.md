# 学习笔记 第一期：划线与批注 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 阅读器里选中文字即可划线、写批注；划线在章节翻页 / 瀑布流两种模式下都正确显示；新增「笔记」列表可跳回原文。

**Architecture:** 后端新增 `highlights` 表 + 纯函数 service（注入 db，便于内存库测试）+ `reader.ts` 里 4 个薄路由。前端用「章节正文纯文本中的全局字符偏移」做锚点（`start_offset`/`end_offset` + 原文 `text` 校验），渲染后用 `<mark class="hl">` 包裹文本节点；锚点算法与 DOM 包裹放在独立 util 里用 happy-dom 测试，Reader.vue 只做接线。

**Tech Stack:** Express + better-sqlite3 + zod + Jest（后端）；Vue 3 + Element Plus + Vitest + happy-dom（前端，happy-dom 为本期新增 devDependency）。

**Spec:** `docs/superpowers/specs/2026-11-05-study-notes-mindmap-design.md`（本计划只实现「分期 1. 划线与批注」）

## Global Constraints

- 所有笔记数据按 `user_id` 私有；每个查询/修改都带 `user_id = req.user!.userId` 条件。
- API 响应沿用 `{ success, code, data }`（`successResponse` / `errorResponse`），路由都挂 `authMiddleware`；同一组路由自动出现在 `/api/v1`，需在 `docs/api.md` 补文档。
- 支持格式：TXT / EPUB / UMD。PDF（`isPdf` 或 `isPdfRender`）不出现划线菜单。
- 「摘抄」不单独建模：划线保存原文即摘抄。
- 本期选区菜单只有「划线」「批注」；「AI 展开」属第二期，不做。
- 批注内容一律以文本插值显示（`{{ }}`），禁止 `v-html`。
- 限制：划线原文 1–1000 字；批注 ≤ 2000 字；空字符串批注存为 `NULL`。
- 删除带批注的划线需二次确认（用户偏好：危险操作二次确认）；无批注的直接删除。
- 生命周期同书签：书删除 / 用户删除时清理（`relation-cleanup.ts`）。
- 回复与界面文案用中文。

## Review Focus

1. **跨段落选区**：一次选中横跨 2–3 个段落 → 每个段落里被选中的部分都被包裹，段落结构不被破坏（Task 3 测试 `wraps a range spanning several paragraphs`）。
2. **重复渲染 / 切换设置**：改字号、主题、切换翻页 / 瀑布流、瀑布流加载新章节后，划线不丢也不被重复嵌套（Task 3 测试 `is idempotent`；Task 4 在所有正文渲染点调用 `refreshHighlights`）。
3. **原文变化**（书文件被替换、编码修复、章节标题覆盖导致开头不同）→ 偏移对不上时按原文重新定位；找不到则不显示且不报错，从笔记列表跳转时提示「原文已变化」（Task 3 `locateHighlight` 测试；Task 5 跳转提示）。
4. **无效选区**：选中首尾空白、只选到图片、跨两章（瀑布流）、从章节标题区开始的选区 → 去掉首尾空白；空选区不出菜单；跨章 / 正文外选区不出菜单（Task 3 `rangeToAnchor` 测试）。
5. **与已有划线重叠**：新选区与已有划线重叠 → 提示「与已有划线重叠」，不创建（Task 3 `overlaps` 测试，Task 4 接线）。

---

### Task 1: 后端 highlights 表与 service

**Files:**
- Modify: `backend/src/db.ts`（在 `ai_recaps` 建表的 `exec` 之后追加）
- Modify: `backend/src/types/index.ts`（新增 `Highlight`）
- Create: `backend/src/services/highlights.ts`
- Modify: `backend/src/services/relation-cleanup.ts`
- Test: `backend/tests/services/highlights.test.ts`、`backend/tests/services/relation-cleanup.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // types/index.ts
  export interface Highlight {
    id: string; user_id: string; book_id: string; chapter_index: number;
    start_offset: number; end_offset: number; text: string; note: string | null;
    created_at: string; updated_at: string;
  }
  // services/highlights.ts
  export interface NewHighlight { chapterIndex: number; startOffset: number; endOffset: number; text: string; note?: string }
  export function listHighlights(db: Database.Database, userId: string, bookId: string): Highlight[]   // ORDER BY chapter_index, start_offset
  export function createHighlight(db: Database.Database, userId: string, bookId: string, input: NewHighlight): Highlight
  export function updateHighlightNote(db: Database.Database, userId: string, bookId: string, id: string, note: string | null): Highlight | null  // 不存在/非本人 → null；'' → NULL；刷新 updated_at
  export function deleteHighlight(db: Database.Database, userId: string, bookId: string, id: string): boolean
  export const HIGHLIGHTS_DDL: string   // 建表 + 索引 SQL，db.ts 与测试共用
  ```

- [ ] **Step 1: 写失败测试** `backend/tests/services/highlights.test.ts`：内存库 `new Database(':memory:')` 执行 `HIGHLIGHTS_DDL`。
  - `creates and lists in reading order`：u1/b1 依次创建 (ch2, 0–4)、(ch0, 10–12)、(ch0, 3–5) → `listHighlights` 返回章节/偏移顺序 `[[0,3],[0,10],[2,0]]`；`note` 为 `null`；`id` 非空。
  - `is private per user and per book`：u1/b1、u2/b1、u1/b2 各一条 → `listHighlights(db,'u1','b1')` 长度 1。
  - `updates note, empty string clears it`：设 `'项羽本纪开篇'` → 返回对象 `note === '项羽本纪开篇'`；再设 `''` → `note === null`。
  - `cannot touch other users' rows`：u2 对 u1 的 id 调 `updateHighlightNote` → `null`；`deleteHighlight` → `false`；u1 删除 → `true` 后列表为空。
- [ ] **Step 2: 运行确认失败** `cd backend && npx jest tests/services/highlights.test.ts` → FAIL（模块不存在）。
- [ ] **Step 3: 实现** `services/highlights.ts` 与 `HIGHLIGHTS_DDL`：
  ```sql
  CREATE TABLE IF NOT EXISTS highlights (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, book_id TEXT NOT NULL,
    chapter_index INTEGER NOT NULL, start_offset INTEGER NOT NULL, end_offset INTEGER NOT NULL,
    text TEXT NOT NULL, note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_highlights_user_book ON highlights(user_id, book_id);
  ```
  id 用 `crypto.randomUUID()`。`db.ts` 在 `initSchema` 中 `database.exec(HIGHLIGHTS_DDL)`。
- [ ] **Step 4: 清理** `relation-cleanup.ts`：`'highlights'` 加入 `BOOK_RELATION_TABLES` 与 `USER_RELATION_TABLES`；`relation-cleanup.test.ts` 的 `makeDb` 加 `CREATE TABLE highlights (id TEXT, user_id TEXT, book_id TEXT)` 并插入同样的 u/b 行，把 `'highlights'` 加进两个断言的表名列表。
- [ ] **Step 5: 运行** `cd backend && npx jest tests/services/highlights.test.ts tests/services/relation-cleanup.test.ts` → PASS。
- [ ] **Step 6: 提交** `git commit -m "feat: highlights 表与服务（划线/批注存储）"`

### Task 2: 后端路由 + API 文档 + 前端 API 客户端

**Files:**
- Modify: `backend/src/routes/reader.ts`（放在 bookmarks 路由之后）
- Modify: `docs/api.md`（在 bookmarks 小节之后新增「划线与批注」小节）
- Modify: `frontend/src/types/index.ts`、`frontend/src/api/reader.ts`

**Interfaces:**
- Consumes: Task 1 的 service 函数。
- Produces（HTTP，均需登录）：
  - `GET /api/reader/:bookId/highlights` → `Highlight[]`
  - `POST /api/reader/:bookId/highlights` body `{ chapterIndex, startOffset, endOffset, text, note? }` → 201 `Highlight`；书不存在 404 `RESOURCE_NOT_FOUND`（同 bookmarks 的存在性检查）
  - `PATCH /api/reader/:bookId/highlights/:id` body `{ note: string | null }` → `Highlight`；不存在 404
  - `DELETE /api/reader/:bookId/highlights/:id` → `null`；不存在 404
  - zod：`chapterIndex` int ≥0；`startOffset` int ≥0；`endOffset` int > `startOffset`（`.refine`）；`text` 1–1000；`note` ≤2000 可 null。失败 422 `VALIDATION_ERROR`。
- Produces（前端）：
  ```ts
  // types/index.ts — 字段同后端 Highlight
  export interface Highlight { id: string; user_id: string; book_id: string; chapter_index: number; start_offset: number; end_offset: number; text: string; note: string | null; created_at: string; updated_at: string }
  // api/reader.ts 的 readerApi 新增
  getHighlights(bookId: string)
  createHighlight(bookId: string, body: { chapterIndex: number; startOffset: number; endOffset: number; text: string; note?: string })
  updateHighlightNote(bookId: string, id: string, note: string | null)
  deleteHighlight(bookId: string, id: string)
  ```

- [ ] **Step 1: 实现路由**（薄层：校验 → 调 service → `successResponse`）。
- [ ] **Step 2: 写 `docs/api.md` 小节**，格式照抄 bookmarks 小节（路径写 `/api/v1/...`，列出请求体字段与限制）。
- [ ] **Step 3: 前端类型与 API 客户端**。
- [ ] **Step 4: 验证** `cd backend && npx tsc --noEmit && npm test` → 全绿；`cd frontend && npm run typecheck` → 无错误。再启动后端 `npm run dev`，用 admin 登录拿 token 后 curl：POST 一条 → 201；GET → 含该条；PATCH note → 返回新 note；`endOffset ≤ startOffset` → 422；DELETE → 200，再 DELETE → 404。
- [ ] **Step 5: 提交** `git commit -m "feat: 划线/批注 API 与文档"`

### Task 3: 前端锚点与渲染工具（纯逻辑 + DOM）

**Files:**
- Modify: `frontend/package.json`（devDependencies 加 `happy-dom`，`npm i -D happy-dom`）
- Create: `frontend/src/utils/highlight-anchor.ts`
- Test: `frontend/src/utils/highlight-anchor.test.ts`（文件首行 `// @vitest-environment happy-dom`）

**Interfaces:**
- Produces:
  ```ts
  export interface TextAnchor { start: number; end: number }   // 在 content.textContent 中的 [start, end)
  /** 选区 → 锚点；去首尾空白；选区不完全在 content 内、或去空白后为空 → null */
  export function rangeToAnchor(content: HTMLElement, range: Range): { anchor: TextAnchor; text: string } | null
  /** 存储的偏移若仍对应 text 则原样返回；否则在 fullText 中找 text，取离原 start 最近的一处；找不到 → null */
  export function locateHighlight(fullText: string, stored: TextAnchor & { text: string }): TextAnchor | null
  export function overlaps(a: TextAnchor, b: TextAnchor): boolean   // 半开区间，相邻不算重叠
  /** 先清除 content 内已有的 mark.hl，再按 items 包裹；每段文本节点包成 <mark class="hl" data-hl-id="…">，有批注的加 class "has-note" */
  export function applyHighlights(content: HTMLElement, items: Array<{ id: string; anchor: TextAnchor; hasNote: boolean }>): void
  export function clearHighlights(content: HTMLElement): void       // 拆掉 mark.hl 并 normalize()
  ```
  `rangeToAnchor` 的起点偏移：建一个 `selectNodeContents(content)` 的 Range，`setEnd(range.startContainer, range.startOffset)`，取 `toString().length`；`text = range.toString()`，再按首尾空白长度调整 start/end。

- [ ] **Step 1: 写失败测试**（fixture：`<p>项羽者，下相人也。</p><p>字羽。初起时，年二十四。</p><p>其季父项梁。</p>`，`textContent` 即三段直接相连）
  - `rangeToAnchor maps a selection inside one paragraph`：选中「下相人」→ `{ anchor: {start:4,end:7}, text:'下相人' }`。
  - `rangeToAnchor trims whitespace and rejects empty / outside ranges`：前后带空格的 `<p>  ab  </p>` 选全段 → text `'ab'` 且偏移跳过前导空格；只选空白 → `null`；起点在 content 外的元素 → `null`。
  - `locateHighlight keeps a matching offset, relocates a shifted one, and gives up`：原样 → 相同锚点；`fullText` 前面多出 3 个字 → start 后移 3；`text` 已不存在 → `null`；text 出现两次时取离原 start 近的一处。
  - `overlaps`：`[0,5)` vs `[5,8)` → false；`[0,5)` vs `[4,8)` → true；包含关系 → true。
  - `wraps a range spanning several paragraphs`：锚点「下相人也。字羽」→ 两个 `mark.hl[data-hl-id="h1"]`，分别在第 1、2 个 `<p>` 内，`<p>` 数量仍为 3，`content.textContent` 不变。
  - `is idempotent`：同一 items 调用两次 → `mark.hl` 数量不变、无嵌套 mark；`clearHighlights` 后无 mark，`textContent` 不变。
  - `marks notes`：`hasNote: true` 的 mark 带 `has-note` class。
- [ ] **Step 2: 运行确认失败** `cd frontend && npx vitest run src/utils/highlight-anchor.test.ts` → FAIL。
- [ ] **Step 3: 实现** `highlight-anchor.ts`（`applyHighlights` 用 `TreeWalker(SHOW_TEXT)` 累计偏移，对与锚点相交的文本节点 `splitText` 后包裹）。
- [ ] **Step 4: 运行** 同上 → PASS；`npm run typecheck` 无错误。
- [ ] **Step 5: 提交** `git commit -m "feat: 划线锚点定位与渲染工具"`

### Task 4: 阅读器接线：选区菜单、渲染划线、批注与删除

**Files:**
- Modify: `frontend/src/composables/useReader.ts`（照 bookmarks 的模式加 highlights 状态与方法）
- Create: `frontend/src/components/HighlightMenu.vue`
- Modify: `frontend/src/views/Reader.vue`

**Interfaces:**
- Consumes: Task 2 的 `readerApi.*Highlight*`，Task 3 的全部导出。
- Produces（useReader 返回值新增）：
  ```ts
  highlights: Ref<Highlight[]>
  loadHighlights(): Promise<void>                                    // 打开书时与 bookmarks 一起加载
  addHighlight(chapterIndex: number, anchor: TextAnchor, text: string, note?: string): Promise<Highlight>
  setHighlightNote(id: string, note: string | null): Promise<void>
  removeHighlight(id: string): Promise<void>
  ```
  ```ts
  // HighlightMenu.vue
  props: { x: number; y: number; mode: 'new' | 'existing'; hasNote: boolean }
  emits: 'highlight' | 'note' | 'delete' | 'close'
  // mode 'new'：按钮「划线」「批注」；mode 'existing'：「写批注」/「编辑批注」（随 hasNote）、「删除划线」
  ```
  Reader.vue 内部：`refreshHighlights(): void` —— 对每个 `.chapter-content`（翻页模式取当前章；瀑布流取父 `section[data-chapter-index]`）用 `locateHighlight` 定位本章划线后调用 `applyHighlights`。

- [ ] **Step 1: useReader 状态与方法**；打开书时调用 `loadHighlights()`。
- [ ] **Step 2: HighlightMenu.vue**：绝对定位浮层，显示在选区 / 被点击的 mark 上方，点击外部或滚动时 emit `close`；样式沿用阅读器 `side-tool` 的配色变量，暗色主题可读。
- [ ] **Step 3: Reader.vue 渲染**：在当前章内容渲染完成、瀑布流追加章节、`highlights` 变化之后（`nextTick` 后）调用 `refreshHighlights()`；`mark.hl` 样式：浅黄底（夜间模式用半透明暖色），`has-note` 再加虚线下划线。
- [ ] **Step 4: 选区 → 菜单**：在 `.chapter-content` 上监听 `pointerup`（含触屏），`window.getSelection()` 非折叠时用 `rangeToAnchor(当前所在 .chapter-content, range)`；为 null（含跨章、正文外、PDF）则不显示。与本章已有划线 `overlaps` → `ElMessage.warning('与已有划线重叠')`。超过 1000 字 → `ElMessage.warning('一次最多划 1000 字')`。
  - 「划线」→ `addHighlight`，清空选区。
  - 「批注」→ `ElMessageBox.prompt`（`inputType: 'textarea'`，标题「写批注」，确认按钮「保存批注」，`inputValidator` 限 2000 字）后 `addHighlight(..., note)`。
- [ ] **Step 5: 点击已有划线**：`handleContentClick` 中先判断 `closest('mark.hl')`，命中则以 `mode: 'existing'` 打开菜单（链接跳转逻辑保持不变）。编辑批注用同一个 prompt（预填原批注，按钮「保存批注」）；「删除划线」：有批注时 `ElMessageBox.confirm('删除后批注也会一起删除，确定删除这条划线吗？', '删除划线', { confirmButtonText: '删除划线', type: 'warning' })`，无批注直接删除。
- [ ] **Step 6: PDF 不出菜单**：`isPdf || isPdfRender` 时跳过 Step 4 的监听逻辑。
- [ ] **Step 7: 验证** `cd frontend && npm test && npm run typecheck` → 全绿；前后端 `npm run dev`，在浏览器中逐条检查 Review Focus 1、2、4、5：跨段划线、改字号/主题/切模式后划线仍在且无重复、只选空白无菜单、重叠提示；刷新页面后划线与批注仍在。
- [ ] **Step 8: 提交** `git commit -m "feat: 阅读器划线与批注"`

### Task 5: 「笔记」列表与跳回原文

**Files:**
- Modify: `frontend/src/views/Reader.vue`（目录层 `toc-layer` 增加第三个页签）
- Create: `frontend/src/utils/highlight-list.ts`
- Test: `frontend/src/utils/highlight-list.test.ts`

**Interfaces:**
- Consumes: `highlights`（Task 4）、现有 `jumpToChapter(index)`、`reader.chapters`。
- Produces:
  ```ts
  // highlight-list.ts
  export interface HighlightGroup { chapterIndex: number; chapterTitle: string; items: Highlight[] }
  export function groupHighlightsByChapter(list: Highlight[], chapters: Array<{ index: number; title: string }>): HighlightGroup[]
  // 章节升序、组内 start_offset 升序；章节不存在时标题为「第 N 章」（N = index + 1）
  ```

- [ ] **Step 1: 写失败测试** `groups and orders by chapter then offset`、`falls back to 第 N 章 for unknown chapters`。
- [ ] **Step 2: 运行确认失败** `cd frontend && npx vitest run src/utils/highlight-list.test.ts`。
- [ ] **Step 3: 实现** `groupHighlightsByChapter`。
- [ ] **Step 4: 运行** → PASS。
- [ ] **Step 5: 页签与列表**：`tocTab` 类型扩为 `'toc' | 'bookmark' | 'note'`，`openToc` 同步；页签文字「笔记」，状态栏「N 条笔记」；顶栏与侧边工具栏各加一个「笔记」入口（图标 `IconHighlight`，若该版本没有则用 `IconNotes`；tooltip「笔记」）。每条显示划线原文（最多 3 行省略）与批注（文本插值）；空列表文案「还没有划线。选中正文文字即可划线或写批注」。
- [ ] **Step 6: 跳转**：点击条目 → 关闭层 → `jumpToChapter(chapter_index)` → `nextTick` + `refreshHighlights()` 后查找 `mark.hl[data-hl-id="<id>"]`，找到则 `scrollIntoView({ block: 'center' })` 并短暂闪烁高亮；找不到 → `ElMessage.warning('原文已变化，无法定位这条划线')`（Review Focus 3）。
- [ ] **Step 7: 验证** `npm test && npm run typecheck && npm run build` → 通过；浏览器中：在两章各划线 → 笔记页签按章分组 → 点击跳到对应位置并居中；改一条划线的原文（临时在 DB 里把 `text` 改成不存在的词）→ 点击出现「原文已变化」提示且不报错。
- [ ] **Step 8: 提交** `git commit -m "feat: 笔记列表与跳回原文"`

### Task 6: 整体验收

- [ ] **Step 1:** `cd backend && npm test && npx tsc --noEmit`；`cd frontend && npm test && npm run typecheck && npm run build` → 全部通过，记录测试数量。
- [ ] **Step 2:** `docker compose up -d --build`，访问 http://localhost:8080：分别用一本 TXT 和一本 EPUB 走完「划线 → 批注 → 编辑批注 → 删除（带批注时有确认）→ 笔记列表跳转」；手机宽度（DevTools 375px）下选区菜单可点、不被遮挡；PDF 书无划线菜单。
- [ ] **Step 3:** 把结果（通过项 / 发现的问题）报告给用户，等待验收后再进入第二期计划。
