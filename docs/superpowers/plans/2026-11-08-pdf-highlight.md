# PDF 划线与批注 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在「按页渲染」方式下的文字版 PDF 中选中文字划线、写批注，与普通书的划线是同一份数据；无文字的页（扫描 / 图片）与浏览器原生打开方式下，「笔记」入口灰化并提示。

**Architecture:** `PdfPage.vue` 在 canvas 上叠 pdf.js TextLayer（去伪粗体重复、行尾补分隔符），渲染完向父组件报告本页是否有文字。划线锚点仍是「章节号（= 页码 - 1）+ 文字层 textContent 偏移 + 原文」，`Reader.vue` 把文字层当作该页的正文容器，复用现有选区 → 菜单 → 保存 → 重绘 → 跳转逻辑。后端只改 AI 展开在 PDF 页文字中定位划线的容错。

**Tech Stack:** Vue 3 + TypeScript + pdfjs-dist 6.4.299（前端）、vitest（happy-dom）；Node + Express + better-sqlite3 + jest（后端）。

**Spec:** `docs/superpowers/specs/2026-11-08-pdf-highlight-design.md`

## Global Constraints

- 只在 `study` 分支开发（划线功能仅学习版有）。
- 只在 `pdfUsePlugin = true`（Reader 中 `isPdfRender`）时支持划线；浏览器原生打开（`isPdf`）不支持。
- 提示文案（逐字）：无文字页「PDF 格式不支持」；原生打开方式「当前 PDF 打开方式不支持划线，可在设置中开启 PDF 插件」。
- 锚点：`chapterIndex = 页码 - 1`，偏移为文字层元素 `textContent` 的 `[start, end)`，恢复用现有 `locateHighlight`。
- 划线接口与数据结构不变，不新增 API 字段。
- 不做 OCR、框选、PDF 注释导出；不修改 PDF 文件。
- 伪粗体去重规则与后端 `buildPageText` 相同：同一字符串、`|Δx| < 1` 且 `|Δy| < 1`（transform 的 x、y）只保留第一个。
- 行尾分隔符规则与后端 `joinPieces` 相同：前一段末字或后一段首字是 CJK（`/[⺀-鿿豈-﫿＀-￯　-〿]/`），或任一侧已有空白 → 不加；否则加一个空格。
- 跨页选区按现有「跨章」规则拒绝。
- 颜色只用主题变量（划线底色沿用现有 `mark.hl` 样式），图标用 Tabler。

## Review Focus

1. **页面宽度变化 / 旋转屏幕后文字层重建**：划线底色必须重新画上且位置正确（旧 mark 随文字层一起消失，按「未绘制」重绘）。→ Task 3 测试 `re-emits text-ready after a re-render`，Task 4 手动验证项。
2. **伪粗体页**：同一行字被画两遍时，文字层只保留一份，划下的原文不出现「重要重要」，且锚点与 textContent 对应。→ Task 2 测试 `dedupeTextItems drops fake-bold copies`。
3. **英文跨行划线**：存下的原文行与行之间有空格、中文跨行无多余空格。→ Task 2 测试 `eolSeparator follows the backend join rule`。
4. **整页都是空白字符的页**（扫描页上常有隐藏的空格层）：判为无文字页。→ Task 2 测试 `pageHasText treats whitespace-only pages as no text`。
5. **划线原文与后端页文字空白不一致**：AI 展开仍能定位到段落；找不到时用整页上下文、不按阅读进度截断、不报错。→ Task 1 测试 `findHighlightParagraph ignores whitespace differences`、`pdf highlight not found uses the whole page`。

---

### Task 1: 后端——AI 展开在 PDF 页文字中定位划线的容错

**Files:**
- Modify: `backend/src/services/mind-expand.ts`（`locateHighlightParagraph` 附近、`expandHighlight`、`listMindNodesWithLater`）
- Test: `backend/tests/services/mind-expand.test.ts`

**Interfaces:**
- Produces:
  - `export function findHighlightParagraph(paragraphs: string[], text: string): number` — 找不到返回 `-1`。匹配顺序：全文包含 → 前 20 字锚点包含 → 去掉所有空白后再按前两步各试一次。
  - `locateHighlightParagraph(paragraphs, text)` 保持签名与行为（`= Math.max(0, findHighlightParagraph(...))`），现有调用方不变。
  - `export function pdfContextRange(paragraphCount: number, found: number): { from: number; to: number }` — PDF 用：`found < 0` → `{ from: 0, to: paragraphCount - 1 }`；否则 `from = max(0, found - CONTEXT_BEFORE)`、`to = min(paragraphCount - 1, found + CONTEXT_AFTER)`（不受阅读边界截断）。

