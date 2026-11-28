<template>
  <DefaultLayout>
    <div v-loading="loading" class="page page--narrow">
      <PageHeader :title="`${readOnly ? '查看批次' : '审核批次'} ${batchIdShort}`" back="/library/scan-batches">
        <template #actions>
          <el-tag v-if="batch" :type="statusType" size="small">{{ statusLabel }}</el-tag>
          <el-tag v-if="!readOnly && !isOrganize && unreviewedCount > 0" type="warning">{{ unreviewedCount }} 项未审视</el-tag>
          <el-tag v-if="!readOnly && undecidedDamaged > 0" type="danger">还有 {{ undecidedDamaged }} 本损坏的书没选</el-tag>
          <el-button v-if="!readOnly" type="danger" plain @click="onDiscard">{{ isOrganize ? '废弃（保留原书）' : '废弃批次' }}</el-button>
          <el-button
            v-if="!readOnly"
            type="primary"
            :disabled="batch?.status !== 'pending' || undecidedDamaged > 0"
            @click="onApply"
          >{{ isOrganize ? '执行决定' : '应用全部' }}</el-button>
        </template>
      </PageHeader>

      <!-- Applied/discarded: show audit summary at top -->
      <el-alert
        v-if="readOnly && organizeSummary"
        type="success"
        :closable="false"
        show-icon
        class="audit-alert"
      >
        <template #title>
          {{ batch?.status === 'discarded' ? '已废弃' : '已执行' }} · {{ formatServerTime(batch?.applied_at) }} by {{ batch?.applied_by }}
        </template>
        <div class="audit-summary">
          {{ ORGANIZE_DECISION_LABELS[organizeSummary.decision] }}
          <template v-if="organizeSummary.decision !== 'keep_old'">
            · 迁移阅读进度 {{ organizeSummary.migrated.progress }} · 书签 {{ organizeSummary.migrated.bookmarks }} ·
            书架 {{ organizeSummary.migrated.shelf }} · 阅读历史 {{ organizeSummary.migrated.history }}
          </template>
          <div v-for="(w, i) in organizeSummary.warnings ?? []" :key="i" class="errors">{{ w }}</div>
        </div>
      </el-alert>
      <el-alert
        v-else-if="readOnly && appliedSummary"
        type="success"
        :closable="false"
        show-icon
        class="audit-alert"
      >
        <template #title>
          应用结果 · {{ formatServerTime(batch?.applied_at) }} by {{ batch?.applied_by }}
        </template>
        <div class="audit-summary">
          新增 {{ appliedSummary.inserted }} ·
          更新 {{ appliedSummary.updated }} ·
          关联重复 {{ appliedSummary.duplicates_linked }} ·
          创建系列 {{ appliedSummary.series_created }} ·
          标乱码 {{ appliedSummary.garbled_marked }}
          <template v-if="appliedSummary.damaged_imported || appliedSummary.damaged_skipped">
            · 损坏导入 {{ appliedSummary.damaged_imported ?? 0 }} ·
            损坏跳过 {{ appliedSummary.damaged_skipped ?? 0 }}
          </template>
          <span v-if="appliedSummary.errors.length > 0" class="errors">
            · <strong>错误 {{ appliedSummary.errors.length }}</strong>
          </span>
        </div>
      </el-alert>

      <!-- 整理审核批次：只有一条 organized_duplicate -->
      <template v-if="batch && isOrganize">
        <OrganizedDuplicateCard
          v-for="item in organizeItems"
          :key="item.id"
          :payload="organizePayload(item)"
          :decision="organizeDecisionOf(item)"
          :read-only="readOnly"
          @change="(d) => onOrganizeDecide(item.id, d)"
        />
      </template>

      <div v-else-if="batch" class="section-card section-card--flush">
      <el-collapse v-model="activePanels">
        <el-collapse-item v-if="grouped.new.length > 0" :name="'new'">
          <template #title>
            <span class="panel-title">新书 <el-badge :value="grouped.new.length" /></span>
          </template>
          <div v-if="activePanels.includes('new')" class="panel-body">
            <div v-for="item in paged('new')" :key="item.id" class="new-row">
              <span class="path" :title="payload(item).file_path">{{ shortPath(payload(item).file_path) }}</span>
              <span class="meta">{{ payload(item).chapter_count }} 章</span>
              <el-tag v-if="payload(item).repaired" size="small" type="info">已自动修正</el-tag>
              <BatchItemPreview :batch-id="batch.id" :file-path="payload(item).file_path" />
            </div>
            <el-pagination
              v-if="grouped.new.length > PAGE_SIZE"
              v-model:current-page="pages.new"
              :page-size="PAGE_SIZE"
              :total="grouped.new.length"
              layout="prev, pager, next, ->, total"
              small
              background
            />
          </div>
        </el-collapse-item>

        <el-collapse-item v-if="grouped.duplicate_group.length > 0" :name="'duplicate_group'">
          <template #title>
            <span class="panel-title">重复组 <el-badge :value="grouped.duplicate_group.length" /></span>
          </template>
          <div v-if="activePanels.includes('duplicate_group')" class="panel-body">
            <DuplicateGroupCard
              v-for="item in paged('duplicate_group')"
              :key="item.id"
              :batch-id="batch.id"
              :payload="payload(item)"
              :decision="decisionOf(item)"
              :read-only="readOnly"
              @modify="(p) => onModify(item.id, p)"
              @accept="onItemAccept(item.id)"
              @reject="onItemReject(item.id)"
            />
            <el-pagination
              v-if="grouped.duplicate_group.length > PAGE_SIZE"
              v-model:current-page="pages.duplicate_group"
              :page-size="PAGE_SIZE"
              :total="grouped.duplicate_group.length"
              layout="prev, pager, next, ->, total"
              small
              background
            />
          </div>
        </el-collapse-item>

        <el-collapse-item v-if="grouped.series.length > 0" :name="'series'">
          <template #title>
            <span class="panel-title">系列 <el-badge :value="grouped.series.length" /></span>
          </template>
          <div v-if="activePanels.includes('series')" class="panel-body">
            <SeriesGroupCard
              v-for="item in paged('series')"
              :key="item.id"
              :batch-id="batch.id"
              :payload="payload(item)"
              :decision="decisionOf(item)"
              :read-only="readOnly"
              @modify="(p) => onModify(item.id, p)"
              @accept="onItemAccept(item.id)"
              @reject="onItemReject(item.id)"
            />
            <el-pagination
              v-if="grouped.series.length > PAGE_SIZE"
              v-model:current-page="pages.series"
              :page-size="PAGE_SIZE"
              :total="grouped.series.length"
              layout="prev, pager, next, ->, total"
              small
              background
            />
          </div>
        </el-collapse-item>

        <el-collapse-item v-if="grouped.encoding_fixed.length > 0" :name="'encoding_fixed'">
          <template #title>
            <span class="panel-title">编码已修复 <el-badge :value="grouped.encoding_fixed.length" /></span>
          </template>
          <div v-if="activePanels.includes('encoding_fixed')" class="panel-body">
            <div v-for="item in paged('encoding_fixed')" :key="item.id" class="fix-row">
              <span class="path">{{ shortPath(payload(item).file_path) }}</span>
              <el-tag size="small">{{ payload(item).from_encoding }} → utf-8</el-tag>
            </div>
            <el-pagination
              v-if="grouped.encoding_fixed.length > PAGE_SIZE"
              v-model:current-page="pages.encoding_fixed"
              :page-size="PAGE_SIZE"
              :total="grouped.encoding_fixed.length"
              layout="prev, pager, next, ->, total"
              small
              background
            />
          </div>
        </el-collapse-item>

        <el-collapse-item v-if="grouped.garbled.length > 0" :name="'garbled'">
          <template #title>
            <span class="panel-title">真乱码（保留磁盘，不入书库） <el-badge :value="grouped.garbled.length" type="danger" /></span>
          </template>
          <div v-if="activePanels.includes('garbled')" class="panel-body">
            <div v-for="item in paged('garbled')" :key="item.id" class="garbled-row">
              <span class="path">{{ shortPath(payload(item).file_path) }}</span>
              <span class="reason">{{ payload(item).reason }}</span>
            </div>
            <el-pagination
              v-if="grouped.garbled.length > PAGE_SIZE"
              v-model:current-page="pages.garbled"
              :page-size="PAGE_SIZE"
              :total="grouped.garbled.length"
              layout="prev, pager, next, ->, total"
              small
              background
            />
          </div>
        </el-collapse-item>

        <el-collapse-item v-if="grouped.damaged.length > 0" :name="'damaged'">
          <template #title>
            <span class="panel-title">文件损坏（逐本选择导入或跳过） <el-badge :value="grouped.damaged.length" type="danger" /></span>
          </template>
          <div v-if="activePanels.includes('damaged')" class="panel-body">
            <p class="damaged-hint">导入后在书库中标为「损坏」，打不开时会提示原因；跳过则不入书库，文件不变时下次扫描不再提示。</p>
            <div v-for="item in paged('damaged')" :key="item.id" class="damaged-row">
              <span class="path" :title="payload(item).file_path">{{ shortPath(payload(item).file_path) }}</span>
              <span class="meta">{{ formatSize(payload(item).file_size) }}</span>
              <span class="reason">{{ payload(item).reason }}</span>
              <el-radio-group
                v-if="!readOnly"
                class="damaged-choice"
                size="small"
                :model-value="item.admin_decision ?? undefined"
                @change="(v) => onDamagedDecide(item.id, v)"
              >
                <el-radio-button value="accept">导入</el-radio-button>
                <el-radio-button value="reject">跳过</el-radio-button>
              </el-radio-group>
              <el-tag v-else-if="item.admin_decision" size="small" type="info" class="damaged-choice">
                {{ item.admin_decision === 'reject' ? '已跳过' : '已导入' }}
              </el-tag>
            </div>
            <el-pagination
              v-if="grouped.damaged.length > PAGE_SIZE"
              v-model:current-page="pages.damaged"
              :page-size="PAGE_SIZE"
              :total="grouped.damaged.length"
              layout="prev, pager, next, ->, total"
              small
              background
            />
          </div>
        </el-collapse-item>
      </el-collapse>
      </div>
    </div>
  </DefaultLayout>
