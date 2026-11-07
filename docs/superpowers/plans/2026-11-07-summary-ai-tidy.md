# 笔记整理第二期：选中文字 AI 整理成列表 / 表格 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在学习版「笔记整理」页选中一段内容，让 AI 整理成列表或表格（弹框对比后采用），表格可手动维护，可选允许 AI 补充（带标记）。

**Architecture:** 后端扩展总结文档白名单（表格节点 + `aiAdded` 标记）、新增同步的整理预览接口 `POST /study/books/:bookId/summary/tidy`（新文件 `services/summary-tidy.ts`）、学习偏好接口 `/study/prefs`、保存接口支持 `source: "ai_tidy"`。前端编辑器加 Tiptap 表格扩展与 `aiAdded` 标记，新增整理弹框组件，在 `StudySummary.vue` 接入选区 → 预览 → 采用 → 保存。

**Tech Stack:** Node.js + Express + TypeScript + better-sqlite3 + zod + jest；Vue 3 + Tiptap 2.27.3 + Element Plus + vitest（happy-dom）。

**Spec:** `docs/superpowers/specs/2026-11-07-summary-ai-tidy-design.md`（前置：`docs/superpowers/specs/2026-11-06-study-summary-design.md`）

## Global Constraints

- 只在 `study` 分支开发，不合回 main；新逻辑放独立文件，公共文件只做最少接入改动。
- 对外 API：`/api/v1` 下只加字段 / 接口，不破坏已有字段；每个接口改动同步写进 `docs/api.md`「笔记整理（学习版）」一节。
- Tiptap 表格扩展版本 `2.27.3`（`@tiptap/extension-table`、`@tiptap/extension-table-row`、`@tiptap/extension-table-header`、`@tiptap/extension-table-cell`），与现有 Tiptap 一致。前端锁文件是 `frontend/package-lock.json`，安装用 `cd frontend && npm install --save-exact=false @tiptap/extension-table@2.27.3 @tiptap/extension-table-row@2.27.3 @tiptap/extension-table-header@2.27.3 @tiptap/extension-table-cell@2.27.3`（国内源可加 `--registry=https://registry.npmmirror.com`，但提交前确认 lock 里的 resolved 地址与仓库现有一致）。
- 规模上限：每表 ≤ 8 列、≤ 200 行；每行格子数相同；格子只含 `paragraph`；`colspan`/`rowspan` 只能为 1 / null / 缺省，`colwidth` 只能为 null / 缺省；`table` 只能在 `doc` 顶层。
- 整理预览：`mode` = `list` | `table`；`columns` 2–6 个、每个 1–20 字；`content` 不含二级标题、文字 ≤ 6000 字；`description` ≤ 50 字，缺省「AI 整理」。
- 错误码：未配置 AI 400 `AI_NOT_CONFIGURED`；参数不合规 422 `VALIDATION_ERROR`；书不存在 404；AI 输出无法解析 422 `AI_BAD_OUTPUT`（文案「AI 返回的内容无法解析，请重试」）；任务进行中 409 `BUSINESS_CONFLICT`；其他 AI 错误 500。
- 版本来源新增 `ai_tidy`，标签「AI 整理」；简述如「整理成表格（3 列 5 行）」「整理成列表（6 项）」。
- 学习偏好存 `settings` 表键 `study_prefs_<userId>`（JSON），字段 `allowAiAddition`，默认 `false`；不与 `reader_prefs_*` 混用。
- AI 补充记号：AI 输出中用 `{{+…}}` 包起来的文字 → `aiAdded` 标记；开关关闭或记号不成对时去掉记号、不加标记。
- 前端颜色只用主题变量（`--accent`、`--card-*` 等，见 CLAUDE.md 设计系统），图标用 Tabler。
- UI 文案（逐字）：「AI 整理」「整理成列表」「整理成表格」「AI 整理成表格」「AI 整理成列表」「改前」「改后」「采用」「重新整理」「放弃」「请在一个主题内选择」「选中的内容太多，请分段整理」「有 N 处原文出处没有保留，可重新整理」「含 N 处 AI 补充」「AI 补充，未出自你的笔记」「去掉 AI 标记」「插入表格」「整理偏好」「整理笔记时允许 AI 补充内容」「打开后，AI 可补上笔记里没写的常识，补充的内容会带标记」；表格按钮「上方加行」「下方加行」「删除行」「左侧加列」「右侧加列」「删除列」「删除表格」。

