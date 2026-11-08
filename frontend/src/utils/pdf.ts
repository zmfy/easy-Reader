// legacy 构建兼容较旧的手机浏览器
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy, type PDFPageProxy, type PageViewport } from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

// 由 vite.config.ts 的 pdfjsAssets 插件提供（开发）/ 复制到 dist（构建）
const ASSET_BASE = `${import.meta.env.BASE_URL}pdfjs/`

import { dedupeTextItems, eolSeparator, pageHasText, type PdfTextItemLike } from './pdf-text'

export type { PDFDocumentProxy, PDFPageProxy, PageViewport }

/** 从完整文件数据打开 PDF；data 会被转移给 worker，调用方之后不能再使用它 */
export function openPdfDocument(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  return getDocument({
    data: new Uint8Array(data),
    cMapUrl: `${ASSET_BASE}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${ASSET_BASE}standard_fonts/`,
    wasmUrl: `${ASSET_BASE}wasm/`,
    iccUrl: `${ASSET_BASE}iccs/`,
  }).promise
}

/**
 * 在 container 中渲染可选中的文字层（伪粗体去重；行尾按后端规则补分隔，使 textContent 跨行可读）。
 * viewport 用 CSS 尺寸（不乘像素比）。promise 结果为本页是否有文字。
 */
export function renderPdfTextLayer(
  page: PDFPageProxy, container: HTMLElement, viewport: PageViewport,
): { promise: Promise<boolean>; cancel: () => void } {
  let layer: TextLayer | null = null
  let cancelled = false
  container.replaceChildren()
  // setLayerDimensions 用这些变量算文字层尺寸
  container.style.setProperty('--total-scale-factor', String(viewport.scale))
  container.style.setProperty('--scale-round-x', '1px')
  container.style.setProperty('--scale-round-y', '1px')
  const promise = (async () => {
    const content = await page.getTextContent()
    if (cancelled) return false
    const items = dedupeTextItems(content.items as unknown as PdfTextItemLike[])
    layer = new TextLayer({ textContentSource: { ...content, items: items as never }, container, viewport })
    await layer.render()
    if (cancelled) return false
    insertEolSeparators(container)
    return pageHasText(items)
  })()
  return { promise, cancel: () => { cancelled = true; layer?.cancel() } }
}

// 行尾 <br> 前补分隔：放进零字号的 span（文字层样式让它透明、绝对定位），不影响版面与选区外观
function insertEolSeparators(container: HTMLElement): void {
  container.querySelectorAll('br').forEach(br => {
    const sep = eolSeparator(br.previousSibling?.textContent ?? '', br.nextSibling?.textContent ?? '')
    if (!sep) return
    const span = document.createElement('span')
    span.className = 'pdf-eol'
    span.textContent = sep
    br.before(span)
  })
}