- [ ] **Step 1: 写失败测试**

```ts
it('findHighlightParagraph ignores whitespace differences', () => {
  const paras = ['First line of text', 'The quick brown fox jumps over', '中文 段落 内容'];
  expect(findHighlightParagraph(paras, 'quick  brown\nfox')).toBe(1);
  expect(findHighlightParagraph(paras, '中文段落')).toBe(2);
  expect(findHighlightParagraph(paras, '不存在')).toBe(-1);
  expect(locateHighlightParagraph(paras, '不存在')).toBe(0);
});
it('pdf highlight not found uses the whole page', () => {
  expect(pdfContextRange(7, -1)).toEqual({ from: 0, to: 6 });
  expect(pdfContextRange(10, 5)).toEqual({ from: 2, to: 7 });
  expect(pdfContextRange(3, 0)).toEqual({ from: 0, to: 2 });
});
it('expandHighlight on a pdf book does not cut context at the reading progress', async () => {
  // 仿照文件中已有 expandHighlight 测试的造数方式：book.file_format = 'pdf'，划线在第 0 章（页），
  // 进度 paragraph_index = 0，划线原文与页文字只差空白；断言送给 AI 的 prompt 含划线段落之后的段落
});
```

- [ ] **Step 2: 运行确认失败** — `cd backend && npx jest tests/services/mind-expand.test.ts`，新用例 FAIL（函数未导出）。

- [ ] **Step 3: 实现** — `expandHighlight` 与 `listMindNodesWithLater`：`book.file_format === 'pdf'` 时用 `findHighlightParagraph` + `pdfContextRange` 求上下文范围，阅读边界取 `{ chapterIndex: hl.chapter_index, paragraphIndex: paragraphs.length - 1 }` 与进度中较晚者（整页视为已读）；非 PDF 路径完全不变。缓存键仍用实际 `range.from / range.to`。

- [ ] **Step 4: 运行通过** — 同上命令全部 PASS；再跑 `npx jest` 与 `npx tsc --noEmit`。

- [ ] **Step 5: 提交** — `git commit -m "feat(study): AI 展开在 PDF 页中容忍空白差异并使用整页上下文"`

---

### Task 2: 前端——文字层纯函数

**Files:**
- Create: `frontend/src/utils/pdf-text.ts`
- Test: `frontend/src/utils/pdf-text.test.ts`

**Interfaces:**
- Produces:
  - `export interface PdfTextItemLike { str: string; transform: number[]; hasEOL?: boolean }`
  - `export function dedupeTextItems<T extends PdfTextItemLike>(items: T[]): T[]` — 规则见 Global Constraints；保持原顺序；空字符串 item 原样保留（TextLayer 需要它们的 hasEOL）。
  - `export function eolSeparator(prev: string, next: string): string` — 返回 `''` 或 `' '`，规则见 Global Constraints。
  - `export function pageHasText(items: PdfTextItemLike[]): boolean` — 任一 `str.trim()` 非空即 true。

- [ ] **Step 1: 写失败测试**

```ts
const it_ = (str: string, x: number, y: number, hasEOL = false) => ({ str, transform: [10, 0, 0, 10, x, y], hasEOL })
it('dedupeTextItems drops fake-bold copies', () => {
  const items = [it_('重要', 100, 700), it_('重要', 100.4, 700.3), it_('重要', 300, 700), it_('其他', 100, 680)]
  expect(dedupeTextItems(items).map(i => [i.str, i.transform[4]])).toEqual([['重要', 100], ['重要', 300], ['其他', 100]])
})
it('eolSeparator follows the backend join rule', () => {
  expect(eolSeparator('quick', 'brown')).toBe(' ')
  expect(eolSeparator('中文', '内容')).toBe('')
  expect(eolSeparator('end ', 'next')).toBe('')
  expect(eolSeparator('abc', '中')).toBe('')
  expect(eolSeparator('', 'x')).toBe('')
})
it('pageHasText treats whitespace-only pages as no text', () => {
  expect(pageHasText([])).toBe(false)
  expect(pageHasText([it_(' ', 0, 0), it_('　', 0, 0), it_('', 0, 0, true)])).toBe(false)
  expect(pageHasText([it_(' ', 0, 0), it_('a', 0, 0)])).toBe(true)
})
```