</template>

<script setup lang="ts">
import { ref, computed, reactive, onMounted } from 'vue'
import { formatServerTime } from '@/utils/time'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import DefaultLayout from '@/layouts/DefaultLayout.vue'
import PageHeader from '@/components/PageHeader.vue'
import DuplicateGroupCard from '@/components/DuplicateGroupCard.vue'
import SeriesGroupCard from '@/components/SeriesGroupCard.vue'
import BatchItemPreview from '@/components/BatchItemPreview.vue'
import OrganizedDuplicateCard from '@/components/OrganizedDuplicateCard.vue'
import { scanBatchesApi } from '@/api/scan-batches'
import { useSystemNoticeStore } from '@/stores/system-notice'
import { undecidedDamagedCount, organizeDecisionOf, ORGANIZE_DECISION_LABELS } from '@/utils/scan-review'
import type { ScanBatch, ScanBatchItem, OrganizeApplySummary, OrganizeDecision, OrganizedDuplicatePayload } from '@/types'

const PAGE_SIZE = 20

const route = useRoute()
const router = useRouter()
const noticeStore = useSystemNoticeStore()
const batchId = route.params.id as string
const batchIdShort = computed(() => {
  const part = batch.value && (batch.value.part_count ?? 1) > 1 ? `（第 ${batch.value.part_index} / ${batch.value.part_count} 批）` : ''
  return batchId.slice(0, 8) + part
})