## Review Focus

1. **选区跨越表格内部 / 只选中表格里的几个格子**：应按整张表算入（整块规则），不能只把几个格子交给 AI 再替换出残缺表格。→ Task 5 测试 `selectionBlocks expands a cell selection to the whole table`。
2. **AI 回的表格行长短不一 / 超过 8 列或 200 行**：行补空 / 截断，列超 8 截断，行超 200 截断，结果必须仍能通过 `isValidDoc`。→ Task 3 测试 `parseTidyOutput normalizes ragged and oversized tables`。
3. **采用时编辑器里有未保存的手动修改，且保存时撞上 409**：AI 结果作废、加载最新内容，不得把 AI 结果套到别人的新版本上。→ Task 8 Step 3 手动验证项（制造 409）。
4. **格子里的 `|`、换行、反引号导出 Markdown**：表格结构不能被打破。→ Task 1 测试 `docToMarkdown escapes pipes and flattens breaks in cells`。
5. **整理结果里出现选区里没有的引用（AI 编造 `[[h:xxx]]`）**：必须丢弃，只保留选区中出现过的引用。→ Task 3 测试 `parseTidyOutput drops refs not in the selection`。

---

### Task 1: 文档模型支持表格与 `aiAdded` 标记（后端）

**Files:**
- Modify: `backend/src/services/summary-doc.ts`
- Test: `backend/tests/services/summary-doc.test.ts`
- Modify: `docs/api.md`（「文档模型」小节：表格节点、`aiAdded` 标记、blocks 的 `table` 块与 `ai: true`、Markdown 输出规则，附表格 JSON 示例供第三方客户端照着改）

**Interfaces:**
- Produces:
  - `MARK_TYPES` 含 `'aiAdded'`；`NODE_TYPES` 含 `'table' | 'tableRow' | 'tableHeader' | 'tableCell'`。
  - `type Parts = Array<{ text: string; bold?: true; italic?: true; code?: true; ai?: true } | { ref: string }>`（导出 `Parts`）。
  - `DocBlock` 新增 `{ type: 'table'; header: Parts[]; rows: Parts[][] }`。
  - `export const TABLE_MAX_COLS = 8; export const TABLE_MAX_ROWS = 200;`
  - `docText(doc)` 包含表格格子文字（格子之间用空格，行之间换行）。

- [ ] **Step 1: 写失败测试**（追加到 `summary-doc.test.ts`，复用已有的 `t/p/doc/ref` 助手，新增 `cell = (...c) => ({ type: 'tableCell', content: [p(...c)] })`、`hcell`（`tableHeader`）、`row`、`table`）

```ts
it('isValidDoc accepts a top-level table with header row and aiAdded marks', () => {
  const d = doc(table(row(hcell(t('命令')), hcell(t('作用'))),
                      row(cell({ type: 'text', text: 'ls', marks: [{ type: 'code' }] }), cell({ type: 'text', text: '列目录', marks: [{ type: 'aiAdded' }] }, ref('h:1')))));
  expect(isValidDoc(d)).toBe(true);
});
it('isValidDoc rejects tables in list items, merged cells, widths, ragged rows and oversize', () => {
  // listItem 里放 table、colspan: 2、colwidth: [100]、两行格子数不同、9 列、201 行、格子里放 bulletList → 全部 false
  // colspan: 1 / rowspan: null / colwidth: null → true
});
it('docText includes table cell text', () => { /* '命令 作用\nls 列目录' 被包含 */ });
it('docToBlocks emits table blocks with header and ai flags', () => {
  // 第一行全为 tableHeader → header = 该行；否则 header: [] 且全部进 rows；aiAdded 文字片段带 ai: true
});
it('docToMarkdown renders GFM tables and marks AI additions', () => {
  // | 命令 | 作用 |\n| --- | --- |\n| `ls` | 列目录（AI 补充）（出自：…） |
});
it('docToMarkdown escapes pipes and flattens breaks in cells', () => {
  // 格子文字 'a|b' → 'a\\|b'；hardBreak → 空格；结果每行 | 数量 = 列数 + 1
});
```

