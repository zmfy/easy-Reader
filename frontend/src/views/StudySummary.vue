<template>
  <div
    class="summary-page"
    @touchstart.passive="onTouchStart"
    @touchend="cancelLongPress"
    @touchmove.passive="cancelLongPress"
    @touchcancel="cancelLongPress"
  >
    <header class="sum-topbar">
      <el-button text @click="goBack"><IconChevronLeft :size="16" :stroke-width="1.75" />返回</el-button>
      <h1 class="sum-title" :title="pageTitle">
        <span class="sum-title-text">{{ pageTitle }}</span>
        <el-tag v-if="ready && bookTitle === null" size="small" type="info">书已不存在</el-tag>
      </h1>
      <div v-if="ready" class="sum-tools">
        <span v-if="summary && (saveText || saveState === 'error')" class="save-state" :class="{ error: saveState === 'error' }">
          <template v-if="saveState === 'error'">保存失败，<el-button link type="primary" @click="save">重试</el-button></template>
          <template v-else>{{ saveText }}</template>
        </span>
        <el-button size="small" :icon="IconHistory" @click="showVersions = !showVersions">修改记录</el-button>
        <el-button size="small" :icon="IconDownload" :disabled="!summary" :loading="exporting" @click="onExport">导出</el-button>
        <el-popover trigger="click" placement="bottom-end" :width="300" @show="loadPrefs">
          <template #reference>
            <el-button size="small" :icon="IconAdjustmentsHorizontal">整理偏好</el-button>
          </template>
          <div class="prefs-pop">
            <div class="prefs-row">
              <span>整理笔记时允许 AI 补充内容</span>
              <el-switch
                :model-value="allowAiAddition"
                :loading="prefsSaving"
                :disabled="!prefsLoaded"
                aria-label="整理笔记时允许 AI 补充内容"
                @change="onPrefChange"
              />
            </div>
            <p class="form-hint">打开后，AI 可补上笔记里没写的常识，补充的内容会带标记</p>
          </div>
        </el-popover>
        <el-tooltip v-if="summary && bookTitle !== null" content="没有新笔记" placement="bottom" :disabled="newNoteCount > 0">
          <span class="btn-wrap">
            <el-button size="small" type="primary" :icon="IconRefresh" :disabled="newNoteCount === 0 || running" @click="startJob('update')">更新（{{ newNoteCount }} 条新笔记）</el-button>
          </span>
        </el-tooltip>
        <el-dropdown v-if="summary" trigger="click" @command="onMore">
          <el-button size="small" :icon="IconDots" aria-label="更多" />
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="delete" :disabled="running">删除整理</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </header>

    <div class="sum-body">
      <main class="sum-main">
        <div v-if="loading" class="sum-loading"><el-skeleton :rows="8" animated /></div>
        <div v-else-if="loadFailed" class="sum-error">
          <span>笔记整理加载失败</span>
          <el-button size="small" @click="loadSummary">重试</el-button>
        </div>
        <div v-else class="sum-paper">
          <div v-if="running && job" class="job-progress">
            <div class="job-text">正在整理 {{ job.done }}/{{ job.total }} 批…</div>
            <el-progress :percentage="jobPercent" :show-text="false" :stroke-width="6" />
          </div>
          <div v-else-if="failedJob" class="job-failed">
            <span>整理失败：{{ failedJob.error || '未知错误' }}</span>
            <el-button size="small" type="primary" :disabled="bookTitle === null" @click="startJob(failedJob.kind)">重试</el-button>
          </div>

          <el-alert v-if="conflictLocal" class="conflict-bar" type="warning" show-icon @close="conflictLocal = null">
            <template #title>
              你有一段未保存的内容被替换了
              <el-button link type="primary" @click="conflictDialog = true">查看我未保存的内容</el-button>
            </template>
          </el-alert>

          <SummaryEditor
            v-if="summary"
            ref="editorRef"
            :model-value="doc"
            :readonly="running || leaving || restoring || adopting"
            :allowed-refs="summary.included_refs"
            :tidy-enabled="tidyEnabled"
            :tidy-disabled-hint="tidyDisabledHint"
            @update:model-value="onEdit"
            @tidy="onTidy"
            @ref-click="onRefClick"
            @ref-hover="onRefHover"
          />
          <div v-else-if="!running" class="sum-empty">
            <template v-if="noteCount === 0">这本书还没有笔记，先在阅读器里划线或在学习导图里添加知识点。</template>
            <template v-else>
              <p>还没有整理。AI 会把这本书的 {{ noteCount }} 条笔记按主题整理成文。</p>
              <el-button v-if="bookTitle !== null" type="primary" :icon="IconSparkles" @click="startJob('generate')">开始整理</el-button>
            </template>
          </div>
        </div>
      </main>

      <!-- 宽屏：右侧面板；手机：底部抽屉 -->
      <component :is="isNarrow ? ElDrawer : 'aside'" v-if="isNarrow || showVersions" v-bind="versionsWrapperProps">
        <h2 v-if="!isNarrow" class="panel-title">修改记录</h2>
        <div v-if="versionsLoading && versions.length === 0" class="panel-hint">加载中…</div>
        <div v-else-if="versions.length === 0" class="panel-hint">还没有修改记录</div>
        <ul v-else class="version-list">
          <li v-for="v in versions" :key="v.id" class="version-item">
            <div class="version-meta">
              <span class="version-time">{{ shortTime(versionTime(v)) }}</span>
              <span class="version-source" :class="`src-${v.source}`">{{ SOURCE_LABEL[v.source] }}</span>
            </div>
            <div v-if="v.description" class="version-desc">{{ v.description }}</div>
            <el-button size="small" text type="primary" @click="viewVersion(v)">查看此版本</el-button>
          </li>
        </ul>
      </component>
    </div>

    <el-dialog
      v-model="versionDialog"
      :title="viewing ? `${shortTime(viewing.updated_at)} 的版本` : '版本'"
      :width="isNarrow ? '94%' : '760px'"
      top="5vh"
      destroy-on-close
    >
      <div v-if="viewing" class="version-body">
        <SummaryEditor :model-value="viewing.doc" :readonly="true" />
      </div>
      <template #footer>
        <el-button @click="versionDialog = false">关闭</el-button>
        <el-button type="primary" :disabled="!viewing || running || !summary" :loading="restoring" @click="restore">恢复此版本</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="conflictDialog"
      title="未保存的内容"
      :width="isNarrow ? '94%' : '760px'"
      top="5vh"
    >
      <div v-if="conflictLocal" class="version-body">
        <SummaryEditor :model-value="conflictLocal" :readonly="true" />
      </div>
      <template #footer>
        <el-button @click="conflictDialog = false">关闭</el-button>
      </template>
    </el-dialog>

    <TidyDialog
      v-model="tidyOpen"
      :book-id="bookId"
      :mode="tidyMode"
      :content="tidySel?.nodes || []"
      @adopt="onAdopt"
    />

    <el-popover
      :visible="pop.visible"
      :virtual-ref="pop.el ?? undefined"
      virtual-triggering
      placement="top"
      :width="320"
      popper-class="note-ref-popover"
    >
      <div class="ref-pop-text">{{ pop.text }}</div>
    </el-popover>
  </div>