const batch = ref<ScanBatch | null>(null)
const items = ref<ScanBatchItem[]>([])
const loading = ref(false)
// Default: all collapsed for performance; user must click to expand
const activePanels = ref<string[]>([])
const pages = reactive<Record<string, number>>({
  new: 1, duplicate_group: 1, series: 1, garbled: 1, encoding_fixed: 1, damaged: 1,
})

const readOnly = computed(() => batch.value?.status !== 'pending')

const statusType = computed(() => {
  const s = batch.value?.status
  return s === 'pending' ? 'warning' : s === 'applied' ? 'success' : 'info'
})
const statusLabel = computed(() => {
  const map: Record<string, string> = { pending: '待审核', applied: '已应用', discarded: '已废弃' }
  return map[batch.value?.status ?? ''] ?? batch.value?.status ?? ''
})

interface ApplySummary {
  inserted: number
  updated: number
  duplicates_linked: number
  series_created: number
  garbled_marked: number
  // 旧批次的应用结果没有这两项
  damaged_imported?: number
  damaged_skipped?: number
  errors: Array<{ item_id: string; message: string }>
}
const appliedSummary = computed<ApplySummary | null>(() => {
  if (!batch.value?.apply_summary || isOrganize.value) return null
  try { return JSON.parse(batch.value.apply_summary) as ApplySummary } catch { return null }
})