- [ ] **Step 2: 运行确认失败** — `cd frontend && npx vitest run src/utils/pdf-text.test.ts`。
- [ ] **Step 3: 实现**（三个纯函数，无 DOM）。
- [ ] **Step 4: 运行通过**（同上）。
- [ ] **Step 5: 提交** — `git commit -m "feat(study): PDF 文字层去重与行尾分隔规则"`

---

### Task 3: 前端——PdfPage 叠加可选中的文字层

**Files:**
- Modify: `frontend/src/utils/pdf.ts`（新增文字层渲染封装，是唯一直接使用 `TextLayer` 的地方）
- Modify: `frontend/src/components/PdfPage.vue`
- Test: `frontend/src/components/PdfPage.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `dedupeTextItems`、`eolSeparator`、`pageHasText`。
- Produces:
  - `utils/pdf.ts`：`export async function renderPdfTextLayer(page: PDFPageProxy, container: HTMLElement, viewport: PageViewport): Promise<{ hasText: boolean; cancel: () => void }>` — 清空 container；`getTextContent()` → `dedupeTextItems` → `new TextLayer({ textContentSource: { ...content, items: deduped }, container, viewport }).render()`；渲染后把每个 `<br>`（hasEOL 处）前插入 `eolSeparator(前一段文字, 后一段文字)` 的文本节点（为空则不插），使 `container.textContent` 在跨行处与后端一致。
  - `PdfPage.vue`：在 canvas 上方渲染 `<div class="pdf-text-layer textLayer">`（绝对定位铺满，文字透明、可选中）；每次画面渲染完成后渲染文字层（与画面使用同一 CSS 宽度的 viewport，不乘像素比），按 pdfjs-dist 6 的要求在容器上设置 `--scale-factor`（及 `--total-scale-factor` 等它需要的变量），把 `pdfjs-dist/web/pdf_viewer.css` 中 `.textLayer` 相关规则按需内联到组件样式（不引整份 CSS）。
  - 新事件：`(e: 'text-ready', pageNumber: number, hasText: boolean): void` — 每次文字层渲染完成（含尺寸变化后的重渲染）都触发；渲染失败时 `hasText = false`。
  - 取消：翻页 / 卸载 / 重渲染时取消上一次文字层渲染（沿用现有 `renderSeq` 判过期）。

- [ ] **Step 1: 写失败测试**（`vi.mock('@/utils/pdf', ...)` 让 `renderPdfTextLayer` 返回可控结果；doc 用最小桩：`getPage` 返回带 `getViewport`、`render` 的对象；happy-dom 下给 `rootRef` 宽度可用 `Object.defineProperty(HTMLElement.prototype, 'clientWidth', …)`）

```ts
it('emits text-ready with hasText from the text layer', async () => { /* mock 返回 { hasText: true } → emitted('text-ready')[0] 为 [3, true] */ })
it('emits hasText false when the text layer fails', async () => { /* mock reject → [3, false]，画面不显示「本页渲染失败」 */ })
it('re-emits text-ready after a re-render', async () => { /* 改 pageNumber prop → 再次触发，第二次参数为新页码 */ })
it('renders a selectable text layer above the canvas', () => { /* .pdf-text-layer 存在且在 canvas 之后（DOM 顺序） */ })
```

- [ ] **Step 2: 运行确认失败** — `cd frontend && npx vitest run src/components/PdfPage.test.ts`。
- [ ] **Step 3: 实现**（见 Interfaces）。
- [ ] **Step 4: 运行通过**，并 `npx vue-tsc --noEmit`。
- [ ] **Step 5: 提交** — `git commit -m "feat(study): PDF 页面叠加可选中的文字层"`

---

### Task 4: 前端——阅读器接入 PDF 划线、入口灰化、实测与说明

**Files:**
- Modify: `frontend/src/utils/highlight-anchor.ts`（`chapterContentOf`，新增选择器常量）
- Test: `frontend/src/utils/highlight-anchor.test.ts`
- Modify: `frontend/src/views/Reader.vue`
- Modify: `CHANGELOG.md`（`## [Unreleased-study]` → `### 新增`）、`docs/api.md`（划线一节补一句：PDF 的 `chapterIndex` 为页码 - 1，偏移基于阅读器文字层文字）、`tasks/todo.md`

