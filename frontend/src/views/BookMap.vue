<template>
  <div class="book-map-page">
    <header class="map-topbar">
      <el-button :icon="ArrowLeft" text @click="goBack">返回</el-button>
      <h1 class="map-title" :title="pageTitle">{{ pageTitle }}</h1>
      <div class="map-tools">
        <el-switch v-model="onlyNotes" active-text="只看有笔记的章节" />
        <el-button size="small" :disabled="!ready" @click="canvasRef?.collapseAll()">折叠全部</el-button>
        <el-button size="small" :disabled="!ready" @click="canvasRef?.expandAll()">展开全部</el-button>
        <el-button size="small" :disabled="!ready" @click="canvasRef?.fit()">适应窗口</el-button>
        <el-dropdown trigger="click" :disabled="!ready" @command="onExport">
          <el-button size="small" type="primary" :loading="exporting">
            导出<el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="png">导出图片 PNG</el-dropdown-item>
              <el-dropdown-item command="md">导出大纲 Markdown</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </header>

    <div class="map-body">
      <main class="map-main">
        <div v-if="ready && nodes.length === 0" class="map-empty">
          还没有知识节点。在阅读器里划线后点「AI 展开」，或在章节上手动添加节点。
        </div>
        <div v-if="loading" class="map-loading"><el-skeleton :rows="6" animated /></div>
        <MindMapCanvas
          v-else-if="ready"
          ref="canvasRef"
          class="map-canvas"
          :root="displayTree"
          :selected-id="selectedId"
          @select="selectedId = $event"
        />
      </main>

      <!-- 宽屏：右侧固定面板；手机：底部抽屉。两种容器共用同一份详情内容 -->
      <component :is="isNarrow ? ElDrawer : 'aside'" v-bind="detailWrapperProps">
        <div v-if="!selected" class="detail-hint">点击导图中的节点查看详情</div>
        <div v-else class="detail">
          <!-- 书根 / 分组 / 未归类：只显示标题 -->
          <h2 v-if="!isNarrow || selected.type === 'mind'" class="detail-title">{{ selected.type === 'mind' && selected.node ? selected.node.label : selected.label }}</h2>

          <template v-if="selected.type === 'chapter'">
            <div class="detail-actions">
              <el-button type="primary" :disabled="busy" @click="addUnderChapter(selected)">添加节点</el-button>
              <el-button @click="readChapter(selected)">去阅读这一章</el-button>
            </div>
          </template>

          <template v-else-if="selected.type === 'mind' && selected.node">
            <div class="detail-meta">
              <span class="mind-kind" :class="`kind-${selected.node.kind}`">{{ KIND_LABEL[selected.node.kind] }}</span>
              <el-button v-if="!isHighlightRoot(selected)" size="small" text type="primary" :disabled="busy" @click="rename(selected)">改名</el-button>
            </div>
            <p v-if="isHighlightRoot(selected) && selected.highlight" class="detail-quote">{{ selected.highlight.text }}</p>
            <p v-if="selected.node.summary" class="detail-summary">{{ selected.node.summary }}</p>

            <div class="detail-section">
              <div class="section-label">批注</div>
              <template v-if="isHighlightRoot(selected)">
                <p class="detail-note-readonly">{{ selected.highlight?.note || '（无批注）' }}</p>
                <p class="detail-tip">批注请在阅读器里编辑划线</p>
              </template>
              <template v-else>
                <el-input v-model="noteDraft" type="textarea" :autosize="{ minRows: 3, maxRows: 10 }" :maxlength="NOTE_MAX" show-word-limit placeholder="写点自己的理解…" />
                <el-button class="note-save" size="small" type="primary" :disabled="busy || noteDraft === (selected.node.note ?? '')" @click="saveNote(selected)">保存批注</el-button>
              </template>
            </div>

            <div class="detail-actions">
              <el-button v-if="sourceText(selected)" @click="goSource(selected)">{{ sourceText(selected) }}</el-button>
              <el-button :disabled="busy" @click="addChild(selected)">添加子节点</el-button>
              <el-button type="danger" plain :disabled="busy" @click="remove(selected)">删除</el-button>
            </div>
          </template>
        </div>
      </component>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 学习导图页：整本书的目录骨架 + 划线/导图节点画成一张导图；查看与编辑节点、导出图片/大纲。
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMediaQuery } from '@vueuse/core'
import { ArrowLeft, ArrowDown } from '@element-plus/icons-vue'
import { ElDrawer, ElMessage, ElMessageBox } from 'element-plus'
import MindMapCanvas from '@/components/MindMapCanvas.vue'
import { libraryApi } from '@/api/library'
import { readerApi } from '@/api/reader'
import { buildBookMap, pruneEmpty, toMarkdown, safeFileName, findMapNode, countMindDescendants, type MapNode } from '@/utils/book-map'
import type { Chapter, Highlight, MindNode } from '@/types'

const KIND_LABEL: Record<MindNode['kind'], string> = { highlight: '划线', event: '事件', concept: '概念', person: '人物', custom: '自定义' }
const LABEL_MAX = 60
const NOTE_MAX = 2000

