import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { scanTaskApi } from '@/api/scan-task'
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
        // Task finished between polls (fast scan) — surface completion to the UI.
        activeTask.value = { ...activeTask.value, status: 'completed' }
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
    cancel,
  }
})
