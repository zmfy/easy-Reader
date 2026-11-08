// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'

const needRefresh = ref(false)
const updateServiceWorker = vi.fn()
vi.mock('virtual:pwa-register/vue', () => ({
  useRegisterSW: () => ({ needRefresh, offlineReady: ref(false), updateServiceWorker }),
}))
import PwaUpdatePrompt from './PwaUpdatePrompt.vue'

describe('PwaUpdatePrompt', () => {
  it('shows the refresh prompt only when an update is waiting and applies it on click', async () => {
    const w = mount(PwaUpdatePrompt)
    expect(w.text()).not.toContain('有新版本，点击刷新')
    needRefresh.value = true
    await nextTick()
    expect(w.text()).toContain('有新版本，点击刷新')
    await w.find('button').trigger('click')
    expect(updateServiceWorker).toHaveBeenCalledWith(true)
    w.unmount()
  })
})