- [ ] **Step 2: 运行确认失败** — `cd backend && npx jest tests/services/summary-doc.test.ts`，预期新用例 FAIL。

- [ ] **Step 3: 实现**
  - `CHILDREN` 增加：`doc` 允许 `table`；`table: {tableRow}`；`tableRow: {tableHeader, tableCell}`；`tableHeader/tableCell: {paragraph}`；`NON_EMPTY` 加这四种。
  - `ATTR_RULES`：`tableHeader`/`tableCell` 的 `colspan`、`rowspan` → `ok: v => v === 1, nullable: true`；`colwidth` → `ok: () => false, nullable: true`。
  - 在 `isValidDocUnsafe` 的 `check` 里，对 `table` 额外校验：行数 ≤ `TABLE_MAX_ROWS`、每行格子数相同且 ≤ `TABLE_MAX_COLS`。
  - `inlineParts` 识别 `aiAdded` → `ai: true`；`toFlatBlocks` 加 `table` 分支；`partsToMd` 中 `ai` 片段在文字后追加「（AI 补充）」；表格 Markdown：表头行（无表头时用空表头 `|  |  |` 行）+ `| --- |` 分隔 + 数据行，格子内 `\n` → 空格（`escapeMd` 已转义 `|`）。

- [ ] **Step 4: 运行通过** — 同上命令，全部 PASS；再跑 `npx jest tests/services` 确认一期用例不回归。

- [ ] **Step 5: 更新 `docs/api.md` 文档模型小节并提交**

```bash
git add backend/src/services/summary-doc.ts backend/tests/services/summary-doc.test.ts docs/api.md
git commit -m "feat(study): 笔记整理文档支持表格与 AI 补充标记"
```

---

### Task 2: 学习偏好接口 + 保存接口支持 `ai_tidy` 来源（后端）

**Files:**
- Create: `backend/src/services/study-prefs.ts`
- Modify: `backend/src/services/study-summary.ts`（`saveUserDoc` 增加选项、`SOURCE_LABEL` 加 `ai_tidy`）
- Modify: `backend/src/routes/study-summary.ts`（`GET/PUT /prefs`；`PUT /books/:bookId/summary` 接收 `source`、`description`）
- Test: `backend/tests/services/study-prefs.test.ts`、`backend/tests/services/study-summary.test.ts`
- Modify: `docs/api.md`（新增「学习偏好」两个接口；`PUT summary` 新字段）

**Interfaces:**
- Produces:
  - `export interface StudyPrefs { allowAiAddition: boolean }`
  - `export function getStudyPrefs(db: Database.Database, userId: string): StudyPrefs`
  - `export function setStudyPrefs(db: Database.Database, userId: string, prefs: StudyPrefs): StudyPrefs`
  - `saveUserDoc(db, userId, bookId, doc, baseRevision, opts?: { source: 'ai_tidy'; description?: string }): SaveResult`
  - 路由：`GET /api/study/prefs`、`PUT /api/study/prefs`（body `{ allowAiAddition: boolean }`，zod `.strict()`）。

- [ ] **Step 1: 写失败测试**

```ts
// study-prefs.test.ts（内存库 + `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)`）
it('returns default when nothing saved and round-trips per user', () => {
  expect(getStudyPrefs(db, 'u1')).toEqual({ allowAiAddition: false });
  setStudyPrefs(db, 'u1', { allowAiAddition: true });
  expect(getStudyPrefs(db, 'u1')).toEqual({ allowAiAddition: true });
  expect(getStudyPrefs(db, 'u2')).toEqual({ allowAiAddition: false });
});
it('falls back to default on corrupt stored JSON', () => { /* 写入 'oops' → 默认值 */ });

// study-summary.test.ts
it('saveUserDoc with ai_tidy always creates a new version and never merges', () => {
  // 先 saveUserDoc 普通保存一次（user 版本），再 ai_tidy 保存 → 版本列表顶部 source='ai_tidy'、description='整理成表格（3 列 5 行）'
  // 紧接着再普通保存 → 新建 user 版本（不并入 ai_tidy 版本）
});
it('saveUserDoc ai_tidy defaults description to AI 整理', () => {});
it('restore of an ai_tidy version describes it as AI 整理', () => { /* description === '恢复到『AI 整理』版本' */ });
```

