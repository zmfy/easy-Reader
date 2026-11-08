<template>
  <div ref="rootRef" class="pdf-page" :style="{ aspectRatio }">
    <canvas ref="canvasRef" class="pdf-page-canvas" />
    <div ref="textRef" class="pdf-text-layer textLayer" @mousedown="onLayerMouseDown" />
    <div v-if="failed" class="pdf-page-error">本页渲染失败</div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { renderPdfTextLayer, type PDFDocumentProxy } from '@/utils/pdf'

const props = defineProps<{ doc: PDFDocumentProxy; pageNumber: number }>()
// 文字层每次渲染完成（含尺寸变化后重渲染）报告本页是否有可选中的文字
const emit = defineEmits<{ (e: 'text-ready', pageNumber: number, hasText: boolean): void }>()
const textRef = ref<HTMLElement | null>(null)
let textTask: { cancel: () => void } | null = null

const rootRef = ref<HTMLElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
// 页面尺寸加载前先按 A4 比例占位，避免渲染完成时内容高度跳动
const aspectRatio = ref('210 / 297')
const failed = ref(false)

// 手机常见 3 倍屏按 2 倍渲染：清晰度足够，画布内存减半以上
const MAX_PIXEL_RATIO = 2

let renderTask: { cancel: () => void; promise: Promise<void> } | null = null
let renderSeq = 0
let requestedWidth = 0

async function render() {
  const root = rootRef.value
  const canvas = canvasRef.value
  if (!root || !canvas) return
  const cssWidth = root.clientWidth
  if (cssWidth === 0) return
  const seq = ++renderSeq
  requestedWidth = cssWidth
  renderTask?.cancel()
  renderTask = null
  textTask?.cancel()
  textTask = null
  // 文字层重建中：父组件据此判断本页文字是否可用（data-ready 在渲染完成后才设置）
  textRef.value?.removeAttribute('data-ready')
  failed.value = false
  try {
    const page = await props.doc.getPage(props.pageNumber)
    if (seq !== renderSeq) return
    const base = page.getViewport({ scale: 1 })
    aspectRatio.value = `${base.width} / ${base.height}`
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO)
    const viewport = page.getViewport({ scale: (cssWidth * ratio) / base.width })
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    const task = page.render({ canvas, viewport })
    renderTask = task
    await task.promise
    if (seq !== renderSeq) return
    await renderText(page, seq, cssWidth / base.width)
  } catch (err) {
    // 翻页 / 尺寸变化时取消旧渲染属于正常情况
    if ((err as Error)?.name === 'RenderingCancelledException' || seq !== renderSeq) return
    console.error('[pdf] render page failed', props.pageNumber, err)
    failed.value = true
  }
}

// 文字层失败不影响阅读（只是不能划线），按无文字处理
async function renderText(page: Awaited<ReturnType<PDFDocumentProxy['getPage']>>, seq: number, scale: number) {
  const el = textRef.value
  if (!el) return
  const task = renderPdfTextLayer(page, el, page.getViewport({ scale }))
  textTask = task
  let hasText = false
  try {
    hasText = await task.promise
  } catch (err) {
    if (seq === renderSeq) console.error('[pdf] text layer failed', props.pageNumber, err)
  }
  if (seq !== renderSeq) return
  // 与 pdf.js 查看器一致：末尾放 endOfContent，拖选时（selecting）铺满整层，
  // 鼠标经过行间空白时命中它而不是文字层本身，避免选区跳到整页开头 / 结尾
  const end = document.createElement('div')
  end.className = 'endOfContent'
  el.append(end)
  el.dataset.ready = '1'
  emit('text-ready', props.pageNumber, hasText)
}

function onLayerMouseDown() {
  textRef.value?.classList.add('selecting')
  document.addEventListener('mouseup', onDocMouseUp, { once: true })
}

function onDocMouseUp() {
  textRef.value?.classList.remove('selecting')
}

// 容器宽度变化（旋转屏幕、调整页面宽度）时按新宽度重绘，保持清晰
let resizeRaf = 0
const observer = new ResizeObserver(() => {
  cancelAnimationFrame(resizeRaf)
  resizeRaf = requestAnimationFrame(() => {
    if (rootRef.value && rootRef.value.clientWidth !== requestedWidth) render()
  })
})

watch(() => [props.doc, props.pageNumber], () => render())

onMounted(() => {
  if (rootRef.value) observer.observe(rootRef.value)
  render()
})

onBeforeUnmount(() => {
  renderSeq++
  renderTask?.cancel()
  textTask?.cancel()
  document.removeEventListener('mouseup', onDocMouseUp)
  observer.disconnect()
  cancelAnimationFrame(resizeRaf)
})
</script>

<style scoped>
.pdf-page {
  position: relative;
  /* 画布与文字层的混合限定在本页内 */
  isolation: isolate;
  width: 100%;
  background: #fff;
  box-shadow: 0 2px 16px rgba(0, 0, 0, 0.35);
}

/* 画布盖在文字层上并以 multiply 混合：白底透出下面的划线 / 选区底色，黑字保持清晰；
   不接收指针事件，选字落在下面的文字层上 */
.pdf-page-canvas {
  position: relative;
  z-index: 1;
  display: block;
  width: 100%;
  height: 100%;
  mix-blend-mode: multiply;
  pointer-events: none;
}

/* pdf.js 文字层（取自 pdfjs-dist/web/pdf_viewer.css 的 .textLayer 必需部分）：文字透明、可选中、与画面对齐 */
.pdf-text-layer {
  position: absolute;
  inset: 0;
  overflow: clip;
  line-height: 1;
  text-align: initial;
  letter-spacing: normal;
  word-spacing: normal;
  text-size-adjust: none;
  forced-color-adjust: none;
  transform-origin: 0 0;
  z-index: 0;
  --min-font-size: 1;
  --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
  --min-font-size-inv: calc(1 / var(--min-font-size));
}
.pdf-text-layer :deep(:is(span, br)) {
  color: transparent;
  position: absolute;
  white-space: pre;
  cursor: text;
  transform-origin: 0% 0%;
  user-select: text;
}
.pdf-text-layer :deep(> :not(.markedContent)),
.pdf-text-layer :deep(.markedContent span:not(.markedContent)) {
  z-index: 1;
  --font-height: 0;
  font-size: calc(var(--text-scale-factor) * var(--font-height));
  --scale-x: 1;
  --rotate: 0deg;
  transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
}
.pdf-text-layer :deep(.markedContent) { display: contents; }
.pdf-text-layer :deep(span[role="img"]) { user-select: none; cursor: default; }
.pdf-text-layer :deep(::selection) { background: color-mix(in srgb, var(--accent) 30%, transparent); color: transparent; }
.pdf-text-layer :deep(br::selection) { background: transparent; }
.pdf-text-layer :deep(.endOfContent) {
  display: block; position: absolute; inset: 100% 0 0; z-index: 0; cursor: default; user-select: none;
}
.pdf-text-layer.selecting :deep(.endOfContent) { top: 0; }
.pdf-text-layer :deep(.pdf-eol) { font-size: 0; }

.pdf-page-error {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #888;
  font-size: 14px;
}
</style>
