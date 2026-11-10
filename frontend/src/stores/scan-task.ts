import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { scanTaskApi } from '@/api/scan-task'
import { libraryApi } from '@/api/library'
import type { ScanTask } from '@/types'

const POLL_INTERVAL_MS = 2000

export const useScanTaskStore = defineStore('scanTask', () => {
  const activeTask = ref<ScanTask | null>(null)
  const isPolling = ref(false)
  let pollTimer: ReturnType<typeof setInterval> | null = null

  const isRunning = computed(() => activeTask.value?.status === 'running')
  const progress = computed(() => {
    const t = activeTask.value
    if (!t || t.total_files === 0) return 0
    return Math.round((t.processed_files / t.total_files) * 100)
  })

  async function refresh(): Promise<void> {
    try {
      const resp = await scanTaskApi.getActive()
      const fresh = resp.data.data ?? null
      if (fresh) {
        activeTask.value = fresh
        if (fresh.status !== 'running') stopPolling()
      } else if (activeTask.value && activeTask.value.status === 'running') {
        // Task finished between polls — 取实际结果（可能是完成 / 失败 / 额度用完暂停）
        const prev = activeTask.value
        const done = await scanTaskApi.getById(prev.id).then(r => r.data.data ?? null).catch(() => null)
        activeTask.value = done ?? { ...prev, status: 'completed' }
        stopPolling()
      }
    } catch {
      // ignore polling errors
    }
  }

  function startPolling(): void {
    if (isPolling.value) return
    isPolling.value = true
    void refresh()
    pollTimer = setInterval(refresh, POLL_INTERVAL_MS)
  }

  function stopPolling(): void {
    isPolling.value = false
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  async function startScan(payload: import('@/types').ScanStartOptions): Promise<void> {
    const resp = await scanTaskApi.start(payload)
    const taskId = resp.data.data?.taskId
    if (taskId) {
      activeTask.value = { id: taskId, status: 'running', stage: 'walking', processed_files: 0, total_files: 0 } as unknown as ScanTask
    }
    startPolling()
  }

  // 继续 / 开始 AI 填充（不重新遍历文件）：只处理还没填充过的书，额度用完暂停后从停下的地方接着跑
  async function startAiFill(): Promise<void> {
    const resp = await libraryApi.aiFillBatch(false)
    const taskId = resp.data.data?.taskId
    if (taskId) {
      activeTask.value = { id: taskId, status: 'running', stage: 'ai_fill', processed_files: 0, total_files: 0 } as unknown as ScanTask
    }
    startPolling()
  }

  async function cancel(): Promise<void> {
    if (!activeTask.value) return
    await scanTaskApi.cancel(activeTask.value.id)
    await refresh()
  }

  return {
    activeTask,
    isRunning,
    progress,
    isPolling,
    refresh,
    startPolling,
    stopPolling,
    startScan,
    startAiFill,
    cancel,
  }
})