- [ ] **Step 2: 运行确认失败** — `npx jest tests/services/study-prefs.test.ts tests/services/study-summary.test.ts`。

- [ ] **Step 3: 实现** — `saveUserDoc` 有 `opts` 时跳过 30 分钟合并逻辑，直接 `insertVersion(..., 'ai_tidy', opts.description || 'AI 整理')`；路由 zod：`source: z.literal('ai_tidy').optional()`、`description: z.string().min(1).max(50).optional()`（无 `source` 时传了 `description` → 422）；偏好路由放在 `study-summary.ts` 路由文件里（已挂在 `/study`）。

- [ ] **Step 4: 运行通过**（同上命令）。

- [ ] **Step 5: 更新 `docs/api.md` 并提交**

```bash
git add backend/src/services/study-prefs.ts backend/src/services/study-summary.ts backend/src/routes/study-summary.ts backend/tests/services/study-prefs.test.ts backend/tests/services/study-summary.test.ts docs/api.md
git commit -m "feat(study): 学习偏好接口，保存支持 AI 整理来源"
```

---

### Task 3: 整理预览服务与接口（后端）

**Files:**
- Create: `backend/src/services/summary-tidy.ts`
- Modify: `backend/src/routes/study-summary.ts`（`POST /books/:bookId/summary/tidy`）
- Test: `backend/tests/services/summary-tidy.test.ts`
- Modify: `docs/api.md`（新接口：请求、响应、错误码、`{{+…}}` 不需要客户端关心，只说明 `aiAdded`）

**Interfaces:**
- Consumes: Task 1 的 `isValidDoc`、`DocNode`、`TABLE_MAX_*`；Task 2 的 `getStudyPrefs`；`aiManager.chat(prompt, db)`；`cleanAiText`（`services/ai-reading.ts`）；`getSummary`、`hasRunningJob` 需导出（当前为私有函数，改为 `export`）。
- Produces:
  - `export type TidyMode = 'list' | 'table'`
  - `export interface TidyRequest { mode: TidyMode; content: DocNode[]; columns?: string[] }`
  - `export interface TidyResult { nodes: DocNode[]; columns: string[]; missingRefs: string[]; aiAddedCount: number }`
  - `export function validateTidyContent(content: unknown): { ok: true; nodes: DocNode[]; text: string; refs: string[] } | { ok: false; message: string }` — 用 `isValidDoc({type:'doc',content})` 校验；含 `level: 2` 标题 → 「请在一个主题内选择」；文字（`docText`）> 6000 → 「选中的内容太多，请分段整理」；空 → 「请先选择要整理的内容」。
  - `export function findThemeTitle(doc: DocNode, content: DocNode[]): string | null` — 在当前总结顶层块中找到与 `content[0]` 深相等的块，向前找最近的 h2 文字；找不到 → null。
  - `export function buildTidyPrompt(input: { mode: TidyMode; theme: string | null; text: string; columns?: string[]; allowAddition: boolean }): string`
  - `export function parseTidyOutput(raw: string, mode: TidyMode, opts: { validRefs: Set<string>; allowAddition: boolean; columns?: string[] }): TidyResult`（失败抛 `SummaryAiOutputError`，从 `summary-ai.ts` 引入）
  - `export async function tidySelection(db: Database.Database, userId: string, bookId: string, req: TidyRequest): Promise<TidyResult>`

- [ ] **Step 1: 写失败测试**（`jest.mock('../../src/ai/ai-manager')`，同 `summary-job.test.ts` 的写法）

