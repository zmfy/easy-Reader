import { Request, Response, NextFunction, RequestHandler } from 'express';
import net from 'net';
import { getDb } from '../db';
import { verifyOpdsLogin } from '../services/opds-credentials';

const REALM = 'Basic realm="easyReader"';

function challenge(res: Response): void {
  res.setHeader('WWW-Authenticate', REALM);
  res.status(401).type('text/plain; charset=utf-8').send('需要 OPDS 用户名和密码');
}

/**
 * 每个来源 15 分钟内最多 20 次密码错误（与登录相同）。只在认证真的失败时计数：
 * 阅读 App 先不带认证头探测、认证通过后下载被中断，都不算失败。超限后直接 429，不再验密码。
 */
export class FailureCounter {
  private entries = new Map<string, { count: number; resetAt: number }>();

  constructor(private opts: { limit: number; windowMs: number; maxKeys: number }) {}

  private locked(e: { count: number; resetAt: number } | undefined, now: number): boolean {
    return !!e && e.resetAt > now && e.count >= this.opts.limit;
  }

  isLockedOut(key: string, now: number): boolean {
    const e = this.entries.get(key);
    if (e && e.resetAt <= now) this.entries.delete(key);
    if (this.locked(this.entries.get(key), now)) return true;
    // 记录已满且清理不出空位（全是锁定中的来源）：新来源一律按锁定处理，不让人靠换地址冲掉锁定
    if (!this.entries.has(key) && this.entries.size >= this.opts.maxKeys) {
      this.evict(now);
      return this.entries.size >= this.opts.maxKeys;
    }
    return false;
  }

  record(key: string, now: number): void {
    const e = this.entries.get(key);
    if (!e || e.resetAt <= now) this.entries.set(key, { count: 1, resetAt: now + this.opts.windowMs });
    else e.count += 1;
    if (this.entries.size > this.opts.maxKeys) this.evict(now);
  }

  /** 先清过期记录，仍超上限就从最早的开始淘汰，但不淘汰仍在锁定中的 */
  private evict(now: number): void {
    for (const [k, v] of this.entries) if (v.resetAt <= now) this.entries.delete(k);
    for (const [k, v] of this.entries) {
      if (this.entries.size <= this.opts.maxKeys) break;
      if (!this.locked(v, now)) this.entries.delete(k);
    }
  }
}

const failures = new FailureCounter({ limit: 20, windowMs: 15 * 60 * 1000, maxKeys: 10000 });

function expandIPv6(ip: string): number[] | null {
  let addr = ip.split('%')[0];
  // 末尾是点分 IPv4（如 ::ffff:1.2.3.4）时换成两组十六进制
  const v4 = addr.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number);
    addr = addr.slice(0, -v4[0].length) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16);
  }
  const [head, tail] = addr.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = addr.includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h;
  if (groups.length !== 8) return null;
  return groups.map(g => parseInt(g || '0', 16));
}

const ipv4Of = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/**
 * 计数键：IPv4 按地址；普通 IPv6 按 /64 网段（一台设备能随意换同网段内的地址）。
 * 内嵌 IPv4 的 IPv6（映射、NAT64、兼容地址、6to4）按其中的 IPv4 计；Teredo 按完整地址计——
 * 这些前缀下大量不同用户会落在同一个 /64，归并会让一个人输错就锁住所有人。
 */
export function failureKeyForIp(raw: string): string {
  if (!net.isIPv6(raw)) return raw;
  const g = expandIPv6(raw);
  if (!g) return raw;
  const zero = (from: number, to: number) => g.slice(from, to).every(x => x === 0);
  if (zero(0, 5) && g[5] === 0xffff) return ipv4Of(g[6], g[7]);                  // ::ffff:0:0/96
  if (g[0] === 0x64 && g[1] === 0xff9b && zero(2, 6)) return ipv4Of(g[6], g[7]);  // 64:ff9b::/96（NAT64）
  if (zero(0, 6)) return ipv4Of(g[6], g[7]);                                       // ::/96（IPv4 兼容）
  if (g[0] === 0x2002) return ipv4Of(g[1], g[2]);                                  // 2002::/16（6to4）
  if (g[0] === 0x2001 && g[1] === 0) return g.map(x => x.toString(16)).join(':');  // 2001::/32（Teredo）
  return g.slice(0, 4).map(x => x.toString(16)).join(':') + '::/64';
}

function failureKey(req: Request): string {
  return failureKeyForIp(req.ip || req.socket.remoteAddress || 'unknown');
}

function basicAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || '';
  // 不带认证头：客户端在探测，要求认证即可，不计数
  if (!header) { challenge(res); return; }
  const key = failureKey(req);
  const now = Date.now();
  if (failures.isLockedOut(key, now)) {
    res.status(429).type('text/plain; charset=utf-8').send('密码错误次数过多，请稍后再试');
    return;
  }
  const fail = () => { failures.record(key, now); challenge(res); };
  if (!header.startsWith('Basic ')) { fail(); return; }
  const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
  const sep = decoded.indexOf(':');
  if (sep < 0) { fail(); return; }
  const user = verifyOpdsLogin(getDb(), decoded.slice(0, sep), decoded.slice(sep + 1));
  if (!user) { fail(); return; }
  req.user = { userId: user.userId, role: user.role, type: 'access' };
  next();
}

/** OPDS 书目源的认证：HTTP Basic，用户名 + OPDS 专用密码（不是登录密码） */
export const opdsAuth: RequestHandler[] = [basicAuth];
