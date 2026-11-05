/**
 * TRUST_PROXY → Express 的 'trust proxy' 设置。
 * - 不设置 / false / 0：不信任代理（直接暴露端口时）
 * - 数字：信任的代理层数，经一层反向代理访问时填 1
 * - 其他：信任的代理地址，逗号分隔（如 loopback, 172.16.0.0/12）
 * true 会信任任意 X-Forwarded-For，客户端可伪造 IP 绕过限流，不建议使用
 */
export function parseTrustProxy(value?: string): boolean | number | string {
  const v = (value ?? '').trim();
  if (!v || v === 'false') return false;
  if (v === 'true') return true;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}