```ts
it('validateTidyContent rejects h2, oversize text and empty content', () => {});
it('findThemeTitle returns the nearest preceding h2', () => {});
it('buildTidyPrompt serializes refs as [[ref]], includes theme and columns, and forbids additions when disabled', () => {
  // allowAddition=false → 含「不新增笔记里没有的知识」，不含 '{{+'
  // allowAddition=true → 含 '{{+' 记号说明
});
it('parseTidyOutput builds a table with header row, code and bold marks', () => {
  // raw = '{"columns":["命令","作用"],"rows":[["`ls`","列出目录 [[h:1]]"]]}' → table 第一行 tableHeader，ls 带 code 标记，h:1 → noteRef
});
it('parseTidyOutput normalizes ragged and oversized tables', () => {
  // 行短补空格子（空 paragraph）、行长截断；10 列 → 8 列；250 行 → 200 行；结果 isValidDoc(doc(...nodes)) === true
});
it('parseTidyOutput drops refs not in the selection', () => {});
it('parseTidyOutput marks {{+…}} as aiAdded only when allowed and counts them', () => {
  // allowAddition=true → aiAddedCount=1，文字带 aiAdded；false → 去掉记号、无标记、count 0；'{{+没闭合' → 原样文字去掉 '{{+'
});
it('parseTidyOutput builds a bullet list for list mode and throws on garbage', () => {});
it('tidySelection reports missingRefs and uses the user preference', async () => {
  // 选区含 h:1、h:2，chat 回复只含 h:1 → missingRefs ['h:2']；setStudyPrefs allowAiAddition=true 后 prompt 含 '{{+'
});
it('tidySelection refuses while a summary job is running', async () => { /* 抛出带 code 'busy' 的错误或返回约定值，路由映射 409 */ });
```

- [ ] **Step 2: 运行确认失败** — `npx jest tests/services/summary-tidy.test.ts`。

- [ ] **Step 3: 实现**
  - 序列化：块 → 文字，列表项前加 `- `，表格每行 `格1 | 格2`，`noteRef` → `[[ref]]`；不受信文字放在与 `summary-ai.ts` 相同风格的「以下仅为数据」分隔块中。
  - AI 输出 JSON：列表 `{"items": [...]}`；表格 `{"columns": [...], "rows": [[...]]}`；用户给了 `columns` 时以用户的为准（AI 的 columns 忽略），否则用 AI 的、截断到 2–6 个（不足 2 个 → `SummaryAiOutputError`）。
  - 行内解析顺序：先切 `{{+…}}`，再切 `[[ref]]`，最后切 `` `code` `` 与 `**bold**`；不合法引用丢弃。
  - `tidySelection`：`hasRunningJob` → 抛 `TidyBusyError`；读总结（无总结 → 404 错误类型）；`findThemeTitle`；`getStudyPrefs`；`aiManager.chat`；`parseTidyOutput`；`missingRefs` = 选区引用 − 结果引用。
  - 路由：zod 校验 `mode`、`columns`（2–6、每个 trim 后 1–20 字）、`content` 数组；`isAiConfigured` → 400；书不存在 → 404；`TidyBusyError` → 409；`SummaryAiOutputError` → 422 `AI_BAD_OUTPUT`；其他 → 500（`console.error('[study:tidy] book=…', err)`）。

- [ ] **Step 4: 运行通过**，再跑 `npx jest` 全量与 `npx tsc --noEmit`。

- [ ] **Step 5: 更新 `docs/api.md` 并提交**

```bash
git add backend/src/services/summary-tidy.ts backend/src/services/study-summary.ts backend/src/routes/study-summary.ts backend/tests/services/summary-tidy.test.ts docs/api.md
git commit -m "feat(study): 选中内容 AI 整理预览接口"
```

---

### Task 4: 编辑器扩展：表格与 AI 补充标记（前端）

**Files:**
- Modify: `frontend/package.json`（+ 锁文件）：加四个 `@tiptap/extension-table*@2.27.3`
- Modify: `frontend/src/utils/note-ref-extension.ts`（`summaryExtensions` 加表格与 `AiAdded`）
- Create: `frontend/src/utils/ai-added-mark.ts`
- Test: `frontend/src/utils/summary-extensions.test.ts`

**Interfaces:**
- Produces:
  - `export const AiAdded: Mark`（name `aiAdded`，`renderHTML` → `<span class="ai-added" title="AI 补充，未出自你的笔记">`，`inclusive: false` 使在标记文字末尾继续输入不带标记，`parseHTML` 识别 `span.ai-added`）。
  - `summaryExtensions()` 额外包含：`Table.configure({ resizable: false })`、`TableRow`、`TableHeader.extend({ content: 'paragraph+' })`、`TableCell.extend({ content: 'paragraph+' })`、`AiAdded`。

