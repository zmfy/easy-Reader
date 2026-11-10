<template>
  <section class="section-card manage-card" aria-label="书库管理">
    <div class="manage-main">
      <div class="manage-text">
        <h2 class="manage-title">书库管理</h2>
        <p class="manage-desc">把 NAS 书库目录里的新书导入进来，再用 AI 补全作者、简介和分类</p>
      </div>
      <div class="manage-actions">
        <el-button type="primary" size="large" class="manage-btn" :loading="scanStore.isRunning" @click="handleScan">
          <IconRefresh v-if="!scanStore.isRunning" :size="18" :stroke-width="1.9" />
          <span>扫描导入</span>
        </el-button>
        <el-button size="large" class="manage-btn" :disabled="scanStore.isRunning" @click="showFillDialog = true">
          <IconSparkles :size="18" :stroke-width="1.9" />
          <span>AI 填充</span>
        </el-button>
      </div>
    </div>

    <!-- 待办：没有就不显示 -->
    <div v-if="todos.length > 0" class="manage-todos">
      <button
        v-for="t in todos"
        :key="t.key"
        type="button"
        class="todo-chip"
        :class="{ 'todo-chip--warn': t.warn }"
        @click="t.action()"
      >
        {{ t.label }}<IconChevronRight :size="14" :stroke-width="2" />
      </button>
    </div>

    <ScanOptionsDialog v-model="showScanDialog" @confirm="onScanConfirm" />
    <AiFillDialog v-model="showFillDialog" />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { IconChevronRight, IconRefresh, IconSparkles } from '@tabler/icons-vue'
import ScanOptionsDialog from './ScanOptionsDialog.vue'
import AiFillDialog from './AiFillDialog.vue'
import { libraryApi } from '@/api/library'
import { scanBatchesApi } from '@/api/scan-batches'
import { useScanTaskStore } from '@/stores/scan-task'
import type { AiFillStatus, ScanBatch, ScanStartOptions } from '@/types'

/**
 * 书库页顶部的管理区（仅管理员）：扫描导入、AI 填充两个入口，以及待审核批次、AI 建议待确认、填充进度等待办。
 * 扫描 / 填充任务结束时通知书库页刷新书目。
 */
const emit = defineEmits<{ changed: [] }>()

const router = useRouter()
const scanStore = useScanTaskStore()

const showScanDialog = ref(false)
const showFillDialog = ref(false)
const pendingBatches = ref<ScanBatch[]>([])
const suggestionCount = ref(0)
const fillStatus = ref<AiFillStatus | null>(null)

interface Todo { key: string; label: string; warn?: boolean; action: () => void }

const todos = computed<Todo[]>(() => {
  const list: Todo[] = []
  const n = pendingBatches.value.length
  if (n > 0) {
    list.push({
      key: 'batches', warn: true,
      label: n === 1 ? '有 1 个扫描批次待审核' : `有 ${n} 个扫描批次待审核`,
      action: () => router.push(n === 1 ? `/library/scan-batches/${pendingBatches.value[0].id}` : '/library/scan-batches'),
    })
  }
  if (suggestionCount.value > 0) {
    list.push({ key: 'suggestions', label: `AI 建议待确认 ${suggestionCount.value} 本`, action: () => router.push('/library/ai-suggestions') })
  }
  const f = fillStatus.value
  if (f && f.remaining > 0) {
    const paused = f.last_task?.status === 'paused'
    list.push({
      key: 'fill', warn: paused,
      label: `${paused ? 'AI 填充已暂停' : 'AI 已填充'} ${f.done} / ${f.total} 本`,
      action: () => { showFillDialog.value = true },
    })
  }
  return list
})

async function refreshPendingBatches(): Promise<void> {
  try {
    pendingBatches.value = (await scanBatchesApi.list('pending')).data.data ?? []
  } catch {
    pendingBatches.value = []
  }
}

async function refreshSuggestionCount(): Promise<void> {
  try {
    suggestionCount.value = (await libraryApi.aiSuggestionCount()).data.data?.count ?? 0
  } catch {
    suggestionCount.value = 0
  }
}

