# 学习笔记 第三期：总导图画布 + 手动编辑 + 导出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每本书一张「学习导图」页：以目录为骨架，挂上用户保留的知识节点；可拖拽缩放折叠；可手动加节点、改名、写批注、删除；可从节点跳回原文；可导出 PNG 与 Markdown 大纲。

**Architecture:** 后端在 `mind-nodes` 服务补「手动节点」与「改名/批注」两个函数和两个路由。前端：纯函数 `book-map.ts` 把目录（复用 `toc-tree.ts`）+ 划线 + 节点组装成一棵树并支持「只看有笔记」裁剪与 Markdown 导出；`MindMapCanvas.vue` 用 `d3-hierarchy` 自动布局 + `d3-zoom` 平移缩放，SVG 渲染、折叠、导出 PNG；新页面 `BookMap.vue`（工具栏 + 画布 + 节点详情面板）；阅读器支持 `?chapter=&find=` 打开即跳到原文。

**Tech Stack:** Express + better-sqlite3 + zod + Jest；Vue 3 + Element Plus + Vitest + happy-dom；新增 `d3-hierarchy@3.1.2`、`d3-zoom@3.0.0`、`d3-selection@3.0.0`（精确版本）。

**Spec:** `docs/superpowers/specs/2026-11-05-study-notes-mindmap-design.md`（分期 3）。第一、二期已在分支 `feat/study-notes-phase1` 验收，本期在同一分支继续。

## Global Constraints

- 布局（用户决定）：经典导图画布，可拖拽（= 平移）、缩放、折叠；布局自动计算，**不保存坐标**，不支持拖拽改挂父节点。
- 骨架 = 书的目录：根 = 书名；按 `getChapters()` 的 `level` / `groupTitle` 分层（`buildTocTree`）；没有多层目录时为 书名 → 章节。骨架节点不入库。
- 划线根节点（kind `highlight`）挂在划线所在章节下；手动节点挂在用户选的位置（某个已有节点下，或某个章节下）。
- 没有笔记的章节/分组灰显；工具栏「只看有笔记的章节」**默认开启**。
- 手动节点 kind = `custom`；label 1–60 字，批注 ≤ 2000 字；划线根节点不可改名（它就是划线原文），其批注区显示划线批注（只读，提示「批注请在阅读器里编辑划线」）。
- 删除节点：有子节点时确认「将同时删除它下面的 N 个节点，确定删除吗？」，按钮「删除节点」（与第二期面板一致）。
- 跳原文：节点有出处 → 打开阅读器 `/reader/:bookId?chapter=<i>&find=<label>`；出处 `source_later` 为真时先确认（与第二期相同文案「这是你还没读到的后文，跳转后阅读进度会移到那一章。确定跳转吗？」，标题与按钮「跳转到后文」）。划线根节点跳到划线本身：`?highlight=<id>`。
- 导出：PNG（当前展开状态的整张图，白底，2 倍像素）与 Markdown 大纲（缩进列表，包含当前「只看有笔记」筛选后的全部节点，不受折叠影响）；文件名 `<书名>-学习导图.png/.md`。
- 入口：书籍详情页按钮「学习导图」；阅读器顶栏与侧边工具栏「学习导图」（PDF 书也显示——PDF 可手动加节点）。
- 手机（`max-width: 768px`）：画布全屏，节点详情用底部抽屉；支持双指缩放、单指拖动。
- 本期不做：AI 出题与复习（第四期，工具栏暂不放「开始复习」）。
- API `{ success, code, data }`、`authMiddleware`；补 `docs/api.md`、`docs/development.md`；UI 中文；前端测试 `npx vitest run`。

## Review Focus

1. **大书**：130 章的《史记》、3000 章的网文 → 「只看有笔记」开启时只渲染有笔记的分支；关闭时也能显示（默认折叠到章节层以下）（Task 2 `prunes chapters without notes` + Task 3 性能说明）。
2. **目录层级不规则**：层级跳跃（1→3）、TXT 分组行（负 index）、无层级 → 骨架正确，节点挂到正确章节（Task 2 测试）。
3. **孤儿数据**：节点的 `chapter_index` 超出当前目录（书被重新解析）、父节点已不存在 → 挂到「未归类」分组而不是丢失或报错（Task 2 测试）。
4. **编辑越权**：改别人的节点、改划线根节点的 label、往别人的节点下加子节点 → 拒绝（Task 1 测试）。
5. **导出**：书名含 `/` 等非法文件名字符、label 含 Markdown 特殊字符（`*`、`#`、换行）→ 文件名安全、大纲不乱（Task 2 `toMarkdown escapes` 测试）。