- [ ] **Step 1: 写失败测试**（`// @vitest-environment happy-dom`，用 `new Editor({ extensions: summaryExtensions(), content })`）

```ts
it('round-trips a table with header row and aiAdded marks unchanged', () => {
  // getJSON() 与输入深相等（含 tableHeader、noteRef、aiAdded）
});
it('rejects block content other than paragraphs inside cells', () => {
  // createDocument(含 bulletList 的格子, schema, …, { errorOnInvalidContent: true }) 抛错
});
it('typing at the end of aiAdded text does not extend the mark', () => {});
```

- [ ] **Step 2: 运行确认失败** — `cd frontend && npx vitest run src/utils/summary-extensions.test.ts`。
- [ ] **Step 3: 安装依赖（命令见 Global Constraints）并实现**
- [ ] **Step 4: 运行通过**，并跑 `npx vitest run src/components/SummaryEditor.test.ts` 确认不回归。
- [ ] **Step 5: 提交**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/utils/ai-added-mark.ts frontend/src/utils/note-ref-extension.ts frontend/src/utils/summary-extensions.test.ts
git commit -m "feat(study): 编辑器支持表格与 AI 补充标记"
```

---

### Task 5: 选区计算工具（前端）

**Files:**
- Create: `frontend/src/utils/summary-tidy.ts`
- Test: `frontend/src/utils/summary-tidy.test.ts`

**Interfaces:**
- Produces:
  - `export interface SelectionBlocks { from: number; to: number; nodes: DocNode[]; hasTheme: boolean; textLength: number }` — `from`/`to` 为所涉顶层块在文档中的起止位置（块边界），`nodes` 为这些块的 JSON。
  - `export function selectionBlocks(state: EditorState): SelectionBlocks | null` — 空选区 → null；按 `state.doc` 顶层子节点与 `selection.from/to` 求交得到整块范围；`hasTheme` = 含 `heading` 且 `level === 2`；`textLength` = 各块 `textContent` 长度和。
  - `export const TIDY_MAX_CHARS = 6000`
  - `export function tidyDisabledReason(sel: SelectionBlocks | null): string | null` — null 选区 → 「请先选择要整理的内容」；`hasTheme` → 「请在一个主题内选择」；超长 → 「选中的内容太多，请分段整理」；否则 null。

- [ ] **Step 1: 写失败测试**

```ts
it('selectionBlocks expands a partial paragraph selection to the whole paragraph', () => {});
it('selectionBlocks expands a cell selection to the whole table', () => {});
it('selectionBlocks spans multiple blocks and flags h2', () => {});
it('tidyDisabledReason returns the exact copy for each case', () => {});
```

- [ ] **Step 2–4:** 运行失败 → 实现 → 运行通过（`npx vitest run src/utils/summary-tidy.test.ts`）。
- [ ] **Step 5: 提交** — `git commit -m "feat(study): AI 整理的选区按整块计算"`

---

### Task 6: 编辑器工具栏：表格按钮、插入表格、去掉 AI 标记、AI 整理入口（前端）

**Files:**
- Modify: `frontend/src/components/SummaryEditor.vue`
- Test: `frontend/src/components/SummaryEditor.test.ts`

**Interfaces:**
- Consumes: Task 4 扩展；Task 5 `selectionBlocks`、`tidyDisabledReason`。
- Produces:
  - 新 prop：`tidyEnabled?: boolean`（父组件传：已配置 AI、无任务、非只读时为 true；为 false 时「AI 整理」按钮禁用，悬停提示由父组件给的 `tidyDisabledHint?: string` 决定）。
  - 新事件：`(e: 'tidy', mode: 'list' | 'table', sel: SelectionBlocks): void`
  - 暴露方法（`defineExpose`）：`replaceBlocks(from: number, to: number, nodes: DocNode[]): DocNode` — 用一次事务替换并返回新的 `getJSON()`（可 Ctrl+Z 撤回，会触发 `update:modelValue`）；`getSelectionBlocks(): SelectionBlocks | null`。
  - 工具栏：现有 10 个按钮后加「插入表格」「去掉 AI 标记」（光标处或选区内有 `aiAdded` 时可用，执行 `unsetMark('aiAdded')`，无选区时先 `extendMarkRange('aiAdded')`）、「AI 整理」下拉（Element Plus `el-dropdown`，两项「整理成列表」「整理成表格」；`tidyDisabledReason` 非 null 时禁用并以其为提示）。
  - 光标在表格内时显示第二行表格按钮（七个，文案见 Global Constraints），对应 Tiptap 命令 `addRowBefore/addRowAfter/deleteRow/addColumnBefore/addColumnAfter/deleteColumn/deleteTable`。
  - 桌面浮动工具栏：用 `@tiptap/vue-3` 的 `BubbleMenu`（选区非空时显示加粗、斜体、无序列表、「AI 整理」下拉）。
  - 样式：`.se-content :deep(table)` 横向可滚动容器（Table 扩展的 `.tableWrapper` 设 `overflow-x: auto`）、边框 `var(--card-border)`、表头底色 `color-mix(in srgb, var(--accent) 6%, transparent)`；`.ai-added`：`text-decoration: underline dashed var(--accent)`、底色 `color-mix(in srgb, var(--accent) 10%, transparent)`。

- [ ] **Step 1: 写失败测试**（改现有断言：`.se-btn` 数量从 10 变为 12（+插入表格、去掉 AI 标记））

```ts
it('shows table buttons only when the cursor is inside a table', async () => {});
it('insert table creates a 3x2 table with a header row', async () => {});
it('removes aiAdded mark at the cursor', async () => {});
it('emits tidy with whole-block selection and blocks h2 selections', async () => {});
it('replaceBlocks replaces the range in one undoable step', async () => {
  // 调用后 getJSON 含新 table；editor.commands.undo() 后恢复原段落
});
```

- [ ] **Step 2–4:** 运行失败 → 实现 → 运行通过（`npx vitest run src/components/SummaryEditor.test.ts`）。
- [ ] **Step 5: 提交** — `git commit -m "feat(study): 编辑器表格按钮、去掉 AI 标记与 AI 整理入口"`

---

### Task 7: 整理弹框组件与前端 API（前端）

**Files:**
- Modify: `frontend/src/api/study.ts`、`frontend/src/types/study.ts`、`frontend/src/utils/summary-doc.ts`（`SOURCE_LABEL.ai_tidy = 'AI 整理'`）
- Create: `frontend/src/components/TidyDialog.vue`
- Test: `frontend/src/components/TidyDialog.test.ts`

**Interfaces:**
- Consumes: Task 3 接口；Task 2 接口。
- Produces:
  - `SummarySource` 加 `'ai_tidy'`；`interface TidyResult { nodes: DocNode[]; columns: string[]; missingRefs: string[]; aiAddedCount: number }`；`interface StudyPrefs { allowAiAddition: boolean }`。
  - `studyApi.tidy(bookId: string, body: { mode: 'list' | 'table'; content: DocNode[]; columns?: string[] })`、`studyApi.getPrefs()`、`studyApi.savePrefs(prefs: StudyPrefs)`、`studyApi.saveSummary(bookId, doc, revision, opts?: { source: 'ai_tidy'; description: string })`。
  - `TidyDialog.vue`：props `{ modelValue: boolean; bookId: string; mode: 'list' | 'table'; content: DocNode[] }`；事件 `update:modelValue`、`adopt(nodes: DocNode[], description: string)`。打开即请求；加载中、失败（显示错误文案 +「重试」）、成功三态；左「改前」右「改后」用只读 `SummaryEditor` 展示（宽 < 768px 上下排列）；表格模式下方列名编辑（`el-input` 列表 + 增删，2–6 个，1–20 字）；`missingRefs.length > 0` 显示「有 N 处原文出处没有保留，可重新整理」；`aiAddedCount > 0` 显示「含 N 处 AI 补充」；按钮「采用」「重新整理」「放弃」。`description` 由组件生成：表格「整理成表格（C 列 R 行）」（R 不含表头），列表「整理成列表（N 项）」。

- [ ] **Step 1: 写失败测试**（mock `studyApi`）

```ts
it('requests on open, shows before/after, and emits adopt with description', async () => {
  // tidy 返回 3 列 5 行 → 点击「采用」→ emitted adopt[0][1] === '整理成表格（3 列 5 行）'
});
it('re-tidies with edited column names', async () => { /* 第二次 tidy 调用 body.columns 为修改后的值 */ });
it('shows missing refs and AI addition notices', async () => {});
it('shows error with retry on 422 AI_BAD_OUTPUT', async () => {});
```

- [ ] **Step 2–4:** 运行失败 → 实现 → 运行通过（`npx vitest run src/components/TidyDialog.test.ts`）。
- [ ] **Step 5: 提交** — `git commit -m "feat(study): AI 整理对比弹框与前端接口"`

---

### Task 8: 接入笔记整理页：整理偏好、整理流程、采用保存（前端）

**Files:**
- Modify: `frontend/src/views/StudySummary.vue`
- Modify: `CHANGELOG.md`（`## [Unreleased-study]` 下加「新增」条目）、`tasks/todo.md`

