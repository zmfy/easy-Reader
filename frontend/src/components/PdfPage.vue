<template>
  <div ref="rootRef" class="pdf-page" :style="{ aspectRatio }">
    <canvas ref="canvasRef" class="pdf-page-canvas" />
    <div v-if="failed" class="pdf-page-error">本页渲染失败</div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import type { PDFDocumentProxy } from '@/utils/pdf'

const props = defineProps<{ doc: PDFDocumentProxy; pageNumber: number }>()

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
  } catch (err) {
    // 翻页 / 尺寸变化时取消旧渲染属于正常情况
    if ((err as Error)?.name === 'RenderingCancelledException' || seq !== renderSeq) return
    console.error('[pdf] render page failed', props.pageNumber, err)
    failed.value = true
  }
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
  observer.disconnect()
  cancelAnimationFrame(resizeRaf)
})
</script>

<style scoped>
.pdf-page {
  position: relative;
  width: 100%;
  background: #fff;
  box-shadow: 0 2px 16px rgba(0, 0, 0, 0.35);
}

.pdf-page-canvas {
  display: block;
  width: 100%;
  height: 100%;
}

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
