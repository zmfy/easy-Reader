/**
 * 允许跨域访问的来源：FRONTEND_URL（网页版）加上 CORS_ORIGINS（逗号分隔，供网页类第三方客户端使用）。
 * 原生 App 不受浏览器跨域限制，不需要配置。
 */
export function parseCorsOrigins(frontendUrl?: string, corsOrigins?: string): string[] {
  const list = [frontendUrl ?? '', ...(corsOrigins ?? '').split(',')]
    .map(s => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return [...new Set(list)];
}