**Interfaces:**
- Consumes: Task 6 的 `tidy` 事件与 `replaceBlocks`；Task 7 的 `TidyDialog`、`studyApi`。

- [ ] **Step 1: 实现**
  - 顶栏「导出」后加「整理偏好」按钮（`IconAdjustmentsHorizontal`），`el-popover` 内 `el-switch`「整理笔记时允许 AI 补充内容」+ 说明文字；打开时 `getPrefs`，切换即 `savePrefs`（失败回滚并 `ElMessage.error`）。
  - `SummaryEditor` 传 `tidyEnabled = !!summary && !running && !leaving && !restoring && aiConfigured`（`aiConfigured` 用已有的 AI 状态接口 `/settings/ai-status`）；未配置时提示「请先在 AI 插件设置中配置」。
  - `onTidy(mode, sel)`：记下 `sel`，打开 `TidyDialog`。
  - `onAdopt(nodes, description)`：`const ok = await flushSave()`；`!ok` → 关闭弹框、`ElMessage.warning('整理内容已在别处更新，请重新选择后再整理')`，结束；否则 `const next = editorRef.value.replaceBlocks(sel.from, sel.to, nodes)`，清掉自动保存计时器，直接调 `studyApi.saveSummary(bookId, next, revision, { source: 'ai_tidy', description })`；成功更新 `revision`/保存状态/修改记录；409 → 复用 `onConflict(err, false)`。
  - 修改记录里 `src-ai_tidy` 样式与 `src-ai_update` 同类（主题变量）。
  - CHANGELOG `[Unreleased-study]` → `### 新增` 下：「- **学习**：笔记整理中选中一段内容，可让 AI 整理成列表或表格，对比后再采用；表格可直接加行、改格子；可在「整理偏好」中允许 AI 补充笔记外的常识（带标记）」。