async function refreshFillStatus(): Promise<void> {
  try {
    fillStatus.value = (await libraryApi.aiFillStatus()).data.data ?? null
  } catch {
    fillStatus.value = null
  }
}

function refreshAll(): void {
  void refreshPendingBatches()
  void refreshSuggestionCount()
  void refreshFillStatus()
}

async function handleScan(): Promise<void> {
  // 先与服务器同步：进度条的轮询可能已停
  await scanStore.refresh()
  if (scanStore.isRunning) {
    if (!scanStore.isPolling) scanStore.startPolling()
    ElMessage.info('已有扫描任务进行中，进度条已显示在顶部')
    return
  }
  await refreshPendingBatches()
  const pending = pendingBatches.value[0]
  if (pending) {
    ElMessageBox.alert(`存在未处理的待审核批次（${pending.id.slice(0, 8)}），请先处理后再扫描。`, '提示', {
      confirmButtonText: '去处理',
      callback: () => router.push(`/library/scan-batches/${pending.id}`),
    })
    return
  }
  showScanDialog.value = true
}

async function onScanConfirm(options: ScanStartOptions): Promise<void> {
  try {
    await scanStore.startScan(options)
    ElMessage.success('扫描任务已启动')
  } catch (err: unknown) {
    const e = err as { response?: { status?: number; data?: { code?: string } } }
    if (e.response?.status === 409) {
      if (e.response.data?.code === 'PENDING_BATCH') {
        ElMessage.warning('请先处理待审核批次')
        await refreshPendingBatches()
      } else {
        ElMessage.warning('已有扫描任务在运行')
        void scanStore.refresh()
      }
    } else {
      ElMessage.error('扫描失败')
    }
  }
}

// 扫描 / 填充结束：刷新待办，并让书库页刷新书目
watch(() => scanStore.activeTask?.status, (newStatus, oldStatus) => {
  if (oldStatus === 'running' && newStatus !== 'running') {
    refreshAll()
    emit('changed')
  }
})
// 填充对话框里重置了记录：关闭时刷新进度
watch(showFillDialog, (open) => { if (!open) void refreshFillStatus() })

onMounted(refreshAll)
</script>

<style scoped>
.manage-card {
  margin-bottom: 24px;
  border-color: color-mix(in srgb, var(--accent) 22%, var(--card-border));
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--accent) 7%, transparent), transparent 60%),
    var(--card-bg);
}
.manage-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px 24px;
  flex-wrap: wrap;
}
.manage-text { min-width: 0; }
.manage-title { margin: 0; font-size: 17px; font-weight: 600; color: var(--text-0); }
.manage-desc { margin: 4px 0 0; font-size: 13px; line-height: 1.6; color: var(--text-2); }
.manage-actions { display: flex; gap: 12px; flex-shrink: 0; }
.manage-actions .el-button + .el-button { margin-left: 0; }
.manage-btn { min-width: 132px; font-weight: 600; }
.manage-btn :deep(> span) { display: inline-flex; align-items: center; gap: 6px; }

.manage-todos {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px dashed var(--card-border);
}
.todo-chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 5px 8px 5px 12px;
  border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  color: var(--accent);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  transition: background-color 0.15s ease;
}
.todo-chip:hover { background: color-mix(in srgb, var(--accent) 15%, transparent); }
.todo-chip--warn {
  border-color: color-mix(in srgb, var(--warning) 40%, transparent);
  background: color-mix(in srgb, var(--warning) 10%, transparent);
  color: var(--warning);
}
.todo-chip--warn:hover { background: color-mix(in srgb, var(--warning) 18%, transparent); }

/* 手机：两个按钮各占一半，并排 */
@media (max-width: 640px) {
  .manage-card { padding: 16px; margin-bottom: 16px; }
  .manage-actions { width: 100%; }
  .manage-btn { flex: 1; min-width: 0; }
}
</style>
