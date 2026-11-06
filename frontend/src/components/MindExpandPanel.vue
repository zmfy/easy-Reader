<template>
  <el-drawer
    v-model="visible"
    :direction="isNarrow ? 'btt' : 'rtl'"
    :size="isNarrow ? (fullscreen ? '100%' : '55%') : '420px'"
    class="mind-drawer"
  >
    <template #header>
      <div class="mind-head">
        <span class="mind-title">AI 展开 · {{ titleText }}</span>
        <button v-if="isNarrow" class="mind-link" @click="fullscreen = !fullscreen">{{ fullscreen ? '收起' : '展开全屏' }}</button>
      </div>
    </template>

    <div v-if="loadingKept" class="mind-hint"><el-icon class="is-loading"><IconLoader2 /></el-icon> 加载中…</div>
    <div v-else-if="loadError" class="mind-hint mind-error">{{ loadError }}</div>
    <ul v-else class="mind-list">
      <li v-for="{ node, depth } in rows" :key="node.key" class="mind-item" :style="{ paddingLeft: `${depth * 18}px` }">
        <div
          class="mind-node"
          :class="{ kept: node.kept || node.key === 'root', candidate: !node.kept && node.key !== 'root', selected: selectedKey === node.key }"
          @click="selectedKey = selectedKey === node.key ? null : node.key"
        >
          <div class="mind-node-main">
            <span class="mind-kind" :class="`kind-${node.kind}`">{{ KIND_LABEL[node.kind] }}</span>
            <span class="mind-label">{{ node.label }}</span>
            <el-icon v-if="expanding[node.key]" class="is-loading mind-spin"><IconLoader2 /></el-icon>
          </div>
          <div v-if="node.summary" class="mind-summary">{{ node.summary }}</div>
          <div v-if="expansions[node.key]" class="mind-meta" @click.stop>
            <span v-if="expansions[node.key].cached" class="mind-cached">来自缓存</span>
            <button class="mind-link" :disabled="busy || expanding[node.key]" @click="expand(node.key, true)">重新生成</button>
          </div>
          <div v-if="selectedKey === node.key" class="mind-actions" @click.stop>
            <el-button v-if="!node.kept && node.key !== 'root'" size="small" type="primary" :disabled="locked" @click="keep(node.key)">保留</el-button>
            <el-button v-if="!expansions[node.key] && depth < MAX_EXPAND_DEPTH" size="small" :disabled="busy || expanding[node.key]" @click="expand(node.key)">继续展开</el-button>
            <el-button v-if="node.source" size="small" :class="{ later: node.source.later }" @click="jump(node)">{{ sourceText(node) }}</el-button>
            <el-button v-if="node.kept && node.key !== 'root'" size="small" type="danger" plain :disabled="locked" @click="remove(node)">删除</el-button>
          </div>
        </div>
      </li>
    </ul>
  </el-drawer>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import { IconLoader2 } from '@tabler/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { readerApi } from '../api/reader'
import type { Highlight, MindNode, ExpandedCandidate } from '../types'
import { buildMindTree, chainTo, pathTo, keyMoves, type TreeNode } from '../utils/mind-tree'

const props = defineProps<{ bookId: string; highlight: Highlight; chapters: Array<{ index: number; title: string }>; modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; jump: [payload: { chapterIndex: number; label: string }] }>()

// 保留链最多 10 级（根为第 0 级）：第 10 级节点再展开出的候选无法保留，不再提供「继续展开」
const MAX_EXPAND_DEPTH = 10

const KIND_LABEL: Record<MindNode['kind'], string> = { highlight: '划线', event: '事件', concept: '概念', person: '人物', custom: '自定义' }

const isNarrow = useMediaQuery('(max-width: 768px)')
const fullscreen = ref(false)
const visible = computed({ get: () => props.modelValue, set: v => emit('update:modelValue', v) })
const titleText = computed(() => {
  const t = props.highlight.text
  return t.length > 12 ? `${t.slice(0, 12)}…` : t
})