---

### Task 1: 后端手动节点与编辑

**Files:**
- Modify: `backend/src/services/mind-nodes.ts`、`backend/src/routes/reader.ts`、`docs/api.md`、`docs/development.md`
- Test: `backend/tests/services/mind-nodes.test.ts`

**Interfaces:**
- Produces:
  ```ts
  /** parentId 给定：挂在该节点下（须属于本人本书），chapter_index/highlight_id 继承父节点；
   *  否则挂在 chapterIndex 章下（parent_id null、highlight_id null）。kind 'custom'。父节点不存在/非本人 → null */
  export function addCustomNode(db, userId, bookId, input: { parentId?: string; chapterIndex?: number; label: string; note?: string }): MindNode | null
  /** 改 label / note（note '' → null）。kind 'highlight' 的节点不能改 label（只改 label 时返回 'FORBIDDEN'）。不存在/非本人 → null */
  export function updateMindNode(db, userId, bookId, id: string, patch: { label?: string; note?: string | null }): MindNode | null | 'FORBIDDEN'
  ```
  HTTP：
  - `POST /api/reader/:bookId/mind-nodes` body `{ parentId?, chapterIndex?, label(1–60), note?(≤2000) }`，`parentId` 与 `chapterIndex` 恰好一个 → 201 `MindNode`；父不存在 404；书不存在 404。
  - `PATCH /api/reader/:bookId/mind-nodes/:id` body `{ label?, note? }`（至少一个）→ `MindNode`；不存在 404；改划线根节点 label → 403 `FORBIDDEN`「划线节点不能改名」。
- Produces（前端）：`readerApi.addMindNode(bookId, body)`、`readerApi.updateMindNode(bookId, id, patch)`。

- [ ] **Step 1: 写失败测试**：`adds a custom node under a chapter`（parent null、highlight null、kind custom、sort 递增）；`adds under a kept node inheriting chapter and highlight`；`rejects a parent of another user`（null）；`updates label and note, empty note clears`；`refuses renaming a highlight root`（'FORBIDDEN'，但改 note 可以）；`cannot update others' nodes`（null）。
- [ ] **Step 2: 运行确认失败** `cd backend && npx jest tests/services/mind-nodes.test.ts`。
- [ ] **Step 3: 实现**服务函数、路由（zod，模式同现有 mind-nodes 路由）、前端 API 与类型、文档。
- [ ] **Step 4: 验证** `cd backend && npm test && npx tsc --noEmit`；`cd frontend && npm run typecheck`。
- [ ] **Step 5: 提交** `git commit -m "feat: 导图手动节点与改名/批注"`

### Task 2: 总导图数据组装与 Markdown 导出（纯函数）

**Files:**
- Create: `frontend/src/utils/book-map.ts`、`frontend/src/utils/book-map.test.ts`

**Interfaces:**
- Consumes: `buildTocTree`（`toc-tree.ts`）；`MindNode`、`Highlight`、`Chapter` 类型。
- Produces:
  ```ts
  export type MapNodeType = 'book' | 'group' | 'chapter' | 'orphans' | 'mind'
  export interface MapNode {
    id: string                 // book: 'book'；group: 'g:<index>'；chapter: 'c:<index>'；orphans: 'orphans'；mind: 节点 id
    type: MapNodeType
    label: string
    kind?: MindNode['kind']    // 仅 mind
    node?: MindNode            // 仅 mind
    highlight?: Highlight      // 仅 kind 'highlight' 的 mind 节点
    chapterIndex?: number      // chapter 与 mind
    hasNotes: boolean          // 本节点或子孙中有 mind 节点
    children: MapNode[]
  }
  export function buildBookMap(input: {
    bookTitle: string
    chapters: Array<{ index: number; title: string; level?: number; groupTitle?: string }>
    nodes: MindNode[]
    highlights: Highlight[]
  }): MapNode
  /** 去掉 hasNotes 为假的 group/chapter 分支（根保留） */
  export function pruneEmpty(root: MapNode): MapNode
  /** 缩进 Markdown 大纲：根为 `# 书名`，其余每层 `- ` 前缩进两个空格；label 中换行变空格，`*_#[]\` 等前加反斜杠；mind 节点有 summary 时追加 `：summary`，有 note 时下一行缩进 `> note` */
  export function toMarkdown(root: MapNode): string
  /** 去掉 \ / : * ? " < > | 与首尾空白，空则「学习导图」 */
  export function safeFileName(name: string): string
  ```
  规则：mind 节点按 `parent_id` 挂到父 mind 节点；`parent_id` 为空的挂到 `c:<chapter_index>`；父不存在或章节不存在 → 挂到「未归类」（`orphans`，label「未归类」，放在根的最后，仅当非空时存在）。同级 mind 节点按 `sort`、`created_at` 排序；划线根节点 label 取划线原文前 30 字。

- [ ] **Step 1: 写失败测试**：`builds skeleton from flat chapters`；`builds nested skeleton with groups and level jumps`（复用 toc-tree.test 的 BOOK fixture 思路，含负 index 分组行）；`attaches highlight roots under their chapter and children under parents`；`puts orphans under 未归类`（章节越界、父缺失两种）；`marks hasNotes up the ancestors and pruneEmpty keeps only noted branches`；`toMarkdown nests and escapes`（label 含 `*`、`#`、换行；note 输出 `>` 行）；`safeFileName strips illegal characters`。
- [ ] **Step 2: 运行确认失败** `cd frontend && npx vitest run src/utils/book-map.test.ts`。
- [ ] **Step 3: 实现** → PASS；`npm run typecheck`。
- [ ] **Step 4: 提交** `git commit -m "feat: 总导图数据组装与 Markdown 导出"`

