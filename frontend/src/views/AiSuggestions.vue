<template>
  <DefaultLayout>
    <div class="page page--narrow">
      <PageHeader title="AI 建议待确认" back="/library" :count="totalPending">
        <template #actions>
          <el-button :disabled="visible.length === 0 || busy" @click="dismissAll">全部忽略</el-button>
          <el-button type="primary" :disabled="selectedCount === 0 || busy" :loading="applying" @click="applySelected">
            采纳本批已勾选（{{ selectedCount }} 本）
          </el-button>
        </template>
      </PageHeader>
      <p class="section-desc">
        后台 AI 丰富时，空字段且依据明确的结果已直接写入；这里是需要你确认的其余结果。默认勾选了依据明确 / 推断的内容；低置信、你手动改过的字段，以及文件名与正文不符的书默认不勾。
      </p>

      <div v-if="batchTabs.length > 1" class="segmented filters">
        <button
          v-for="b in batchTabs" :key="String(b.key)" type="button" class="segmented-item"
          :class="{ 'is-active': b.key === current }" @click="switchBatch(b.key)"
        >{{ b.label }}（{{ b.count }}）</button>
      </div>
      <p v-else-if="batchTabs.length === 1 && current !== null" class="batch-single">{{ batchTabs[0].label }}</p>

      <div v-if="currentJobs.length > 0" class="note job-note">
        后台采纳中：{{ jobDone }} / {{ jobTotal }} 本{{ jobFailed > 0 ? `（失败 ${jobFailed} 本，会放回列表）` : '' }}。可以离开本页，完成后铃铛会提醒。
      </div>

      <div v-if="mismatchCount > 0" class="segmented filters">
        <button type="button" class="segmented-item" :class="{ 'is-active': filter === 'all' }" @click="filter = 'all'">全部（{{ items.length }}）</button>
        <button type="button" class="segmented-item" :class="{ 'is-active': filter === 'mismatch' }" @click="filter = 'mismatch'">文件名不符（{{ mismatchCount }}）</button>
      </div>

      <div v-if="loading" class="empty-state">加载中…</div>
      <div v-else-if="visible.length === 0" class="empty-state">{{ totalPending > 0 ? '这一批已处理完' : '没有待确认的 AI 建议' }}</div>

      <section v-for="s in visible" :key="s.book_id" class="section-card sg-card">
        <div class="sg-head">
          <router-link :to="`/book/${s.book_id}`" class="sg-title">{{ s.title }}</router-link>
          <span v-if="s.author" class="sg-author">{{ s.author }}</span>
          <span class="sg-actions">
            <el-button size="small" :disabled="busy" @click="dismiss(s)">忽略</el-button>
            <el-button size="small" type="primary" plain :disabled="busy || !hasSelection(choices[s.book_id])" @click="applyOne(s)">采纳</el-button>
          </span>
        </div>

        <p v-if="s.content_mismatch" class="note note--warning sg-mismatch">
          正文看起来是《{{ s.content_mismatch.title }}》<template v-if="s.content_mismatch.author">（{{ s.content_mismatch.author }}）</template>，与文件名不符，文件可能标错了。认可的话连同下面的「书名」一起勾选，采纳后书名改为正文书名。
          <template v-if="s.content_mismatch.reason">{{ s.content_mismatch.reason }}</template>
          <el-button link type="primary" size="small" @click="dismissMismatch(s)">不是错标</el-button>
        </p>

        <div v-for="f in fieldsOf(s)" :key="f" class="sg-row">
          <el-checkbox v-model="choices[s.book_id].fields[f]">{{ SUGGEST_FIELD_LABELS[f] }}</el-checkbox>
          <div class="sg-body">
            <div class="sg-change">
              <span class="sg-old" :title="s.data.fields[f]!.current || ''">{{ clip(s.data.fields[f]!.current) || '（空）' }}</span>
              <IconArrowRight :size="14" :stroke-width="1.75" class="sg-arrow" />
              <span class="sg-new" :title="s.data.fields[f]!.value">{{ f === 'category' ? categoryLabel(s.data.fields[f]!.value) : clip(s.data.fields[f]!.value) }}</span>
            </div>
            <div class="sg-meta">
              <el-tag size="small" :type="s.data.fields[f]!.confidence === 'low' ? 'warning' : 'info'">{{ CONFIDENCE_LABELS[s.data.fields[f]!.confidence] }}</el-tag>
              <el-tag v-if="s.data.fields[f]!.locked" size="small" type="info">你手动改过</el-tag>
              <span v-if="s.data.fields[f]!.evidence" class="form-hint">依据：{{ s.data.fields[f]!.evidence }}</span>
            </div>
          </div>
        </div>

        <div v-if="s.data.recommended_tags?.length" class="sg-row">
          <el-checkbox v-model="choices[s.book_id].tags">推荐标签</el-checkbox>
          <div class="sg-body sg-chips">
            <el-tag v-for="t in s.data.recommended_tags" :key="t" size="small">{{ t }}</el-tag>
            <span v-if="s.current.recommended_tags.length" class="form-hint">原有：{{ s.current.recommended_tags.join('、') }}</span>
          </div>
        </div>

        <div v-if="s.data.similar_works?.length" class="sg-row">
          <el-checkbox v-model="choices[s.book_id].similar">类似作品</el-checkbox>
          <div class="sg-body sg-chips">
            <span v-for="w in s.data.similar_works" :key="w.title" class="sg-work">《{{ w.title }}》<span v-if="w.author" class="form-hint">{{ w.author }}</span></span>
          </div>
        </div>

        <div v-if="s.data.adaptations?.length" class="sg-row">
          <el-checkbox v-model="choices[s.book_id].adaptations">改编作品</el-checkbox>
          <div class="sg-body sg-chips">
            <span v-for="a in s.data.adaptations" :key="a.url" class="sg-work">
              <el-tag size="small" type="info" :title="a.type === '短剧' ? SHORT_DRAMA_HINT : undefined">{{ a.type }}</el-tag>
              <a :href="a.url" target="_blank" rel="noopener noreferrer" class="sg-link">{{ a.title }}</a>
              <span v-if="a.year" class="form-hint">{{ a.year }}</span>
            </span>
          </div>
        </div>
      </section>
    </div>
  </DefaultLayout>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { IconArrowRight } from '@tabler/icons-vue'