const kept = ref<MindNode[]>([])
/** 父 key → 该节点最近一次展开的候选（未保留的候选只存在这里） */
const candidates = ref<Record<string, ExpandedCandidate[]>>({})
/** 节点 key → 最近一次展开是否来自缓存 */
const expansions = ref<Record<string, { cached: boolean }>>({})
const expanding = ref<Record<string, boolean>>({})
const selectedKey = ref<string | null>(null)
const loadingKept = ref(false)
const loadError = ref('')
const busy = ref(false)
let loadedFor = ''
// 保留/删除会让节点 key 迁移，与进行中的展开互斥
const locked = computed(() => busy.value || Object.keys(expanding.value).length > 0)

const tree = computed(() => buildMindTree(kept.value, candidates.value, props.highlight.text))
const rows = computed(() => {
  const out: Array<{ node: TreeNode; depth: number }> = []
  const walk = (n: TreeNode, depth: number) => {
    out.push({ node: n, depth })
    n.children.forEach(c => walk(c, depth + 1))
  }
  walk(tree.value, 0)
  return out
})

function findNode(t: TreeNode, key: string): TreeNode | null {
  if (t.key === key) return t
  for (const c of t.children) {
    const f = findNode(c, key)
    if (f) return f
  }
  return null
}

function errorText(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { code?: string; message?: string } }; code?: string }
  // 只有 AI 输出解析失败用固定文案；其他 422（如参数校验）显示后端给的原因
  if (e.response?.data?.code === 'AI_BAD_OUTPUT') return 'AI 返回格式不正确，请重试'
  if (e.code === 'ECONNABORTED') return 'AI 响应超时，请稍后再试'
  return e.response?.data?.message || fallback
}

function chapterTitle(index: number): string {
  return props.chapters.find(c => c.index === index)?.title || `第 ${index + 1} 章`
}

function sourceText(node: TreeNode): string {
  const s = node.source!
  // 章节名一律按目录（含手动修正的章节名）显示；已保留节点的 later 由服务端按当前阅读边界算出
  const title = chapterTitle(s.chapterIndex)
  return s.later ? `📖 后文·${title}` : `📖 ${title}`
}

async function fetchKept(): Promise<MindNode[]> {
  const resp = await readerApi.getMindNodes(props.bookId, props.highlight.id)
  return resp.data.data ?? []
}

// 已保留节点变了：重新载入，并把候选 / 展开状态的 key 迁到新树上
async function refreshKept() {
  const highlightId = props.highlight.id
  const before = tree.value
  const nodes = await fetchKept()
  if (highlightId !== props.highlight.id) return
  kept.value = nodes
  const moves = keyMoves(before, tree.value)
  const move = <T,>(rec: Record<string, T>) => {
    const out: Record<string, T> = {}
    for (const [k, v] of Object.entries(rec)) out[moves[k] ?? k] = v
    return out
  }
  candidates.value = move(candidates.value)
  expansions.value = move(expansions.value)
  if (selectedKey.value) selectedKey.value = moves[selectedKey.value] ?? selectedKey.value
}

async function load() {
  const highlightId = props.highlight.id
  loadedFor = highlightId
  kept.value = []
  candidates.value = {}
  expansions.value = {}
  expanding.value = {}
  selectedKey.value = null
  loadError.value = ''
  loadingKept.value = true
  try {
    const nodes = await fetchKept()
    if (highlightId !== props.highlight.id) return
    kept.value = nodes
  } catch (err) {
    if (highlightId === props.highlight.id) loadError.value = errorText(err, '载入导图节点失败')
    loadedFor = ''
    return
  } finally {
    if (highlightId === props.highlight.id) loadingKept.value = false
  }
  // 该划线还没有任何节点：自动以根为中心展开一次
  if (kept.value.length === 0) expand('root')
}

// 手机布局每次打开都从半屏开始
watch(() => props.modelValue, open => { if (open) fullscreen.value = false })

watch(() => [props.modelValue, props.highlight.id] as const, ([open, id]) => {
  if (open && id !== loadedFor) load()
}, { immediate: true })

