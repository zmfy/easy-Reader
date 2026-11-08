// Service Worker（Workbox）配置：只预缓存应用外壳；接口、封面、清单、健康检查一律走网络，
// pdf.js 的字体映射等大资源不预缓存（第二期离线阅读再考虑）
export const workboxOptions = {
  globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
  globIgnores: ['pdfjs/**'],
  // 离线时打开任意页面回退到缓存的 index.html，由页面显示「没有网络连接」
  navigateFallback: 'index.html',
  navigateFallbackDenylist: [/^\/api(\/|$)/, /^\/covers(\/|$)/, /^\/manifest\.webmanifest$/, /^\/health$/],
  cleanupOutdatedCaches: true,
}
