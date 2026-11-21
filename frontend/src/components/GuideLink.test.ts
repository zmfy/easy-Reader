// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import GuideLink from './GuideLink.vue'
import { GUIDES, guideUrl } from '@/utils/links'

describe('GuideLink', () => {
  it('shows the guide title and opens the guide page in a new tab', () => {
    const w = mount(GuideLink, { props: { guide: GUIDES.remoteAccess } })
    expect(w.text()).toContain('详细设置方法参考：')
    const link = w.find('a')
    expect(link.text()).toContain('《外网访问 NAS 书库：DDNS + HTTPS 证书配置教程》')
    expect(link.attributes('href')).toBe('https://easyreader.ucool.uk/guides/remote-access-https')
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toBe('noopener noreferrer')
  })

  it('links to a section when an anchor is given, and accepts a custom label', () => {
    const w = mount(GuideLink, { props: { guide: GUIDES.remoteAccess, anchor: '常见报错', label: '排查方法参考' } })
    expect(w.text()).toContain('排查方法参考：')
    expect(w.find('a').attributes('href')).toBe('https://easyreader.ucool.uk/guides/remote-access-https#常见报错')
  })

  it('can hide the slow-site note (when several links are listed together)', () => {
    const w = mount(GuideLink, { props: { guide: GUIDES.aiProviders, note: false } })
    expect(w.text()).not.toContain('官网使用免费云服务器')
  })

  it('notes that the site may be slow at peak hours', () => {
    const w = mount(GuideLink, { props: { guide: GUIDES.aiProviders } })
    expect(w.text()).toContain('官网使用免费云服务器，高峰时段访问可能较慢，建议错开高峰时段访问')
  })

  it('guideUrl builds guide URLs', () => {
    expect(guideUrl(GUIDES.opdsSetup)).toBe('https://easyreader.ucool.uk/guides/opds-setup')
    expect(guideUrl(GUIDES.readerApps)).toBe('https://easyreader.ucool.uk/guides/reader-apps')
    expect(guideUrl(GUIDES.dockerCompose, '第一步-准备两个目录')).toBe('https://easyreader.ucool.uk/guides/docker-compose#第一步-准备两个目录')
    expect(guideUrl(GUIDES.pwaSetup)).toBe('https://easyreader.ucool.uk/guides/pwa-setup')
  })
})