### Task 3: 导图画布组件

**Files:**
- Modify: `frontend/package.json`（`npm i d3-hierarchy@3.1.2 d3-zoom@3.0.0 d3-selection@3.0.0` 及对应 `@types/*` devDependencies）
- Create: `frontend/src/components/MindMapCanvas.vue`、`frontend/src/utils/map-layout.ts`、`frontend/src/utils/map-layout.test.ts`

**Interfaces:**
- Consumes: Task 2 `MapNode`。
- Produces:
  ```ts
  // map-layout.ts（纯函数，可测）
  export interface LaidOutNode { id: string; x: number; y: number; width: number; depth: number; data: MapNode; collapsed: boolean; hasChildren: boolean }
  export interface LaidOutLink { from: string; to: string; path: string }   // SVG path d，水平三次贝塞尔
  /** 水平树（根在左）：d3-hierarchy tree().nodeSize([rowHeight, 0])，横向位置按各层最大文字宽度累加；collapsed 集合中的节点不展开子节点 */
  export function layoutMap(root: MapNode, collapsed: Set<string>, measure: (label: string, type: MapNodeType) => number): { nodes: LaidOutNode[]; links: LaidOutLink[]; width: number; height: number }
  /** 初始折叠：深度 ≥ maxDepth 的有子节点的节点 */
  export function initialCollapsed(root: MapNode, maxDepth: number): Set<string>
  ```
  ```ts
  // MindMapCanvas.vue
  props: { root: MapNode; selectedId: string | null }
  emits: 'select'(id: string)
  expose: { fit(): void; collapseAll(): void; expandAll(): void; exportPng(): Promise<Blob> }
  ```
  画布行为：SVG + `d3-zoom`（滚轮/双指缩放 0.2–3 倍，拖拽平移，双击不缩放）；节点为圆角矩形+文字，样式按 `type`/`kind`（书根、分组、章节、划线、事件、概念、人物、手动 各有颜色），`hasNotes` 为假的骨架节点灰显；有子节点的节点右侧有 ⊕/⊖ 折叠按钮；点击节点 emit `select`，选中节点描边高亮。初始折叠 = `initialCollapsed(root, 3)`，首次渲染与 root 变化后 `fit()`。`exportPng`：克隆当前 SVG、内联样式（颜色写成属性，不依赖 CSS 变量）、白底、按内容尺寸 ×2 绘制到 canvas 后 `toBlob('image/png')`。文字宽度用 canvas `measureText`（缓存）。颜色在亮/暗主题下都清晰（CSS 变量），导出时固定亮色。

- [ ] **Step 1: 写失败测试** `map-layout.test.ts`：`lays out children to the right of parents`（子 x > 父 x，同层 x 相同）；`skips collapsed subtrees`；`links connect parent to child`；`initialCollapsed collapses from the given depth`。
- [ ] **Step 2: 运行确认失败** `cd frontend && npx vitest run src/utils/map-layout.test.ts`。
- [ ] **Step 3: 实现** `map-layout.ts` → PASS；再实现 `MindMapCanvas.vue`。
- [ ] **Step 4: 验证** `npx vitest run && npm run typecheck && npm run build`。
- [ ] **Step 5: 提交** `git commit -m "feat: 导图画布（自动布局、缩放平移、折叠、导出 PNG）"`