**Interfaces:**
- Consumes: Task 3 的 `.pdf-text-layer` 元素与 `text-ready` 事件。
- Produces:
  - `highlight-anchor.ts`：`export const HL_CONTENT_SELECTOR = '.chapter-content:not(.pdf-chapter), .pdf-text-layer'`；`chapterContentOf(node, root)` 在节点位于 `.pdf-text-layer` 内时返回该文字层元素（仍须在 root 内），其余行为不变（`.pdf-chapter` 本身仍返回 null）。
  - `Reader.vue`：
    - `highlightable = !!format && !isPdf`（PDF 按页渲染可划线）。
    - 所有查找正文容器做划线的地方（`refreshHighlights`、`waitChapterContent`、跳转闪烁）改用 `HL_CONTENT_SELECTOR`；章节号仍由 `chapterIndexOf`（瀑布流取 `section[data-chapter-index]`，翻页模式为当前章）得到。
    - 两处 `.pdf-chapter` 容器加上与普通正文相同的 `@pointerup="onContentPointerUp"` 与 `@click.capture="handleContentClick"`。
    - `PdfPage` 的 `@text-ready` → 记录 `pdfPageText: Map<number, boolean>`（键为章节号），然后 `refreshHighlights()`；若有待跳转的划线（跳转时文字层尚未就绪）此时再定位。
    - 「笔记」入口（顶栏 `nav-btn` 与右侧 `side-tool` 两处）：当前页（`reader.currentChapterIndex`）在 `pdfPageText` 中为 `false` 时加灰化样式、悬停提示「PDF 格式不支持」，仍可点击打开笔记列表（查看其他页划线）；原生打开方式（`isPdf`）的顶栏 `.pdf-topbar` 增加一个禁用的「笔记」图标按钮，悬停提示「当前 PDF 打开方式不支持划线，可在设置中开启 PDF 插件」。
    - 样式：`.pdf-text-layer mark.hl` 文字保持透明、底色沿用 `mark.hl`；有批注样式同普通书。

- [ ] **Step 1: 写失败测试**（`highlight-anchor.test.ts`）

```ts
it('chapterContentOf returns the pdf text layer for selections inside it', () => {
  // root > div.chapter-content.pdf-chapter > div.pdf-page > div.pdf-text-layer > span > text
  // chapterContentOf(text, root) === 文字层元素；chapterContentOf(pdfChapter, root) === null；root 外的文字层 → null
})
it('rangeToAnchor and applyHighlights work on a text layer with separator nodes', () => {
  // 文字层：<span>quick</span>' '<br><span>brown fox</span>；选中 'quick brown' → anchor { start: 0, end: 11 }、text 'quick brown'；
  // applyHighlights 后 mark.hl 的文字拼起来等于 'quick brown'
})
```

- [ ] **Step 2: 运行确认失败** — `cd frontend && npx vitest run src/utils/highlight-anchor.test.ts`。
- [ ] **Step 3: 实现**（见 Interfaces）。
- [ ] **Step 4: 运行通过**；全量 `cd frontend && npx vitest run && npx vue-tsc --noEmit`，`cd backend && npx jest`。

- [ ] **Step 5: 浏览器实测**（开发服务 + 数据副本；PDF 插件开启）
  - 文字版：`books/傲慢与偏见.pdf`——章节模式与瀑布流各划一段英文跨行文字、写批注：底色与文字对齐；刷新后仍在原处；笔记列表、划线管理出现该条，原文跨行处有空格；改窗口宽度后底色随文字层重画且对齐；点已有划线可改批注、删除；跨页选区被拒绝。
  - 学习导图对该划线「AI 展开」成功；笔记整理生成 / 更新后，书本图标跳回 PDF 对应页并闪烁定位。
  - 扫描版与混排：用脚本生成一个只含图片的 PDF 与一个「文字页 + 图片页」混排 PDF（测试后删除，不提交）——图片页「笔记」入口灰化并提示「PDF 格式不支持」，文字页正常。
  - 原生打开方式：设置中关闭 PDF 插件 → 顶栏「笔记」灰化，提示原生方式文案；测试后恢复设置。
  - 手机宽度（390）：长按选字出菜单、划线可用。

- [ ] **Step 6: 文档并提交**
  - CHANGELOG：「- **学习**：PDF（按页渲染方式）支持划线与批注，划线进入笔记与笔记整理；扫描版 / 图片页暂不支持」。

```bash
git add frontend/src/utils/highlight-anchor.ts frontend/src/utils/highlight-anchor.test.ts frontend/src/views/Reader.vue CHANGELOG.md docs/api.md tasks/todo.md
git commit -m "feat(study): PDF 支持划线与批注"
```