// 整理审核批次（kind='organize'）：一条 organized_duplicate，决定存在 admin_payload.decision
const isOrganize = computed(() => batch.value?.kind === 'organize')
const organizeItems = computed(() => items.value.filter(i => i.type === 'organized_duplicate'))
const organizeSummary = computed<OrganizeApplySummary | null>(() => {
  if (!batch.value?.apply_summary || !isOrganize.value) return null
  try { return JSON.parse(batch.value.apply_summary) as OrganizeApplySummary } catch { return null }
})
// admin_payload 只有 { decision }，书目信息始终取原始 payload
function organizePayload(item: ScanBatchItem): OrganizedDuplicatePayload {
  return JSON.parse(item.payload) as OrganizedDuplicatePayload
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function payload(item: ScanBatchItem): any {
  try { return JSON.parse(item.admin_payload ?? item.payload) } catch { return {} }
}
function shortPath(p: string): string { return (p || '').split('/').slice(-2).join('/') }

function decisionOf(item: ScanBatchItem): 'accepted' | 'rejected' | null {
  if (item.admin_decision === 'reject') return 'rejected'
  if (item.admin_decision === 'accept' || item.admin_decision === 'modified') return 'accepted'
  return null
}

const grouped = computed(() => {
  const out: Record<string, ScanBatchItem[]> = {
    new: [], duplicate_group: [], series: [], garbled: [], encoding_fixed: [], damaged: [],
  }
  for (const it of items.value) {
    if (it.type in out) out[it.type].push(it)
  }
  return out as {
    new: ScanBatchItem[]
    duplicate_group: ScanBatchItem[]
    series: ScanBatchItem[]
    garbled: ScanBatchItem[]
    encoding_fixed: ScanBatchItem[]
    damaged: ScanBatchItem[]
  }
})

function paged(type: 'new' | 'duplicate_group' | 'series' | 'garbled' | 'encoding_fixed' | 'damaged'): ScanBatchItem[] {
  const all = grouped.value[type]
  const start = (pages[type] - 1) * PAGE_SIZE
  return all.slice(start, start + PAGE_SIZE)
}

const unreviewedCount = computed(() => items.value.filter(i => !i.admin_decision).length)
// 损坏的书必须逐本选「导入 / 跳过」才能应用（后端同样拒绝）
const undecidedDamaged = computed(() => undecidedDamagedCount(items.value))

function formatSize(bytes?: number): string {
  if (!bytes) return '-'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

async function fetchBatch(): Promise<void> {
  loading.value = true
  try {
    const resp = await scanBatchesApi.get(batchId)
    batch.value = resp.data.data!.batch
    items.value = resp.data.data!.items
    // 有待选择的损坏书时默认展开该栏，免得找不到「应用」为何不可用
    if (undecidedDamaged.value > 0 && !activePanels.value.includes('damaged')) activePanels.value.push('damaged')
  } finally {
    loading.value = false
  }
}

async function onModify(itemId: string, p: unknown): Promise<void> {
  await scanBatchesApi.updateItem(batchId, itemId, 'modified', p)
  await fetchBatch()
}
async function onItemAccept(itemId: string): Promise<void> {
  await scanBatchesApi.updateItem(batchId, itemId, 'accept')
  await fetchBatch()
}
async function onItemReject(itemId: string): Promise<void> {
  await scanBatchesApi.updateItem(batchId, itemId, 'reject')
  await fetchBatch()
}
async function onDamagedDecide(itemId: string, v: string | number | boolean | undefined): Promise<void> {
  if (v !== 'accept' && v !== 'reject') return
  await scanBatchesApi.updateItem(batchId, itemId, v)
  await fetchBatch()
}
async function onOrganizeDecide(itemId: string, d: OrganizeDecision): Promise<void> {
  await scanBatchesApi.updateItem(batchId, itemId, d === 'keep_old' ? 'reject' : 'accept', { decision: d })
  await fetchBatch()
}
async function onApplyOrganize(): Promise<void> {
  const item = organizeItems.value[0]
  if (!item) return
  const d = organizeDecisionOf(item)
  const p = organizePayload(item)
  if (d === 'keep_new_delete_file') {
    // 删除原文件不可恢复：二次确认，写明要删的文件
    await ElMessageBox.confirm(
      `将从磁盘删除原文件「${p.original.file_path}」，删除后无法恢复。确定执行？`,
      '删除原文件',
      { type: 'error', confirmButtonText: '删除原文件', confirmButtonClass: 'el-button--danger' },
    )
  } else {
    await ElMessageBox.confirm(`确认执行：${ORGANIZE_DECISION_LABELS[d]}？`, '执行确认', { type: 'warning' })
  }
  const resp = await scanBatchesApi.apply(batchId)
  const r = resp.data.data as OrganizeApplySummary
  const warnings = r.warnings ?? []
  ElMessage({
    type: warnings.length > 0 ? 'warning' : 'success',
    message: `已执行：${ORGANIZE_DECISION_LABELS[r.decision]}${warnings.length > 0 ? `（${warnings.join('；')}）` : ''}`,
    duration: 6000,
  })
  void noticeStore.loadTasks()
  await fetchBatch()
}
async function onApply(): Promise<void> {
  if (isOrganize.value) return onApplyOrganize()
  await ElMessageBox.confirm(
    `确认应用？\n${unreviewedCount.value} 项未审视将按 AI 判定执行（重复=合并、系列=归纳）。`,
    '应用确认',
    { type: 'warning' },
  )
  const resp = await scanBatchesApi.apply(batchId)
  const r = resp.data.data! as Exclude<NonNullable<typeof resp.data.data>, OrganizeApplySummary>
  ElMessage({
    type: r.errors.length > 0 ? 'warning' : 'success',
    message: `已应用：新增 ${r.inserted} · 更新 ${r.updated} · 关联重复 ${r.duplicates_linked} · 创建系列 ${r.series_created} · 标乱码 ${r.garbled_marked}${r.damaged_imported || r.damaged_skipped ? ` · 损坏导入 ${r.damaged_imported} · 损坏跳过 ${r.damaged_skipped}` : ''}${r.errors.length > 0 ? ` · 错误 ${r.errors.length}` : ''}`,
    duration: 6000,
  })
  void noticeStore.loadTasks()   // 铃铛里的待审核提醒随之更新（全部审完则消失）
  await fetchBatch() // stay on page, now in read-only mode showing audit
}
async function onDiscard(): Promise<void> {
  await ElMessageBox.confirm(
    isOrganize.value ? '废弃即保留原书，整理版将被删除。确定？' : '确认废弃整个批次？AI 判定结果将丢弃，但已修复编码的文件不会还原。',
    '废弃确认',
    { type: 'warning' },
  )
  await scanBatchesApi.discard(batchId)
  ElMessage.success('已废弃')
  void noticeStore.loadTasks()
  router.push('/library/scan-batches')
}

onMounted(fetchBatch)
</script>

<style scoped>
.audit-alert { margin-bottom: 16px; }
.audit-summary { font-size: 13px; }
.audit-summary .errors { color: var(--danger); }
.panel-title { font-weight: 500; }
/* 折叠面板贴卡片边：标题与内容的左右内边距与卡片对齐，去掉 EP 自带外框线 */
.section-card--flush :deep(.el-collapse) { border: none; }
.section-card--flush :deep(.el-collapse-item__header) { padding: 0 24px; }
.section-card--flush :deep(.el-collapse-item__content) { padding: 0 24px 16px; }
.section-card--flush :deep(.el-collapse-item:last-child .el-collapse-item__wrap) { border-bottom: none; }
.panel-body { padding: 8px 0; }
.new-row, .fix-row, .garbled-row, .damaged-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 0;
  font-size: 13px;
}
.path { font-family: var(--font-mono); }
.meta { color: var(--text-2); }
.reason { color: var(--danger); font-size: 12px; }
.damaged-hint { margin: 0 0 8px; font-size: 12px; color: var(--text-2); }
.damaged-row .path { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.damaged-choice { margin-left: auto; flex: none; }
</style>
