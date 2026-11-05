<template>
  <div class="mm-canvas">
    <svg ref="svgEl" class="mm-svg" width="100%" height="100%">
      <g ref="viewportEl">
        <g class="mm-links">
          <path v-for="l in layout.links" :key="`${l.from}>${l.to}`" class="mm-link" :d="l.path" fill="none" stroke-width="1.5" />
        </g>
        <g
          v-for="n in layout.nodes"
          :key="n.id"
          class="mm-node"
          :class="[`mm-s-${styleKey(n.data)}`, { 'is-selected': n.id === selectedId }]"
          :data-style="styleKey(n.data)"
          :transform="`translate(${n.x},${n.y})`"
          @click="emit('select', n.id)"
        >
          <title>{{ n.data.label }}</title>
          <rect class="mm-rect" :width="n.width" :height="NODE_HEIGHT" :y="-NODE_HEIGHT / 2" rx="6" ry="6" stroke-width="1" />
          <text
            class="mm-text"
            :x="NODE_PAD_X"
            y="0"
            dominant-baseline="central"
            :font-family="FONT_FAMILY"
            :font-size="fontOf(n.data.type).size"
            :font-weight="fontOf(n.data.type).weight"
          >{{ displayLabel(n.data.label) }}</text>
          <g
            v-if="n.hasChildren"
            class="mm-toggle"
            :transform="`translate(${n.width + TOGGLE_OFFSET},0)`"
            @click.stop="toggle(n.id)"
          >
            <!-- 透明的大圆扩大手指点按区域 -->
            <circle r="12" fill="transparent" />
            <circle class="mm-toggle-ring" r="7" stroke-width="1" />
            <path class="mm-toggle-sign" :d="n.collapsed ? 'M-3.5,0H3.5M0,-3.5V3.5' : 'M-3.5,0H3.5'" fill="none" stroke-width="1.4" />
          </g>
        </g>
      </g>
    </svg>
  </div>
</template>

<script setup lang="ts">
/**
 * 总导图画布：SVG 水平树 + d3-zoom 缩放平移；节点折叠；导出 PNG。
 * 视口变换直接写到 <g> 的 transform 属性上（不走响应式），缩放/拖动时不触发组件重渲染，大书也流畅。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { select } from 'd3-selection'
import { zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom'
import type { MapNode, MapNodeType } from '../utils/book-map'
import { layoutMap, initialCollapsed, displayLabel, exportScale, NODE_HEIGHT, NODE_PAD_X } from '../utils/map-layout'

const props = defineProps<{ root: MapNode; selectedId: string | null }>()
const emit = defineEmits<{ select: [id: string] }>()

const INITIAL_DEPTH = 3
const TOGGLE_OFFSET = 10
const MIN_SCALE = 0.2
const MAX_SCALE = 3
/** fit() 时的最小缩放：整图放不下时不再缩小到看不清，改为左对齐并让根节点竖直居中 */
const FIT_MIN_SCALE = 0.5
const FONT_FAMILY = "'Noto Sans SC', system-ui, sans-serif"

type StyleKey = 'book' | 'group' | 'chapter' | 'highlight' | 'event' | 'concept' | 'person' | 'custom' | 'muted'

/** 导出 PNG 用的固定亮色（与样式表中亮色主题下的 CSS 变量取值一致） */
const LIGHT_PALETTE: Record<StyleKey, { fill: string; stroke: string; text: string }> = {
  book: { fill: '#4f46e5', stroke: '#4338ca', text: '#ffffff' },
  group: { fill: '#e0e7ff', stroke: '#a5b4fc', text: '#312e81' },
  chapter: { fill: '#f1f5f9', stroke: '#94a3b8', text: '#1e293b' },
  highlight: { fill: '#fef3c7', stroke: '#f59e0b', text: '#78350f' },
  event: { fill: '#dbeafe', stroke: '#3b82f6', text: '#1e3a8a' },
  concept: { fill: '#dcfce7', stroke: '#22c55e', text: '#14532d' },
  person: { fill: '#fce7f3', stroke: '#ec4899', text: '#831843' },
  custom: { fill: '#ede9fe', stroke: '#8b5cf6', text: '#4c1d95' },
  muted: { fill: '#f8fafc', stroke: '#e2e8f0', text: '#8b95a7' },
}
const LIGHT_LINK = '#cbd5e1'
const LIGHT_TOGGLE = { fill: '#ffffff', stroke: '#94a3b8', sign: '#475569' }

