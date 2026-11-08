import { computed, ref } from 'vue'
import { installMode, type InstallMode } from '@/utils/pwa-install'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// 浏览器在页面加载早期派发 beforeinstallprompt：在 main.ts 里尽早监听并保存
const deferred = ref<BeforeInstallPromptEvent | null>(null)
const installed = ref(false)

function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

export function initPwaInstall(): void {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault()  // 不让浏览器自己弹出迷你横幅，由菜单里的入口触发
    deferred.value = e as BeforeInstallPromptEvent
  })
  window.addEventListener('appinstalled', () => {
    installed.value = true
    deferred.value = null
  })
}

export function usePwaInstall() {
  const mode = computed<InstallMode>(() => installMode({
    standalone: installed.value || isStandalone(),
    secure: window.isSecureContext,
    hasPrompt: !!deferred.value,
    ua: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints || 0,
  }))
  const helpVisible = ref(false)

  /** 支持安装提示时弹出系统安装框；否则打开说明弹窗 */
  async function install(): Promise<void> {
    const ev = deferred.value
    if (mode.value === 'prompt' && ev) {
      await ev.prompt()
      const { outcome } = await ev.userChoice
      // 提示事件只能用一次
      deferred.value = null
      if (outcome === 'accepted') installed.value = true
      return
    }
    helpVisible.value = true
  }

  return { mode, helpVisible, install }
}