- [ ] **Step 2: 跑全部自动检查**

Run: `cd backend && npx jest && npx tsc --noEmit && cd ../frontend && npx vitest run && npx vue-tsc --noEmit`
Expected: 全部通过。

- [ ] **Step 3: 在 Docker 测试容器中手动验证**（按记忆：本地镜像 + 数据副本，`-p 8082:3000`；AI 用已配置的服务商实测）
  - Linux 命令那样的三段笔记 → 整理成表格：弹框左右对比、列名 AI 自定；改列名后重新整理生效；采用后正文出现表格、修改记录新增「AI 整理 · 整理成表格（3 列 3 行）」；Ctrl+Z 可撤回。
  - 整理成列表；选区含二级标题时按钮禁用并提示；超 6000 字提示。
  - 表格按钮：上下加行、删行、左右加列、删列、删表格；最后一格 Tab 加行；插入表格。
  - 整理偏好打开后整理：补充文字带虚线下划线与淡底，悬停提示；「去掉 AI 标记」生效；导出 Markdown 中表格为 GFM、补充处带「（AI 补充）」。
  - 采用前在别的标签页改过同一总结（制造 409）：AI 结果不落库，页面加载最新内容并提示。
  - 主题：靛青、暗夜下表格与标记可读；手机 390 宽弹框上下排列、表格横向滚动、无页面横向滚动。

- [ ] **Step 4: 提交**

```bash
git add frontend/src/views/StudySummary.vue CHANGELOG.md tasks/todo.md
git commit -m "feat(study): 笔记整理页接入 AI 整理成列表 / 表格与整理偏好"
```