function styleKey(n: MapNode): StyleKey {
  if (n.type === 'mind') return n.kind ?? 'custom'
  if (!n.hasNotes) return 'muted'                   // 没有笔记的骨架节点灰显
  if (n.type === 'book') return 'book'
  return n.type === 'chapter' ? 'chapter' : 'group' // 未归类沿用分组样式
}

function fontOf(type: MapNodeType): { size: number; weight: number } {
  return type === 'book' ? { size: 15, weight: 600 } : type === 'mind' ? { size: 13, weight: 400 } : { size: 13, weight: 500 }
}

// 文字宽度：canvas measureText，按 类型+文字 缓存；拿不到 2d 上下文（如测试环境）时按字数估算
const widthCache = new Map<string, number>()
let measureCtx: CanvasRenderingContext2D | null | undefined
function measureText(label: string, type: MapNodeType): number {
  const key = `${type}\u0000${label}`
  const cached = widthCache.get(key)
  if (cached !== undefined) return cached
  const { size, weight } = fontOf(type)
  if (measureCtx === undefined) {
    try { measureCtx = document.createElement('canvas').getContext('2d') } catch { measureCtx = null }
  }
  let w: number
  if (measureCtx) {
    measureCtx.font = `${weight} ${size}px ${FONT_FAMILY}`
    w = measureCtx.measureText(label).width
  } else {
    w = Array.from(label).length * size
  }
  widthCache.set(key, w)
  return w
}

// 折叠状态：root 变化时保留已有节点的折叠状态，新出现的节点按初始规则（深度 ≥ 3 折叠）
const collapsed = shallowRef<Set<string>>(new Set())
let knownIds = new Set<string>()
function syncCollapsed(root: MapNode) {
  const initial = initialCollapsed(root, INITIAL_DEPTH)
  const next = new Set<string>()
  const ids = new Set<string>()
  const walk = (n: MapNode) => {
    ids.add(n.id)
    if (knownIds.has(n.id) ? collapsed.value.has(n.id) : initial.has(n.id)) next.add(n.id)
    n.children.forEach(walk)
  }
  walk(root)
  knownIds = ids
  collapsed.value = next
}
syncCollapsed(props.root)

const layout = computed(() => layoutMap(props.root, collapsed.value, measureText))

const svgEl = ref<SVGSVGElement | null>(null)
const viewportEl = ref<SVGGElement | null>(null)
let zoomer: ZoomBehavior<SVGSVGElement, unknown> | null = null
/** 是否已经成功 fit 过：只在第一次有内容且可见时自动 fit，之后 root 变化（编辑）保留用户的缩放/平移 */
let fitted = false
let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  const svg = svgEl.value
  if (!svg) return
  zoomer = zoom<SVGSVGElement, unknown>()
    .extent(() => [[0, 0], [svg.clientWidth, svg.clientHeight]])
    .scaleExtent([MIN_SCALE, MAX_SCALE])
    .clickDistance(4)   // 轻微抖动仍算点击，不被当成拖动吞掉
    .on('zoom', e => { viewportEl.value?.setAttribute('transform', e.transform.toString()) })
  // 双击（含双指轻点）不缩放
  select(svg).call(zoomer).on('dblclick.zoom', null)
  // 首次挂载时可能尚不可见（尺寸为 0），等到有尺寸时再补一次 fit
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => { if (!fitted) fit() })
    resizeObserver.observe(svg)
  }
  nextTick(fit)
})

onBeforeUnmount(() => {
  if (svgEl.value) select(svgEl.value).on('.zoom', null)
  resizeObserver?.disconnect()
  resizeObserver = null
  zoomer = null
})

watch(() => props.root, root => {
  syncCollapsed(root)
  if (!fitted) nextTick(fit)
})

function fit() {
  const svg = svgEl.value
  if (!svg || !zoomer) return
  const cw = svg.clientWidth, ch = svg.clientHeight
  if (!cw || !ch) return
  const { width, height, nodes } = layout.value
  if (nodes.length < 2) return   // 只有书名（数据还没加载好）时不算首次 fit
  const k = Math.max(FIT_MIN_SCALE, Math.min(cw / width, ch / height, 1))
  const tx = width * k <= cw ? (cw - width * k) / 2 : 0
  const rootY = nodes[0]?.y ?? height / 2
  const ty = height * k <= ch ? (ch - height * k) / 2 : ch / 2 - rootY * k
  select(svg).call(zoomer.transform, zoomIdentity.translate(tx, ty).scale(k))
  fitted = true
}