const route = useRoute()
const router = useRouter()
const bookId = route.params.bookId as string
const isNarrow = useMediaQuery('(max-width: 768px)')

const bookTitle = ref('')
const chapters = ref<Chapter[]>([])
const highlights = ref<Highlight[]>([])
const nodes = ref<MindNode[]>([])
const loading = ref(true)
const ready = ref(false)
const busy = ref(false)
const exporting = ref(false)
const onlyNotes = ref(true)
const selectedId = ref<string | null>(null)
const noteDraft = ref('')
const canvasRef = ref<InstanceType<typeof MindMapCanvas> | null>(null)

const pageTitle = computed(() => `${bookTitle.value || '…'} · 学习导图`)
const fullTree = computed(() => buildBookMap({ bookTitle: bookTitle.value, chapters: chapters.value, nodes: nodes.value, highlights: highlights.value }))
const displayTree = computed(() => (onlyNotes.value ? pruneEmpty(fullTree.value) : fullTree.value))
const selected = computed(() => (selectedId.value ? findMapNode(displayTree.value, selectedId.value) : null))

const detailWrapperProps = computed(() => isNarrow.value
  ? {
      modelValue: !!selected.value,
      'onUpdate:modelValue': (v: boolean) => { if (!v) selectedId.value = null },
      direction: 'btt',
      size: '50%',
      title: selected.value && selected.value.type !== 'mind' ? selected.value.label : '节点详情',
    }
  : { class: 'detail-panel' })

// 切换选中节点时重置批注草稿（编辑后刷新不改变选中，不会冲掉草稿）
watch(() => selected.value?.id, () => { noteDraft.value = selected.value?.node?.note ?? '' })

// 筛选开关会大幅改变树的形状，切换后重新适应窗口；编辑后的刷新不 fit，保留缩放/平移
watch(onlyNotes, async () => {
  await nextTick()
  canvasRef.value?.fit()
})

function errorText(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { message?: string } } }
  return e.response?.data?.message || fallback
}

async function loadAll() {
  loading.value = true
  try {
    const [bookResp, chaptersResp, hlResp, nodesResp] = await Promise.all([
      libraryApi.get(bookId),
      readerApi.getChapters(bookId),
      readerApi.getHighlights(bookId),
      readerApi.getMindNodes(bookId),
    ])
    const book = bookResp.data.data
    bookTitle.value = book?.display_title || book?.title || ''
    chapters.value = chaptersResp.data.data?.chapters ?? []
    highlights.value = hlResp.data.data ?? []
    nodes.value = nodesResp.data.data ?? []
    ready.value = true
  } catch (err) {
    ElMessage.error(errorText(err, '学习导图加载失败'))
  } finally {
    loading.value = false
  }
}

/** 编辑后重新拉取节点并重建树；折叠状态由画布按 id 保留，选中节点不存在了就清空 */
async function refreshNodes() {
  const resp = await readerApi.getMindNodes(bookId)
  nodes.value = resp.data.data ?? []
  if (selectedId.value && !findMapNode(displayTree.value, selectedId.value)) selectedId.value = null
}

onMounted(loadAll)

function goBack() {
  if (window.history.state?.back) router.back()
  else router.push(`/book/${bookId}`)
}

function chapterTitle(index: number): string {
  return chapters.value.find(c => c.index === index)?.title || `第 ${index + 1} 章`
}

function isHighlightRoot(n: MapNode): boolean {
  return n.node?.kind === 'highlight'
}

async function promptLabel(title: string, initial = ''): Promise<string | null> {
  try {
    const { value } = await ElMessageBox.prompt('', title, {
      confirmButtonText: '保存',
      cancelButtonText: '取消',
      inputValue: initial,
      inputPlaceholder: `1–${LABEL_MAX} 字`,
      inputValidator: (v: string) => {
        const len = (v ?? '').trim().length
        return (len >= 1 && len <= LABEL_MAX) || `请输入 1–${LABEL_MAX} 字`
      },
    })
    return value.trim()
  } catch {
    return null
  }
}

/** 统一处理编辑请求：防重入、失败提示、成功后刷新 */
async function mutate(action: () => Promise<unknown>, fallback: string, onDone?: () => void) {
  busy.value = true
  try {
    await action()
    onDone?.()
    await refreshNodes()
  } catch (err) {
    ElMessage.error(errorText(err, fallback))
  } finally {
    busy.value = false
  }
}

async function addUnderChapter(n: MapNode) {
  if (n.chapterIndex === undefined) return
  const label = await promptLabel('添加节点')
  if (label === null) return
  await mutate(() => readerApi.addMindNode(bookId, { chapterIndex: n.chapterIndex!, label }), '添加失败')
}

async function addChild(n: MapNode) {
  const label = await promptLabel('添加节点')
  if (label === null) return
  await mutate(() => readerApi.addMindNode(bookId, { parentId: n.id, label }), '添加失败')
}

async function rename(n: MapNode) {
  const label = await promptLabel('改名', n.node?.label ?? '')
  if (label === null || label === n.node?.label) return
  await mutate(() => readerApi.updateMindNode(bookId, n.id, { label }), '改名失败')
}