### Task 4: 学习导图页面

**Files:**
- Create: `frontend/src/views/BookMap.vue`
- Modify: `frontend/src/router/index.ts`（`/book/:bookId/map`，name `BookMap`，`requiresAuth`）

**Interfaces:**
- Consumes: Task 1 API；Task 2 `buildBookMap`/`pruneEmpty`/`toMarkdown`/`safeFileName`；Task 3 `MindMapCanvas`；现有 `readerApi.getChapters`、`getHighlights`、`getMindNodes(bookId)`（不带 highlightId = 全书）、`deleteMindNode`；书籍信息 API（BookDetail 用的那个）。

- [ ] **Step 1: 页面骨架**：顶栏「← 返回」、标题「<书名> · 学习导图」、工具栏：「只看有笔记的章节」开关（默认开）、「折叠全部」「展开全部」「适应窗口」、「导出」下拉（「导出图片 PNG」「导出大纲 Markdown」）。空状态（没有任何节点）：「还没有知识节点。在阅读器里划线后点「AI 展开」，或在章节上手动添加节点。」，并仍显示骨架（关闭筛选后）。
- [ ] **Step 2: 节点详情面板**（宽屏右侧固定 320px；手机底部 `el-drawer` btt 50%）：
  - 书根/分组：只显示标题。
  - 章节：标题 +「添加节点」+「去阅读这一章」（`/reader/:bookId?chapter=<i>`）。
  - mind 节点：kind 标签、label（划线根以外可「改名」）、summary、批注（textarea + 「保存批注」；划线根显示划线批注只读并提示）、出处（「📖 去原文」，`source_later` 时文案「📖 后文·<章节名>」并先确认）、「添加子节点」、「删除」（确认规则见 Global Constraints）。划线根的「📖 去原文」→ `?highlight=<id>`。
  - 添加/改名用 `ElMessageBox.prompt`（标题「添加节点」/「改名」，按钮「保存」，校验 1–60 字）。
- [ ] **Step 3: 导出**：PNG → `exportPng()` 下载；Markdown → `toMarkdown(当前筛选后的树)` 下载（`text/markdown;charset=utf-8`）；文件名 `safeFileName(书名) + '-学习导图.png/.md'`。
- [ ] **Step 4: 编辑后刷新**：增删改后重新拉取节点并重建树，保持当前选中与折叠状态（选中节点被删则清空）。
- [ ] **Step 5: 验证** `npx vitest run && npm run typecheck && npm run build`。
- [ ] **Step 6: 提交** `git commit -m "feat: 学习导图页面（工具栏、节点详情、编辑、导出）"`

### Task 5: 入口与阅读器跳转参数

**Files:**
- Modify: `frontend/src/views/BookDetail.vue`、`frontend/src/views/Reader.vue`

- [ ] **Step 1: 入口**：书籍详情「开始阅读」旁加按钮「学习导图」→ `/book/:bookId/map`；阅读器顶栏与侧边工具栏加「学习导图」（图标 `IconSitemap`，若无则 `IconBinaryTree`，tooltip「学习导图」）。
- [ ] **Step 2: 阅读器查询参数**：打开时若带 `chapter`（数字）→ 加载完成后跳到该章（代替恢复进度；进度照常随阅读保存）；同时带 `find` → 复用第二期 `onMindJump` 的查找与闪烁；带 `highlight=<id>` → 复用第一期 `jumpToHighlight`。处理后用 `router.replace` 去掉这些参数，避免刷新重复跳转。参数无效（章越界、划线不存在）→ 按原逻辑恢复进度并 `ElMessage.warning('原文位置已失效')`。
- [ ] **Step 3: 验证** `npx vitest run && npm run typecheck && npm run build`。
- [ ] **Step 4: 提交** `git commit -m "feat: 学习导图入口与阅读器定位参数"`

### Task 6: 整体验收

- [ ] **Step 1:** 后端 `npm test && npx tsc --noEmit`；前端 `npx vitest run && npm run typecheck && npm run build`。
- [ ] **Step 2:** `docker compose up -d --build`，请用户验收：从书籍详情/阅读器进入学习导图；骨架与灰显；只看有笔记开关；折叠/展开/适应窗口；拖拽缩放（含手机双指）；点节点看详情；添加/改名/批注/删除；📖 去原文与后文确认；导出 PNG 与 Markdown 打开检查。