</template>

<script setup lang="ts">
/**
 * 单本书的笔记整理：AI 后台生成/更新（轮询进度）、所见即所得编辑与自动保存（修订号冲突处理）、
 * 修改记录（查看/恢复）、书本图标引用悬停看原文与跳转阅读器、导出 Markdown、删除总结。
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { useMediaQuery } from '@vueuse/core'
import {
  IconAdjustmentsHorizontal, IconChevronLeft, IconDots, IconDownload, IconHistory, IconRefresh, IconSparkles,
} from '@tabler/icons-vue'
import { ElDrawer, ElMessage, ElMessageBox } from 'element-plus'
import SummaryEditor from '@/components/SummaryEditor.vue'
import TidyDialog from '@/components/TidyDialog.vue'
import { studyApi } from '@/api/study'
import { settingsApi } from '@/api/settings'
import type { SelectionBlocks } from '@/utils/summary-tidy'
import { safeFileName } from '@/utils/book-map'
import { SOURCE_LABEL } from '@/utils/summary-doc'
import { parseServerTime } from '@/utils/time'
import type { DocNode, ResolvedRef, StudySummary, SummaryJob, SummaryVersion, SummaryVersionDetail, TidyMode } from '@/types/study'

const SAVE_DEBOUNCE = 1500
const POLL_INTERVAL = 2000
const LONG_PRESS = 500

const route = useRoute()
const router = useRouter()
// App 的 <router-view> 以 route.path 为 key：换书会重建本页，bookId 只需读一次
const bookId = route.params.bookId as string
const isNarrow = useMediaQuery('(max-width: 768px)')

const loading = ref(true)
const loadFailed = ref(false)
const ready = ref(false)
const summary = ref<StudySummary | null>(null)
const doc = ref<DocNode>({ type: 'doc', content: [] })
const revision = ref(0)
const bookTitle = ref<string | null>(null)
const noteCount = ref(0)
const newNoteCount = ref(0)
const job = ref<SummaryJob | null>(null)
const failedJob = ref<SummaryJob | null>(null)
const exporting = ref(false)

const running = computed(() => job.value?.status === 'running')
const jobPercent = computed(() => (job.value && job.value.total > 0 ? Math.round((job.value.done / job.value.total) * 100) : 0))
const pageTitle = computed(() => {
  if (!ready.value) return '… · 笔记整理'
  return bookTitle.value === null ? '笔记整理' : `${bookTitle.value} · 笔记整理`
})

function errorText(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { message?: string } } }
  return e.response?.data?.message || fallback
}
function errorStatus(err: unknown): number | undefined {
  return (err as { response?: { status?: number } }).response?.status
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}
/** 后端时间 → 本地 `MM-DD HH:mm` */
function shortTime(value: string | null | undefined): string {
  const d = parseServerTime(value)
  if (!d) return value ?? ''
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/* ---------- 载入 ---------- */

/** 用服务器上的总结覆盖本地（编辑器、修订号），本地未保存改动作废 */
function applySummary(s: StudySummary | null) {
  summary.value = s
  if (s) {
    doc.value = s.doc
    revision.value = s.revision
  }
  clearSaveTimer()
  dirty.value = false
  pendingSave = false
}

async function loadSummary() {
  loading.value = !ready.value
  loadFailed.value = false
  try {
    const resp = await studyApi.getSummary(bookId)
    const d = resp.data.data!
    applySummary(d.summary)
    saveState.value = 'idle'
    bookTitle.value = d.bookTitle
    noteCount.value = d.noteCount
    newNoteCount.value = d.newNoteCount
    job.value = d.job
    ready.value = true
    if (running.value) schedulePoll()
    if (showVersions.value) loadVersions()
  } catch (err) {
    if (!ready.value) loadFailed.value = true
    ElMessage.error(errorText(err, '笔记整理加载失败'))
  } finally {
    loading.value = false
  }
}

/* ---------- 后台任务 ---------- */

let pollTimer: ReturnType<typeof setTimeout> | null = null
let disposed = false

function schedulePoll() {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = setTimeout(poll, POLL_INTERVAL)
}

async function poll() {
  pollTimer = null
  if (disposed) return
  try {
    const resp = await studyApi.currentJob(bookId)
    if (disposed) return
    onJob(resp.data.data ?? null)
  } catch {
    // 临时网络错误：继续轮询
    if (!disposed) schedulePoll()
  }
}

function onJob(j: SummaryJob | null) {
  job.value = j
  if (!j) return
  if (j.status === 'running') schedulePoll()
  else if (j.status === 'done') loadSummary()
  else failedJob.value = j
}

/** 查一次当前任务，进行中则接着轮询（例如别处启动了任务导致保存被拒） */
async function checkJob() {
  if (running.value) return
  try {
    const resp = await studyApi.currentJob(bookId)
    const j = resp.data.data ?? null
    if (j?.status === 'running') {
      job.value = j
      schedulePoll()
    }
  } catch { /* 忽略 */ }
}

async function startJob(kind: 'generate' | 'update') {
  // 先把未保存的编辑存掉，否则任务写入后修订号变化，本地改动保存会冲突；存不上就不启动
  if (!(await flushSave())) {
    ElMessage.error('有修改尚未保存，请先重试保存')
    return
  }
  failedJob.value = null
  try {
    const resp = await studyApi.startJob(bookId, kind)
    onJob(resp.data.data ?? null)
  } catch (err) {
    ElMessage.error(errorText(err, '启动整理失败'))
  }
}

/* ---------- 自动保存 ---------- */

const dirty = ref(false)
const saveState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
const savedAt = ref('')
let saveTimer: ReturnType<typeof setTimeout> | null = null
let savingPromise: Promise<void> | null = null
let pendingSave = false

const saveText = computed(() => {
  if (saveState.value === 'saving') return '保存中…'
  if (saveState.value === 'saved') return `已保存 ${savedAt.value}`
  return ''
})

function clearSaveTimer() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
}