async function saveNote(n: MapNode) {
  const note = noteDraft.value.trim() ? noteDraft.value : null
  await mutate(() => readerApi.updateMindNode(bookId, n.id, { note }), '保存失败', () => ElMessage.success('批注已保存'))
}

async function remove(n: MapNode) {
  const count = countMindDescendants(n)
  if (count > 0) {
    try {
      await ElMessageBox.confirm(`将同时删除它下面的 ${count} 个节点，确定删除吗？`, '删除节点', { confirmButtonText: '删除节点', type: 'warning' })
    } catch {
      return
    }
  }
  await mutate(() => readerApi.deleteMindNode(bookId, n.id), '删除失败', () => { selectedId.value = null })
}

function readChapter(n: MapNode) {
  router.push({ path: `/reader/${bookId}`, query: { chapter: String(n.chapterIndex) } })
}

/** 出处按钮文案；没有出处返回空串（不显示按钮） */
function sourceText(n: MapNode): string {
  const m = n.node
  if (!m) return ''
  if (m.kind === 'highlight') return m.highlight_id ? '📖 去原文' : ''
  if (m.source_chapter === null) return ''
  return m.source_later ? `📖 后文·${chapterTitle(m.source_chapter)}` : '📖 去原文'
}

async function goSource(n: MapNode) {
  const m = n.node
  if (!m) return
  if (m.kind === 'highlight') {
    if (m.highlight_id) router.push({ path: `/reader/${bookId}`, query: { highlight: m.highlight_id } })
    return
  }
  if (m.source_chapter === null) return
  if (m.source_later) {
    try {
      await ElMessageBox.confirm('这是你还没读到的后文，跳转后阅读进度会移到那一章。确定跳转吗？', '跳转到后文', { confirmButtonText: '跳转到后文', type: 'warning' })
    } catch {
      return
    }
  }
  router.push({ path: `/reader/${bookId}`, query: { chapter: String(m.source_chapter), find: m.label } })
}

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 给浏览器留时间开始下载再回收
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function onExport(cmd: 'png' | 'md') {
  const base = `${safeFileName(bookTitle.value)}-学习导图`
  if (cmd === 'md') {
    download(new Blob([toMarkdown(displayTree.value)], { type: 'text/markdown;charset=utf-8' }), `${base}.md`)
    return
  }
  if (!canvasRef.value) return
  exporting.value = true
  try {
    download(await canvasRef.value.exportPng(), `${base}.png`)
  } catch (err) {
    ElMessage.error(errorText(err, '导出图片失败'))
  } finally {
    exporting.value = false
  }
}
</script>

<style scoped>
.book-map-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  background: var(--el-bg-color-page);
  color: var(--el-text-color-primary);
}
.map-topbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: var(--el-bg-color);
}
.map-title {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.map-tools { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.map-tools .el-button + .el-button { margin-left: 0; }
.map-body { flex: 1; min-height: 0; display: flex; }
.map-main { position: relative; flex: 1; min-width: 0; display: flex; flex-direction: column; }
.map-canvas { flex: 1; min-height: 0; }
.map-loading { padding: 24px; }
.map-empty {
  margin: 12px 16px 0;
  padding: 10px 14px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
}
.detail-panel {
  width: 320px;
  flex-shrink: 0;
  overflow-y: auto;
  padding: 16px;
  border-left: 1px solid var(--el-border-color-lighter);
  background: var(--el-bg-color);
}
.detail-hint { font-size: 13px; color: var(--el-text-color-secondary); }
.detail-title { margin: 0 0 12px; font-size: 15px; font-weight: 600; word-break: break-all; }
.detail-meta { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.detail-quote {
  margin: 0 0 8px;
  padding: 6px 10px;
  border-left: 3px solid var(--el-color-warning);
  font-size: 13px;
  color: var(--el-text-color-regular);
  white-space: pre-wrap;
  word-break: break-all;
}
.detail-summary { margin: 0 0 12px; font-size: 13px; line-height: 1.6; color: var(--el-text-color-regular); }
.detail-section { margin-bottom: 12px; }
.section-label { margin-bottom: 6px; font-size: 12px; color: var(--el-text-color-secondary); }
.detail-note-readonly { margin: 0; font-size: 13px; white-space: pre-wrap; word-break: break-all; }
.detail-tip { margin: 4px 0 0; font-size: 12px; color: var(--el-text-color-secondary); }
.note-save { margin-top: 8px; }
.detail-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.detail-actions .el-button + .el-button { margin-left: 0; }
.mind-kind { flex-shrink: 0; font-size: 12px; line-height: 1; padding: 3px 6px; border-radius: 4px; color: #fff; background: var(--el-color-info); }
.mind-kind.kind-highlight { background: var(--el-color-warning); }
.mind-kind.kind-event { background: var(--el-color-primary); }
.mind-kind.kind-concept { background: var(--el-color-success); }
.mind-kind.kind-person { background: var(--el-color-danger); }

@media (max-width: 768px) {
  .map-topbar { padding: 6px 8px; }
  .map-title { flex-basis: calc(100% - 80px); }
}
</style>
