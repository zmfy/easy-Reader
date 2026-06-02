<template>
  <div v-if="show" class="scan-progress-bar">
    <div class="progress-content">
      <div class="progress-label">
        <span class="stage-text">{{ stageLabel }}</span>
        <span class="progress-text">{{ store.activeTask?.processed_files ?? 0 }} / {{ store.activeTask?.total_files ?? 0 }}</span>
      </div>
      <el-progress
        :percentage="store.progress"
        :stroke-width="6"
        :show-text="false"
        :status="store.activeTask?.status === 'failed' ? 'exception' : undefined"
      />
    </div>
    <div class="progress-actions">
      <el-button v-if="store.isRunning" size="small" type="danger" plain @click="onCancel">
        取消
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useScanTaskStore } from '@/stores/scan-task'
import { useAuthStore } from '@/stores/auth'

const store = useScanTaskStore()
const authStore = useAuthStore()

const show = computed(() => {
  const t = store.activeTask
  if (!t) return false
  // Show while running or 5s after completion / failure
  return t.status === 'running'
})

const stageLabel = computed(() => {
  const t = store.activeTask
  if (!t) return ''
  const stageMap: Record<string, string> = {
    walking: '遍历文件中…',
    fingerprinting: '计算指纹中…',
    dedup: 'AI 判定重复书籍…',
    series: 'AI 识别系列归类…',
    staging: '保存审核批次…',
    ai_fill: 'AI 补充书籍信息…',
  }
  return stageMap[t.stage ?? ''] ?? '处理中…'
})

async function onCancel(): Promise<void> {
  try {
    await store.cancel()
    ElMessage.success('已发送取消请求')
  } catch {
    ElMessage.error('取消失败')
  }
}

onMounted(() => {
  if (!authStore.isLoggedIn) return
  // On mount, check if there's an active task (e.g., user reloaded page mid-scan)
  void store.refresh().then(() => {
    if (store.isRunning) store.startPolling()
  })
})

// Desktop notification when scan finishes (regardless of which page user is on)
watch(() => store.activeTask?.status, (newStatus, oldStatus) => {
  if (oldStatus === 'running' && (newStatus === 'completed' || newStatus === 'failed' || newStatus === 'cancelled')) {
    void notifyOnFinish(newStatus)
  }
})

async function notifyOnFinish(status: string): Promise<void> {
  if (!('Notification' in window)) return
  if (Notification.permission === 'default') {
    try { await Notification.requestPermission() } catch { return }
  }
  if (Notification.permission !== 'granted') return
  const titles: Record<string, string> = {
    completed: '扫描完成',
    failed: '扫描失败',
    cancelled: '扫描已取消',
  }
  const t = store.activeTask
  const bodyParts: string[] = []
  if (t) {
    bodyParts.push(`处理 ${t.processed_files} / ${t.total_files} 个文件`)
  }
  bodyParts.push('点击查看 easy-Reader 书库')
  try {
    new Notification(titles[status] ?? '扫描结束', {
      body: bodyParts.join('\n'),
      icon: '/favicon.svg',
    })
  } catch {
    // Some browsers (mobile) require ServiceWorker for notifications; fall back silently
  }
}
</script>

<style scoped>
.scan-progress-bar {
  position: sticky;
  top: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 16px;
  background: var(--el-color-primary-light-9);
  border-bottom: 1px solid var(--el-color-primary-light-7);
}
.progress-content {
  flex: 1;
  min-width: 0;
}
.progress-label {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--el-color-primary);
  margin-bottom: 4px;
}
.stage-text { font-weight: 500; }
.progress-text { color: var(--text-2); }
.progress-actions { flex-shrink: 0; }
</style>