import DefaultLayout from '@/layouts/DefaultLayout.vue'
import PageHeader from '@/components/PageHeader.vue'
import { libraryApi } from '@/api/library'
import { useSystemNoticeStore } from '@/stores/system-notice'
import { categoryLabel } from '@/utils/category'
import { SHORT_DRAMA_HINT } from '@/utils/ai-fill-form'
import {
  SUGGEST_FIELDS, SUGGEST_FIELD_LABELS, defaultChoice, hasSelection, toSelection, type SuggestionChoice,
} from '@/utils/ai-suggestions'
import type { AiApplyJob, AiFillConfidence, AiSuggestion, AiSuggestionBatch, SuggestField } from '@/types'

const CONFIDENCE_LABELS: Record<AiFillConfidence, string> = { high: '依据明确', medium: '依据推断', low: '低置信' }

const items = ref<AiSuggestion[]>([])
const choices = reactive<Record<string, SuggestionChoice>>({})
const loading = ref(true)
const applying = ref(false)
const busy = ref(false)
const filter = ref<'all' | 'mismatch'>('all')

// 按填充批次（每 500 本一批）分开确认；'none' 是分批之前留下的
type BatchKey = number | 'none'
const route = useRoute()
const noticeStore = useSystemNoticeStore()
const router = useRouter()
const batches = ref<AiSuggestionBatch[]>([])
const jobs = ref<AiApplyJob[]>([])
const current = ref<BatchKey | null>(null)
// 超过这么多本时交给后台采纳（一次请求逐本处理太久会超时）
const BACKGROUND_APPLY_MIN = 20
const JOB_POLL_MS = 2000
let jobTimer: ReturnType<typeof setTimeout> | null = null

const keyOf = (b: AiSuggestionBatch): BatchKey => b.batch_no ?? 'none'
const batchTabs = computed(() => batches.value
  .filter(b => b.count > 0 || b.applying > 0)
  .map(b => ({ key: keyOf(b), count: b.count, label: b.batch_no == null ? '未分批' : `第 ${b.batch_no} 批` })))
