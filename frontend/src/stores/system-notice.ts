import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { settingsApi } from '@/api/settings'
import { noticesApi } from '@/api/notices'
import { unreadCount, markSeen } from '@/utils/notice-count'
import type { Release, TaskNotice, UpdateStatus } from '@/types'

const TASK_POLL_MS = 60_000

// 铃铛提醒的共享状态：侧栏与手机顶部栏两处铃铛、设置页开关共用
export const useSystemNoticeStore = defineStore('systemNotice', () => {
  const status = ref<UpdateStatus | null>(null)
  const configWarning = ref<string | null>(null)
  // HTTPS 证书到期提醒（剩余 14 天内 / 已过期）
  const certWarning = ref<string | null>(null)
  // markSeen 写的是 localStorage，不是响应式数据；用计数器触发红点重算
  const seenTick = ref(0)
  // 后台任务通知（AI 填充分批完成 / 暂停、采纳完成、扫描待审核），服务端记已读
  const taskNotices = ref<TaskNotice[]>([])
  const taskUnread = ref(0)
  let taskTimer: ReturnType<typeof setInterval> | null = null

  const enabled = computed(() => status.value?.noticeEnabled === true)
  const latest = computed<Release | null>(() => status.value?.newer?.[0] ?? null)
  // 任一未升级版本含【需操作】即一直计数——需操作事项在升级前一直存在
  const actionRequired = computed(
    () => !!status.value?.newer?.some(r => r.sections.some(s => s.items.some(i => i.actionRequired))),
  )

  function storage(): Storage | null {
    try {
      return window.localStorage
    } catch {
      return null
    }
  }

  const count = computed(() => {
    void seenTick.value
    const input = {
      configWarnings: (configWarning.value ? 1 : 0) + (certWarning.value ? 1 : 0),
      latestVersion: latest.value?.version ?? null,
      actionRequired: actionRequired.value,
    }
    const store = storage()
    if (!store) return input.configWarnings + (input.latestVersion ? 1 : 0) + taskUnread.value
    return unreadCount(input, store) + taskUnread.value
  })

  async function loadTasks(): Promise<void> {
    try {
      const data = (await noticesApi.list()).data.data
      taskNotices.value = data?.items ?? []
      taskUnread.value = data?.unread ?? 0
    } catch { /* 静默 */ }
  }

  // 管理员登录后定时拉取任务通知（后台任务跑几个小时，完成时用户可能在任意页面）
  function startTaskPolling(): void {
    void loadTasks()
    if (taskTimer) return
    taskTimer = setInterval(() => { void loadTasks() }, TASK_POLL_MS)
  }

  function stopTaskPolling(): void {
    if (taskTimer) clearInterval(taskTimer)
    taskTimer = null
  }

  async function markTaskRead(id: string): Promise<void> {
    const n = taskNotices.value.find(x => x.id === id)
    if (!n || n.read_at) return
    n.read_at = new Date().toISOString()
    taskUnread.value = Math.max(0, taskUnread.value - 1)
    await noticesApi.markRead(id).catch(() => {})
  }

  async function markAllTasksRead(): Promise<void> {
    if (taskUnread.value === 0) return
    for (const n of taskNotices.value) n.read_at ??= new Date().toISOString()
    taskUnread.value = 0
    await noticesApi.markAllRead().catch(() => {})
  }

  async function load(): Promise<void> {
    // 几个接口互不影响，失败一律静默
    const [updResp, aiResp, httpsResp] = await Promise.allSettled([
      settingsApi.getUpdateStatus(),
      settingsApi.getAiStatus(),
      settingsApi.getHttps(),
    ])
    certWarning.value = httpsResp.status === 'fulfilled' ? httpsResp.value.data.data?.warning ?? null : null
    if (updResp.status === 'fulfilled') status.value = updResp.value.data.data ?? null
    if (aiResp.status === 'fulfilled') configWarning.value = aiResp.value.data.data?.config_warning ?? null
  }

  function setStatus(next: UpdateStatus | null): void {
    status.value = next
  }

  // 打开面板即视为看过
  function markOpened(): void {
    const store = storage()
    if (latest.value && store) markSeen(latest.value.version, store)
    seenTick.value++
  }

  return {
    status, configWarning, certWarning, enabled, latest, actionRequired, count, load, setStatus, markOpened,
    taskNotices, taskUnread, loadTasks, startTaskPolling, stopTaskPolling, markTaskRead, markAllTasksRead,
  }
})
