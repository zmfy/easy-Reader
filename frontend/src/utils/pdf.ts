// legacy 构建兼容较旧的手机浏览器
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

// 由 vite.config.ts 的 pdfjsAssets 插件提供（开发）/ 复制到 dist（构建）
const ASSET_BASE = `${import.meta.env.BASE_URL}pdfjs/`

export type { PDFDocumentProxy }

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
