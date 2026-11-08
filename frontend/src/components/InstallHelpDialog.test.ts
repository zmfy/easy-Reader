// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { mount, config, flushPromises } from '@vue/test-utils'
import InstallHelpDialog from './InstallHelpDialog.vue'

config.global.stubs = { ...config.global.stubs, teleport: true }

describe('InstallHelpDialog', () => {
  const open = async (mode: 'insecure' | 'ios' | 'menu' | 'unsupported') => {
    const w = mount(InstallHelpDialog, { props: { modelValue: false, mode } })
    await w.setProps({ modelValue: true })
    await flushPromises()
    return w
  }

  it('InstallHelpDialog shows the exact copy for each mode', async () => {
    const insecure = await open('insecure')
    expect(insecure.text()).toContain('需要通过 HTTPS 访问才能安装到桌面')
    const link = insecure.find('a')
    expect(link.text()).toBe('查看说明')
    expect(link.attributes('href')).toBe('https://easyreader.ucool.uk')
    expect((await open('ios')).text()).toContain('点底部的分享按钮 → 选择『添加到主屏幕』')
    expect((await open('menu')).text()).toContain('请在浏览器菜单中选择『安装应用』或『添加到主屏幕』')
    expect((await open('unsupported')).text()).toContain('当前浏览器不支持安装，请使用 Chrome、Edge 或 Safari')
  })
})