async function expand(key: string, force = false) {
  if (expanding.value[key] || busy.value) return
  const node = findNode(tree.value, key)
  if (!node) return
  const highlightId = props.highlight.id
  const body: { center?: string; path?: string[]; force?: boolean } = {}
  if (key !== 'root') {
    body.center = node.label
    body.path = pathTo(tree.value, key)
  }
  if (force) body.force = true
  expanding.value[key] = true
  try {
    const resp = await readerApi.expandHighlight(props.bookId, highlightId, body)
    if (highlightId !== props.highlight.id) return
    const data = resp.data.data!
    candidates.value[key] = data.candidates
    expansions.value[key] = { cached: data.cached }
  } catch (err) {
    if (highlightId === props.highlight.id) ElMessage.error(errorText(err, '展开失败'))
  } finally {
    if (highlightId === props.highlight.id) delete expanding.value[key]
  }
}

async function keep(key: string) {
  if (locked.value) return
  const chain = chainTo(tree.value, key)
  if (chain.length === 0) return
  busy.value = true
  try {
    await readerApi.keepMindChain(props.bookId, props.highlight.id, chain)
    await refreshKept()
  } catch (err) {
    ElMessage.error(errorText(err, '保留失败'))
  } finally {
    busy.value = false
  }
}

function countKeptBelow(node: TreeNode): number {
  return node.children.reduce((n, c) => n + (c.kept ? 1 + countKeptBelow(c) : 0), 0)
}

async function remove(node: TreeNode) {
  if (locked.value || !node.nodeId) return
  const n = countKeptBelow(node)
  if (n > 0) {
    try {
      await ElMessageBox.confirm(`将同时删除它下面的 ${n} 个节点，确定删除吗？`, '删除节点', { confirmButtonText: '删除节点', cancelButtonText: '取消', type: 'warning' })
    } catch {
      return
    }
  }
  busy.value = true
  try {
    await readerApi.deleteMindNode(props.bookId, node.nodeId)
    selectedKey.value = null
    await refreshKept()
  } catch (err) {
    ElMessage.error(errorText(err, '删除失败'))
  } finally {
    busy.value = false
  }
}

async function jump(node: TreeNode) {
  if (!node.source) return
  if (node.source.later) {
    try {
      await ElMessageBox.confirm('这是你还没读到的后文，跳转后阅读进度会移到那一章。确定跳转吗？', '跳转到后文', { confirmButtonText: '跳转到后文', cancelButtonText: '取消', type: 'warning' })
    } catch {
      return
    }
  }
  emit('jump', { chapterIndex: node.source.chapterIndex, label: node.label })
  if (isNarrow.value) visible.value = false
}
</script>

<style scoped>
.mind-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; }
.mind-title { font-size: 16px; font-weight: 600; color: var(--text-0); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mind-hint { display: flex; align-items: center; gap: 6px; color: var(--text-2); font-size: 14px; }
.mind-error { color: var(--danger); }
.mind-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.mind-node {
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--card-border);
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease;
}
.mind-node.candidate { border-style: dashed; }
.mind-node.kept { border-style: solid; }
.mind-node:hover, .mind-node.selected { background: var(--accent-soft); }
.mind-node.selected { border-color: var(--accent); }
.mind-node-main { display: flex; align-items: center; gap: 6px; min-width: 0; }
.mind-label { font-size: 14px; color: var(--text-0); word-break: break-all; }
.mind-spin { color: var(--accent); flex-shrink: 0; }
/* 节点类型标签：淡底 + 同色字，各主题下都清晰 */
.mind-kind { --kind: var(--text-2); flex-shrink: 0; font-size: 12px; line-height: 1; padding: 3px 6px; border-radius: 4px; color: var(--kind); background: color-mix(in srgb, var(--kind) 14%, transparent); }
.mind-kind.kind-highlight { --kind: var(--warning); }
.mind-kind.kind-event { --kind: var(--accent); }
.mind-kind.kind-concept { --kind: var(--success); }
.mind-kind.kind-person { --kind: var(--danger); }
.mind-summary { margin-top: 4px; font-size: 13px; line-height: 1.5; color: var(--text-2); }
.mind-meta { margin-top: 4px; display: flex; align-items: center; gap: 8px; font-size: 12px; }
.mind-cached { color: var(--text-2); }
.mind-actions { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; }
.mind-actions .el-button + .el-button { margin-left: 0; }
.mind-actions .el-button.later { color: var(--text-2); }
.mind-link { border: none; background: none; padding: 0; font-size: 12px; color: var(--accent); cursor: pointer; }
.mind-link:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