const totalPending = computed(() => batches.value.reduce((n, b) => n + b.count, 0))
const currentJobs = computed(() => jobs.value.filter(j => (j.batch_no ?? 'none') === current.value))
const jobDone = computed(() => currentJobs.value.reduce((n, j) => n + j.done, 0))
const jobTotal = computed(() => currentJobs.value.reduce((n, j) => n + j.total, 0))
const jobFailed = computed(() => currentJobs.value.reduce((n, j) => n + j.failed, 0))

const mismatchCount = computed(() => items.value.filter(s => s.content_mismatch).length)
const visible = computed(() => (filter.value === 'mismatch' ? items.value.filter(s => s.content_mismatch) : items.value))
const selectedCount = computed(() => visible.value.filter(s => choices[s.book_id] && hasSelection(choices[s.book_id])).length)

function fieldsOf(s: AiSuggestion): SuggestField[] {
  return SUGGEST_FIELDS.filter(f => s.data.fields[f])
}

function clip(text: string | null | undefined): string {
  const t = text || ''
  return t.length > 120 ? `${t.slice(0, 120)}…` : t
}

function errMsg(err: unknown, fallback: string): string {
  return (err as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback
}

async function loadBatches() {
  const data = (await libraryApi.aiSuggestionBatches()).data.data
  batches.value = data?.batches ?? []
  jobs.value = data?.jobs ?? []
  scheduleJobPoll()
}

/** 选批次：地址栏指定的 → 当前的（仍有待确认）→ 最早一批有待确认的 */
function pickBatch(preferred: BatchKey | null): BatchKey | null {
  const tabs = batchTabs.value
  const pending = tabs.filter(t => t.count > 0)
  if (preferred !== null && tabs.some(t => t.key === preferred)) return preferred
  return pending[0]?.key ?? tabs[0]?.key ?? null
}

function queryBatch(): BatchKey | null {
  const raw = route.query.batch
  if (raw === 'none') return 'none'
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

async function loadItems() {
  items.value = current.value === null ? [] : (await libraryApi.aiSuggestions(current.value)).data.data ?? []
  for (const s of items.value) if (!choices[s.book_id]) choices[s.book_id] = defaultChoice(s)
  if (mismatchCount.value === 0) filter.value = 'all'
}

async function load(preferred: BatchKey | null = current.value ?? queryBatch()) {
  loading.value = true
  try {
    await loadBatches()
    current.value = pickBatch(preferred)
    if (current.value !== null && String(current.value) !== String(route.query.batch ?? '')) {
      void router.replace({ query: { ...route.query, batch: String(current.value) } })
    }
    await loadItems()
  } catch (err) {
    ElMessage.error(errMsg(err, '加载失败'))
  } finally {
    loading.value = false
  }
}

function switchBatch(key: BatchKey) {
  if (key === current.value) return
  filter.value = 'all'
  void load(key)
}

// 当前批处理完：跳到下一批
async function afterRemoved() {
  const b = batches.value.find(x => keyOf(x) === current.value)
  if (b) b.count = items.value.length
  if (items.value.length === 0 && currentJobs.value.length === 0) await load(null)
  if (totalPending.value === 0) void noticeStore.loadTasks()   // 全部确认完，铃铛里的待确认提醒随之消失
}

function scheduleJobPoll() {
  if (jobTimer) clearTimeout(jobTimer)
  jobTimer = null
  if (jobs.value.length === 0) return
  jobTimer = setTimeout(async () => {
    const before = jobs.value.length
    try { await loadBatches() } catch { /* 下次再试 */ }
    // 有任务结束（失败的书会放回列表）：刷新当前批
    if (jobs.value.length < before) await jobsFinished()
  }, JOB_POLL_MS)
}

async function jobsFinished() {
  void noticeStore.loadTasks()   // 铃铛立即显示采纳结果
  // 当前批还有（失败放回的）书就留在本批，否则 pickBatch 会跳到最早一批有待确认的
  await load(current.value)
}

onUnmounted(() => { if (jobTimer) clearTimeout(jobTimer) })

function removeLocal(ids: string[]) {
  const set = new Set(ids)
  items.value = items.value.filter(s => !set.has(s.book_id))
}

async function apply(list: AiSuggestion[]) {
  const payload = list.filter(s => hasSelection(choices[s.book_id])).map(s => toSelection(s, choices[s.book_id]))
  if (payload.length === 0) return
  busy.value = true
  applying.value = payload.length > 1
  try {
    if (payload.length >= BACKGROUND_APPLY_MIN) {
      const job = (await libraryApi.createAiApplyJob(payload, typeof current.value === 'number' ? current.value : null)).data.data!
      removeLocal(payload.map(p => p.book_id))
      ElMessage.success(`已转为后台采纳（${job.total} 本），完成后铃铛会提醒`)
      await loadBatches()
      // 小批量可能已经做完：直接进入下一批
      if (currentJobs.value.length === 0) await jobsFinished()
      return
    }
    const res = (await libraryApi.applyAiSuggestions(payload)).data.data!
    removeLocal(res.applied)
    if (res.failed.length) ElMessage.warning(`已采纳 ${res.applied.length} 本，${res.failed.length} 本失败：${res.failed[0].error}`)
    else ElMessage.success(`已采纳 ${res.applied.length} 本`)
    await afterRemoved()
  } catch (err) {
    ElMessage.error(errMsg(err, '采纳失败'))
  } finally {
    busy.value = false
    applying.value = false
  }
}

const applyOne = (s: AiSuggestion) => apply([s])
const applySelected = () => apply(visible.value)

async function dismissIds(ids: string[]) {
  busy.value = true
  try {
    await libraryApi.dismissAiSuggestions(ids)
    removeLocal(ids)
    await afterRemoved()
  } catch (err) {
    ElMessage.error(errMsg(err, '操作失败'))
  } finally {
    busy.value = false
  }
}

const dismiss = (s: AiSuggestion) => dismissIds([s.book_id])

async function dismissAll() {
  try {
    await ElMessageBox.confirm(`忽略本批当前列表中全部 ${visible.value.length} 本书的 AI 建议？不会改动书的信息。`, '全部忽略', {
      type: 'warning', confirmButtonText: '全部忽略', cancelButtonText: '取消',
    })
  } catch { return }
  await dismissIds(visible.value.map(s => s.book_id))
}

async function dismissMismatch(s: AiSuggestion) {
  try {
    await libraryApi.dismissContentMismatch(s.book_id)
    s.content_mismatch = null
    if (mismatchCount.value === 0) filter.value = 'all'
  } catch (err) {
    ElMessage.error(errMsg(err, '操作失败'))
  }
}

onMounted(() => { void load() })
</script>

<style scoped>
.filters {
  margin: 4px 0 16px;
}
.batch-single {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--text-2);
}
.job-note {
  margin-bottom: 14px;
}
.sg-card {
  margin-bottom: 14px;
}
.sg-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.sg-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-0);
  text-decoration: none;
}
.sg-title:hover {
  color: var(--accent);
}
.sg-author {
  font-size: 13px;
  color: var(--text-2);
}
.sg-actions {
  margin-left: auto;
  display: flex;
  gap: 6px;
}
.sg-mismatch {
  margin-bottom: 10px;
}
.sg-row {
  display: flex;
  gap: 12px;
  padding: 10px 0;
  border-top: 1px solid var(--card-border);
}
.sg-row > .el-checkbox {
  flex: 0 0 96px;
  height: auto;
  align-items: flex-start;
}
.sg-body {
  flex: 1;
  min-width: 0;
}
.sg-change {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  flex-wrap: wrap;
  line-height: 1.6;
}
.sg-old {
  color: var(--text-2);
  text-decoration: line-through;
}
.sg-arrow {
  flex: none;
  margin-top: 4px;
  color: var(--text-2);
}
.sg-new {
  color: var(--text-0);
}
.sg-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 4px;
}
.sg-chips {
  display: flex;
  align-items: center;
  gap: 6px 10px;
  flex-wrap: wrap;
}
.sg-work {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-1);
}
.sg-link {
  color: var(--accent);
  text-decoration: none;
}
.sg-link:hover {
  text-decoration: underline;
}

@media (max-width: 768px) {
  .sg-row {
    flex-direction: column;
    gap: 4px;
  }
  .sg-row > .el-checkbox {
    flex: none;
  }
}
</style>