/** 折叠/展开后保持被点的节点在屏幕上的位置不动 */
function toggle(id: string) {
  const before = layout.value.nodes.find(n => n.id === id)
  const next = new Set(collapsed.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  collapsed.value = next
  const after = layout.value.nodes.find(n => n.id === id)
  if (!before || !after) return
  // 等 DOM 按新布局更新后再平移，避免先跳一下
  nextTick(() => {
    if (svgEl.value && zoomer) select(svgEl.value).call(zoomer.translateBy, before.x - after.x, before.y - after.y)
  })
}

function collapseAll() {
  // 保留根节点展开，否则只剩一个书名
  collapsed.value = initialCollapsed(props.root, 1)
  nextTick(fit)
}

function expandAll() {
  collapsed.value = new Set()
  nextTick(fit)
}

/**
 * 导出当前展开状态的整张图：克隆 SVG，颜色写成属性（固定亮色、不依赖 CSS 变量），白底，默认 2 倍像素。
 * 返回实际倍率：小于 1 说明图太大被缩小，调用方可提示用户
 */
async function exportPng(): Promise<{ blob: Blob; scale: number }> {
  const svg = svgEl.value
  if (!svg) throw new Error('导图尚未渲染')
  const { width, height } = layout.value
  const NS = 'http://www.w3.org/2000/svg'
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', NS)
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  clone.setAttribute('viewBox', `0 0 ${width} ${height}`)
  clone.removeAttribute('class')
  clone.querySelector(':scope > g')?.removeAttribute('transform')
  const bg = document.createElementNS(NS, 'rect')
  bg.setAttribute('width', '100%')
  bg.setAttribute('height', '100%')
  bg.setAttribute('fill', '#ffffff')
  clone.insertBefore(bg, clone.firstChild)
  clone.querySelectorAll('.mm-link').forEach(el => el.setAttribute('stroke', LIGHT_LINK))
  clone.querySelectorAll('.mm-node').forEach(g => {
    const p = LIGHT_PALETTE[(g.getAttribute('data-style') as StyleKey) || 'custom'] ?? LIGHT_PALETTE.custom
    g.querySelector('.mm-rect')?.setAttribute('fill', p.fill)
    g.querySelector('.mm-rect')?.setAttribute('stroke', p.stroke)
    g.querySelector('.mm-text')?.setAttribute('fill', p.text)
    g.querySelector('.mm-toggle-ring')?.setAttribute('fill', LIGHT_TOGGLE.fill)
    g.querySelector('.mm-toggle-ring')?.setAttribute('stroke', LIGHT_TOGGLE.stroke)
    g.querySelector('.mm-toggle-sign')?.setAttribute('stroke', LIGHT_TOGGLE.sign)
    g.querySelector('title')?.remove()
  })

  const scale = exportScale(width, height)
  // 大图的 SVG 文本很长，用 Blob URL 代替 data: URL
  const svgUrl = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml;charset=utf-8' }))
  const img = new Image()
  try {
    img.src = svgUrl
    await img.decode()
  } finally {
    URL.revokeObjectURL(svgUrl)
  }
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(width * scale)
  canvas.height = Math.ceil(height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('浏览器不支持导出图片')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.scale(scale, scale)
  ctx.drawImage(img, 0, 0, width, height)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('导出图片失败'))), 'image/png')
  })
  return { blob, scale }
}

defineExpose({ fit, collapseAll, expandAll, exportPng })
</script>

