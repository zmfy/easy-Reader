// 对外链接：问题反馈渠道
// 官网留言板：不用注册，适合大多数用户
export const FEEDBACK_URL = 'https://easyreader.ucool.uk/bbs'
// GitHub Issue：选择模板（问题报告 / 功能建议）后提交
export const ISSUE_URL = 'https://github.com/zmfy/easy-Reader/issues/new/choose'
// 官网
export const SITE_URL = 'https://easyreader.ucool.uk'

// 官网使用指南：设置页等处「详细设置方法参考」的链接
// 标题与官网教程一致；锚点是官网按章节标题生成的 id（官网改章节标题时要同步修改）
export interface Guide {
  slug: string
  title: string
}

export const GUIDES_URL = `${SITE_URL}/guides`

export const GUIDES = {
  remoteAccess: { slug: 'remote-access-https', title: '外网访问 NAS 书库：DDNS + HTTPS 证书配置教程' },
  pwaSetup: { slug: 'pwa-setup', title: '手机看 NAS 上的小说：从域名、证书到装到桌面的完整流程' },
  pwaInstall: { slug: 'pwa-install', title: '把 NAS 书库装到手机桌面（iPhone / 安卓）' },
  aiProviders: { slug: 'ai-providers', title: '简单书房的 AI 怎么选：DeepSeek 与 MiniMax 的设置、收费和省钱用法' },
  dockerCompose: { slug: 'docker-compose', title: 'Docker Compose 部署 NAS 小说阅读器' },
  opdsSetup: { slug: 'opds-setup', title: '简单书房 OPDS 设置教程：开通密码、手机平板连接书库、各 App 添加步骤' },
  readerApps: { slug: 'reader-apps', title: 'NAS 书库配什么看书软件：iOS / 安卓 / Windows / Mac / 墨水屏阅读 App 推荐' },
} satisfies Record<string, Guide>

export function guideUrl(guide: Guide, anchor?: string): string {
  return `${GUIDES_URL}/${guide.slug}${anchor ? `#${anchor}` : ''}`
}

// 官网放在免费云服务器上，高峰时段可能打开较慢
export const SITE_SLOW_NOTE = '官网使用免费云服务器，高峰时段访问可能较慢，建议错开高峰时段访问'
