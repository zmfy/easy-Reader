import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { settingsApi } from '@/api/settings'
import { unreadCount, markSeen } from '@/utils/notice-count'
import type { Release, UpdateStatus } from '@/types'

// 铃铛提醒的共享状态：侧栏与手机顶部栏两处铃铛、设置页开关共用
export const useSystemNoticeStore = defineStore('systemNotice', () => {
  const status = ref<UpdateStatus | null>(null)
  const configWarning = ref<string | null>(null)
  // markSeen 写的是 localStorage，不是响应式数据；用计数器触发红点重算
  const seenTick = ref(0)

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
      configWarnings: configWarning.value ? 1 : 0,
      latestVersion: latest.value?.version ?? null,
      actionRequired: actionRequired.value,
    }
    const store = storage()
    if (!store) return input.configWarnings + (input.latestVersion ? 1 : 0)
    return unreadCount(input, store)
  })

  async function load(): Promise<void> {
    // 两个接口互不影响，失败一律静默
    const [updResp, aiResp] = await Promise.allSettled([
      settingsApi.getUpdateStatus(),
      settingsApi.getAiStatus(),
    ])
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

  return { status, configWarning, enabled, latest, actionRequired, count, load, setStatus, markOpened }
})