<style scoped>
/* 亮色取值与脚本中的 LIGHT_PALETTE 一致；深色主题（html.dark）下覆盖 */
.mm-canvas {
  --mm-book-fill: #4f46e5; --mm-book-stroke: #4338ca; --mm-book-text: #ffffff;
  --mm-group-fill: #e0e7ff; --mm-group-stroke: #a5b4fc; --mm-group-text: #312e81;
  --mm-chapter-fill: #f1f5f9; --mm-chapter-stroke: #94a3b8; --mm-chapter-text: #1e293b;
  --mm-highlight-fill: #fef3c7; --mm-highlight-stroke: #f59e0b; --mm-highlight-text: #78350f;
  --mm-event-fill: #dbeafe; --mm-event-stroke: #3b82f6; --mm-event-text: #1e3a8a;
  --mm-concept-fill: #dcfce7; --mm-concept-stroke: #22c55e; --mm-concept-text: #14532d;
  --mm-person-fill: #fce7f3; --mm-person-stroke: #ec4899; --mm-person-text: #831843;
  --mm-custom-fill: #ede9fe; --mm-custom-stroke: #8b5cf6; --mm-custom-text: #4c1d95;
  --mm-muted-fill: #f8fafc; --mm-muted-stroke: #e2e8f0; --mm-muted-text: #8b95a7;
  --mm-link: #cbd5e1;
  --mm-toggle-fill: #ffffff; --mm-toggle-stroke: #94a3b8; --mm-toggle-sign: #475569;
  --mm-selected: var(--accent, #4f46e5);
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  user-select: none;
  -webkit-user-select: none;
}
:global(html.dark) .mm-canvas {
  --mm-book-fill: #6366f1; --mm-book-stroke: #818cf8; --mm-book-text: #ffffff;
  --mm-group-fill: #312e81; --mm-group-stroke: #6366f1; --mm-group-text: #e0e7ff;
  --mm-chapter-fill: #1e293b; --mm-chapter-stroke: #475569; --mm-chapter-text: #e2e8f0;
  --mm-highlight-fill: #422006; --mm-highlight-stroke: #d97706; --mm-highlight-text: #fde68a;
  --mm-event-fill: #172554; --mm-event-stroke: #3b82f6; --mm-event-text: #bfdbfe;
  --mm-concept-fill: #052e16; --mm-concept-stroke: #16a34a; --mm-concept-text: #bbf7d0;
  --mm-person-fill: #500724; --mm-person-stroke: #db2777; --mm-person-text: #fbcfe8;
  --mm-custom-fill: #2e1065; --mm-custom-stroke: #8b5cf6; --mm-custom-text: #ddd6fe;
  --mm-muted-fill: #111827; --mm-muted-stroke: #334155; --mm-muted-text: #64748b;
  --mm-link: #475569;
  --mm-toggle-fill: #1e293b; --mm-toggle-stroke: #64748b; --mm-toggle-sign: #cbd5e1;
}
.mm-svg { display: block; cursor: grab; }
.mm-svg:active { cursor: grabbing; }
.mm-link { stroke: var(--mm-link); }
.mm-node { cursor: pointer; }
.mm-toggle-ring { fill: var(--mm-toggle-fill); stroke: var(--mm-toggle-stroke); }
.mm-toggle-sign { stroke: var(--mm-toggle-sign); }

.mm-s-book .mm-rect { fill: var(--mm-book-fill); stroke: var(--mm-book-stroke); }
.mm-s-book .mm-text { fill: var(--mm-book-text); }
.mm-s-group .mm-rect { fill: var(--mm-group-fill); stroke: var(--mm-group-stroke); }
.mm-s-group .mm-text { fill: var(--mm-group-text); }
.mm-s-chapter .mm-rect { fill: var(--mm-chapter-fill); stroke: var(--mm-chapter-stroke); }
.mm-s-chapter .mm-text { fill: var(--mm-chapter-text); }
.mm-s-highlight .mm-rect { fill: var(--mm-highlight-fill); stroke: var(--mm-highlight-stroke); }
.mm-s-highlight .mm-text { fill: var(--mm-highlight-text); }
.mm-s-event .mm-rect { fill: var(--mm-event-fill); stroke: var(--mm-event-stroke); }
.mm-s-event .mm-text { fill: var(--mm-event-text); }
.mm-s-concept .mm-rect { fill: var(--mm-concept-fill); stroke: var(--mm-concept-stroke); }
.mm-s-concept .mm-text { fill: var(--mm-concept-text); }
.mm-s-person .mm-rect { fill: var(--mm-person-fill); stroke: var(--mm-person-stroke); }
.mm-s-person .mm-text { fill: var(--mm-person-text); }
.mm-s-custom .mm-rect { fill: var(--mm-custom-fill); stroke: var(--mm-custom-stroke); }
.mm-s-custom .mm-text { fill: var(--mm-custom-text); }
.mm-s-muted .mm-rect { fill: var(--mm-muted-fill); stroke: var(--mm-muted-stroke); }
.mm-s-muted .mm-text { fill: var(--mm-muted-text); }
/* 放在类型样式之后，覆盖其描边 */
.mm-node.is-selected .mm-rect { stroke: var(--mm-selected); stroke-width: 2.5; }
</style>
