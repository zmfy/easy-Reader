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
      activeTask.value = resp.data.data ?? null
      // If task is no longer running, stop polling
      if (activeTask.value && activeTask.value.status !== 'running') {
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
    await scanTaskApi.start(payload)
    await refresh()
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