function onEdit(d: DocNode) {
  doc.value = d
  dirty.value = true
  clearSaveTimer()
  saveTimer = setTimeout(save, SAVE_DEBOUNCE)
}

const conflictLocal = ref<DocNode | null>(null)
const conflictDialog = ref(false)
let conflictCount = 0

/** 冲突：载入服务器最新内容并提示；keepLocal 时先留存被替换掉的本地内容，供用户查看复制 */
function onConflict(err: unknown, keepLocal: boolean) {
  conflictCount++
  const latest = (err as { response?: { data?: { data?: StudySummary | null } } }).response?.data?.data
  if (keepLocal) {
    const local = doc.value
    // 提示条未关闭前又冲突：追加在后面，不丢前一段
    conflictLocal.value = conflictLocal.value
      ? { type: 'doc', content: [...(conflictLocal.value.content || []), ...(local.content || [])] }
      : local
  }
  if (latest) applySummary(latest)
  saveState.value = 'idle'
  ElMessage.warning(errorText(err, '整理内容已在别处更新'))
  if (showVersions.value) loadVersions()
  checkJob()
}

async function doSave() {
  const snapshot = doc.value
  const opts = tidySaveOpts
  dirty.value = false
  saveState.value = 'saving'
  try {
    const resp = await studyApi.saveSummary(bookId, snapshot, revision.value, opts ?? undefined)
    if (opts && tidySaveOpts === opts) tidySaveOpts = null
    const s = resp.data.data!
    summary.value = s
    revision.value = s.revision
    const now = new Date()
    savedAt.value = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`
    saveState.value = 'saved'
    if (showVersions.value) loadVersions()
  } catch (err) {
    if (errorStatus(err) === 409) {
      // 采用 AI 整理时冲突：本次结果作废，直接载入最新内容
      tidySaveOpts = null
      onConflict(err, !opts)
    } else {
      dirty.value = true
      saveState.value = 'error'
    }
  }
}

/** 保存当前内容；已有保存请求在进行时，等它结束后再保存最新内容（不并发两个 PUT） */
function save(): Promise<void> {
  clearSaveTimer()
  if (savingPromise) {
    pendingSave = true
    return savingPromise
  }
  if (!dirty.value || !summary.value) return Promise.resolve()
  savingPromise = doSave().finally(() => {
    savingPromise = null
    if (pendingSave) {
      pendingSave = false
      if (dirty.value) save()
    }
  })
  return savingPromise
}

/** 立即保存所有未保存改动并等待完成；返回 false 表示没存上（保存失败或冲突后本地内容被替换） */
async function flushSave(): Promise<boolean> {
  const before = conflictCount
  clearSaveTimer()
  while (savingPromise) {
    pendingSave = false
    await savingPromise
  }
  if (dirty.value) await save()
  return !dirty.value && conflictCount === before
}

const leaving = ref(false)

onBeforeRouteLeave(async () => {
  // 保存期间编辑器只读，避免新输入在卸载时丢失
  leaving.value = true
  if (await flushSave()) return true
  try {
    await ElMessageBox.confirm('修改还没保存，离开会丢失这些修改。确定离开吗？', '离开页面', { confirmButtonText: '离开', cancelButtonText: '取消', type: 'warning' })
    return true
  } catch {
    leaving.value = false
    return false
  }
})

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (!dirty.value && !savingPromise) return
  save()
  e.preventDefault()
  e.returnValue = ''
}

/* ---------- AI 整理成列表 / 表格 ---------- */

const editorRef = ref<InstanceType<typeof SummaryEditor> | null>(null)
const aiConfigured = ref(false)
const tidyOpen = ref(false)
const tidyMode = ref<TidyMode>('table')
const tidySel = ref<SelectionBlocks | null>(null)
const adopting = ref(false)
// 下一次保存记为「AI 整理」版本（采用整理结果时设置，保存成功或冲突后清除）
let tidySaveOpts: { source: 'ai_tidy'; description: string } | null = null

const tidyEnabled = computed(() => !!summary.value && aiConfigured.value && !running.value && !leaving.value && !restoring.value && !adopting.value)
const tidyDisabledHint = computed(() => {
  if (!aiConfigured.value) return '请先在 AI 插件设置中配置'
  if (running.value) return '正在整理中，请稍后再试'
  return '暂不可用'
})

async function loadAiStatus() {
  try {
    const resp = await settingsApi.getAiStatus()
    aiConfigured.value = !!resp.data.data?.configured
  } catch { /* 视为未配置 */ }
}

function onTidy(mode: TidyMode, sel: SelectionBlocks) {
  tidyMode.value = mode
  tidySel.value = sel
  tidyOpen.value = true
}

async function onAdopt(nodes: DocNode[], description: string) {
  const sel = tidySel.value
  const ed = editorRef.value
  if (!sel || !ed || adopting.value) return
  adopting.value = true
  try {
    // 先存掉手动修改（记为「我」），使「AI 整理」版本只含这次整理
    if (!(await flushSave())) {
      tidyOpen.value = false
      ElMessage.warning(saveState.value === 'error' ? '有修改尚未保存，请先重试保存' : '整理内容已在别处更新，请重新选择后再整理')
      return
    }
    // 选区所在的块已变化（如载入了别处的更新）：不能再按原位置替换
    const current = ed.editor.state.doc.slice(sel.from, sel.to).content.toJSON()
    if (JSON.stringify(current) !== JSON.stringify(sel.nodes)) {
      tidyOpen.value = false
      ElMessage.warning('整理内容已在别处更新，请重新选择后再整理')
      return
    }
    tidySaveOpts = { source: 'ai_tidy', description }
    ed.replaceBlocks(sel.from, sel.to, nodes)
    await save()
    tidyOpen.value = false
    if (saveState.value === 'saved') ElMessage.success('已采用整理结果')
  } finally {
    adopting.value = false
  }
}

/* ---------- 整理偏好 ---------- */

const allowAiAddition = ref(false)
const prefsLoaded = ref(false)
const prefsSaving = ref(false)

async function loadPrefs() {
  try {
    const resp = await studyApi.getPrefs()
    allowAiAddition.value = !!resp.data.data?.allowAiAddition
    prefsLoaded.value = true
  } catch (err) {
    ElMessage.error(errorText(err, '读取整理偏好失败'))
  }
}

async function onPrefChange(v: string | number | boolean) {
  const old = allowAiAddition.value
  allowAiAddition.value = !!v
  prefsSaving.value = true
  try {
    const resp = await studyApi.savePrefs({ allowAiAddition: !!v })
    allowAiAddition.value = !!resp.data.data?.allowAiAddition
  } catch (err) {
    allowAiAddition.value = old
    ElMessage.error(errorText(err, '保存整理偏好失败'))
  } finally {
    prefsSaving.value = false
  }
}

/* ---------- 修改记录 ---------- */

const showVersions = ref(false)
const versions = ref<SummaryVersion[]>([])
const versionsLoading = ref(false)
const versionDialog = ref(false)
const viewing = ref<SummaryVersionDetail | null>(null)
const restoring = ref(false)

const versionsWrapperProps = computed(() => isNarrow.value
  ? {
      modelValue: showVersions.value,
      'onUpdate:modelValue': (v: boolean) => { showVersions.value = v },
      direction: 'btt',
      size: '60%',
      title: '修改记录',
    }
  : { class: 'versions-panel' })

watch(showVersions, v => { if (v) loadVersions() })

/** 用户版本连续保存会合并，时间以 updated_at 为准 */
function versionTime(v: SummaryVersion): string {
  return v.updated_at || v.created_at
}

async function loadVersions() {
  versionsLoading.value = true
  try {
    const resp = await studyApi.listVersions(bookId)
    versions.value = resp.data.data ?? []
  } catch (err) {
    ElMessage.error(errorText(err, '修改记录加载失败'))
  } finally {
    versionsLoading.value = false
  }
}

async function viewVersion(v: SummaryVersion) {
  try {
    const resp = await studyApi.getVersion(bookId, v.id)
    viewing.value = resp.data.data ?? null
    versionDialog.value = !!viewing.value
  } catch (err) {
    ElMessage.error(errorText(err, '版本加载失败'))
  }
}

async function restore() {
  const v = viewing.value
  if (!v) return
  try {
    await ElMessageBox.confirm('当前内容会被这个版本替换，替换前的内容仍保留在修改记录里。确定恢复吗？', '恢复版本', { confirmButtonText: '恢复', cancelButtonText: '取消', type: 'warning' })
  } catch {
    return
  }
  if (!(await flushSave())) {
    ElMessage.error('有修改尚未保存，请先重试保存')
    return
  }
  restoring.value = true
  try {
    const resp = await studyApi.restoreVersion(bookId, v.id, revision.value)
    applySummary(resp.data.data!)
    saveState.value = 'idle'
    versionDialog.value = false
    ElMessage.success('已恢复此版本')
    loadVersions()
  } catch (err) {
    if (errorStatus(err) === 409) {
      versionDialog.value = false
      onConflict(err, false)
    } else {
      ElMessage.error(errorText(err, '恢复失败'))
    }
  } finally {
    restoring.value = false
  }
}

/* ---------- 原文引用 ---------- */

const refCache = new Map<string, Promise<ResolvedRef>>()
const pop = reactive<{ visible: boolean; el: HTMLElement | null; ref: string; text: string }>({ visible: false, el: null, ref: '', text: '' })
let hideTimer: ReturnType<typeof setTimeout> | null = null
let longPressTimer: ReturnType<typeof setTimeout> | null = null
let longPressAt = 0

/** 同一引用只请求一次；失败的不缓存 */
function resolveRef(r: string): Promise<ResolvedRef> {
  let p = refCache.get(r)
  if (!p) {
    p = studyApi.resolveRef(bookId, r).then(resp => resp.data.data!)
    p.catch(() => refCache.delete(r))
    refCache.set(r, p)
  }
  return p
}

let listenedEl: HTMLElement | null = null

function onRefLeave() {
  hideTimer = setTimeout(hidePop, 150)
}

function hidePop() {
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = null
  pop.visible = false
  listenedEl?.removeEventListener('mouseleave', onRefLeave)
  listenedEl = null
}

async function showPop(r: string, el: HTMLElement) {
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = null
  if (pop.visible && pop.el === el) return
  listenedEl?.removeEventListener('mouseleave', onRefLeave)
  listenedEl = el
  el.addEventListener('mouseleave', onRefLeave)
  pop.el = el
  pop.ref = r
  pop.text = '加载中…'
  pop.visible = true
  try {
    const res = await resolveRef(r)
    if (pop.el !== el) return
    pop.text = res.exists ? res.text : '原笔记已删除'
  } catch {
    if (pop.el === el) pop.text = '原文加载失败'
  }
}

function onRefHover(r: string, el: HTMLElement) {
  showPop(r, el)
}

function refElFrom(target: EventTarget | null): HTMLElement | null {
  return ((target as HTMLElement | null)?.closest?.('span.note-ref[data-ref]') as HTMLElement | null) ?? null
}

/** 手机：长按引用显示原文 */
function onTouchStart(e: TouchEvent) {
  cancelLongPress()
  const el = refElFrom(e.target)
  if (!el) {
    hidePop()
    return
  }
  longPressTimer = setTimeout(() => {
    longPressTimer = null
    longPressAt = Date.now()
    showPop(el.getAttribute('data-ref') || '', el)
  }, LONG_PRESS)
}

function cancelLongPress() {
  if (longPressTimer) clearTimeout(longPressTimer)
  longPressTimer = null
}

async function onRefClick(r: string) {
  // 长按刚弹出原文时，松手产生的 click 不跳转
  if (Date.now() - longPressAt < 800) return
  hidePop()
  let res: ResolvedRef
  try {
    res = await resolveRef(r)
  } catch (err) {
    ElMessage.error(errorText(err, '原文加载失败'))
    return
  }
  if (!res.exists) {
    ElMessage.warning('原笔记已删除')
    return
  }
  if (!res.canOpen) {
    ElMessage.warning('书已不存在，无法打开原文')
    return
  }
  if (res.later) {
    try {
      await ElMessageBox.confirm('这是你还没读到的后文，可能会剧透。确定查看吗？', '查看后文', { confirmButtonText: '查看后文', cancelButtonText: '取消', type: 'warning' })
    } catch {
      return
    }
  }
  const query: Record<string, string> = {}
  for (const [k, v] of Object.entries(res.target)) {
    if (v !== undefined && v !== null) query[k] = String(v)
  }
  router.push({ path: '/reader/' + bookId, query })
}

/* ---------- 导出 / 删除 ---------- */

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

async function onExport() {
  exporting.value = true
  try {
    await flushSave()
    const resp = await studyApi.getSummaryMarkdown(bookId)
    const md = resp.data.data?.summary?.markdown
    if (md === undefined) {
      ElMessage.warning('还没有整理')
      return
    }
    download(new Blob([md], { type: 'text/markdown;charset=utf-8' }), `${safeFileName(bookTitle.value || '')}-笔记整理.md`)
  } catch (err) {
    ElMessage.error(errorText(err, '导出失败'))
  } finally {
    exporting.value = false
  }
}

async function onMore(cmd: string) {
  if (cmd !== 'delete') return
  try {
    await ElMessageBox.confirm('删除后整理内容与全部修改记录都会删除，笔记本身不受影响。确定删除吗？', '删除整理', { confirmButtonText: '删除整理', cancelButtonText: '取消', type: 'warning' })
  } catch {
    return
  }
  // 删除前丢弃未保存的改动（等进行中的保存结束，避免它在删除后落库失败报错）
  clearSaveTimer()
  dirty.value = false
  pendingSave = false
  if (savingPromise) await savingPromise
  try {
    await studyApi.deleteSummary(bookId)
    versions.value = []
    await loadSummary()
  } catch (err) {
    ElMessage.error(errorText(err, '删除失败'))
  }
}

/* ---------- 其他 ---------- */

function goBack() {
  if (window.history.state?.back) router.back()
  else router.push(bookTitle.value === null ? '/notes' : `/book/${bookId}`)
}

/** 入口页带 ?start=update|generate 跳来：条件满足就自动开始任务，随后去掉参数 */
async function autoStart() {
  const start = route.query.start
  if (start === undefined) return
  const { start: _drop, ...rest } = route.query
  if (ready.value && bookTitle.value !== null && !running.value) {
    if (start === 'generate' && !summary.value) await startJob('generate')
    else if (start === 'update' && summary.value && newNoteCount.value > 0) await startJob('update')
  }
  if (!disposed) router.replace({ path: route.path, query: rest })
}

onMounted(async () => {
  loadAiStatus()
  await loadSummary()
  autoStart()
  window.addEventListener('beforeunload', onBeforeUnload)
})

onBeforeUnmount(() => {
  disposed = true
  if (pollTimer) clearTimeout(pollTimer)
  clearSaveTimer()
  cancelLongPress()
  hidePop()
  window.removeEventListener('beforeunload', onBeforeUnload)
})
</script>

<style scoped>
.summary-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  background: var(--bg-0);
  color: var(--text-0);
}
.sum-topbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
  padding: 8px 16px;
  border-bottom: 1px solid var(--card-border);
  background: var(--card-bg);
}
.sum-title {
  flex: 1;
  min-width: 0;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
}
.sum-title-text { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sum-tools { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.sum-tools .el-button + .el-button { margin-left: 0; }
.btn-wrap { display: inline-flex; }
.save-state { font-size: 12px; color: var(--text-2); }
.save-state.error { color: var(--danger); }
.sum-body { flex: 1; min-height: 0; display: flex; }
.sum-main { flex: 1; min-width: 0; overflow-y: auto; padding: 16px; }
.sum-paper {
  max-width: 880px;
  margin: 0 auto;
  padding: 20px 24px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--card-border);
  background: var(--card-bg);
}
.sum-loading { max-width: 880px; margin: 0 auto; }
.sum-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 48px 0;
  font-size: 14px;
  color: var(--text-2);
}
.sum-empty { padding: 32px 0; text-align: center; font-size: 14px; color: var(--text-2); }
.sum-empty p { margin: 0 0 16px; }
.job-progress { margin-bottom: 16px; }
.job-text { margin-bottom: 6px; font-size: 13px; color: var(--accent); }
.job-failed {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin-bottom: 16px;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 10%, var(--card-bg));
}
.versions-panel {
  width: 300px;
  flex-shrink: 0;
  overflow-y: auto;
  padding: 16px;
  border-left: 1px solid var(--card-border);
  background: var(--card-bg);
}
.panel-title { margin: 0 0 12px; font-size: 15px; font-weight: 600; }
.panel-hint { font-size: 13px; color: var(--text-2); }
.version-list { list-style: none; margin: 0; padding: 0; }
.version-item { padding: 8px 0; border-bottom: 1px solid var(--card-border); }
.version-meta { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.version-time { color: var(--text-0); }
.version-source {
  font-size: 12px;
  line-height: 1;
  padding: 3px 6px;
  border-radius: 4px;
  color: var(--accent);
  background: var(--accent-soft);
}
.version-desc { margin-top: 4px; font-size: 12px; color: var(--text-2); word-break: break-all; }
.conflict-bar { margin-bottom: 12px; }
.version-body { max-height: 65vh; overflow-y: auto; }
.prefs-pop { display: flex; flex-direction: column; gap: 6px; }
.prefs-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 14px; color: var(--text-0); }
.prefs-pop .form-hint { margin: 0; }
.ref-pop-text { font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-break: break-all; }

@media (max-width: 768px) {
  .sum-topbar { padding: 6px 8px; }
  .sum-title { flex-basis: calc(100% - 80px); }
  .sum-main { padding: 8px; }
  .sum-paper { padding: 12px; border-radius: var(--radius-md); }
}
</style>
