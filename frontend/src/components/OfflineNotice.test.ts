// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import OfflineNotice from './OfflineNotice.vue'
import { reportNetworkError, reportNetworkOk } from '@/utils/network-status'

describe('OfflineNotice', () => {
  it('shows the offline notice on offline and hides it on online', async () => {
    const w = mount(OfflineNotice)
    expect(w.text()).not.toContain('没有网络连接')
    window.dispatchEvent(new Event('offline'))
    await nextTick()
    expect(w.text()).toContain('没有网络连接')
    expect(w.find('button').text()).toContain('重试')
    window.dispatchEvent(new Event('online'))
    await nextTick()
    expect(w.text()).not.toContain('没有网络连接')
    w.unmount()
  })
  it('also shows when the server cannot be reached while the browser thinks it is online', async () => {
    const w = mount(OfflineNotice)
    reportNetworkError()
    await nextTick()
    expect(w.text()).toContain('没有网络连接')
    reportNetworkOk()
    await nextTick()
    expect(w.text()).not.toContain('没有网络连接')
    w.unmount()
  })
})
