import { Request, Response, NextFunction, RequestHandler } from 'express';
import { getDb } from '../db';
import { verifyOpdsLogin } from '../services/opds-credentials';

const REALM = 'Basic realm="easyReader"';

function challenge(res: Response): void {
  res.setHeader('WWW-Authenticate', REALM);
  res.status(401).type('text/plain; charset=utf-8').send('需要 OPDS 用户名和密码');
}

/**
 * 每个 IP 15 分钟内最多 20 次密码错误（与登录相同）。只在认证真的失败时计数：
 * 阅读 App 先不带认证头探测、认证通过后下载被中断，都不算失败。超限后直接 429，不再验密码。
 */
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const FAILURE_LIMIT = 20;
const failures = new Map<string, { count: number; resetAt: number }>();

function failureKey(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function isLockedOut(key: string, now: number): boolean {
  const f = failures.get(key);
  if (!f) return false;
  if (f.resetAt <= now) { failures.delete(key); return false; }
  return f.count >= FAILURE_LIMIT;
}

function recordFailure(key: string, now: number): void {
  const f = failures.get(key);
  if (!f || f.resetAt <= now) failures.set(key, { count: 1, resetAt: now + FAILURE_WINDOW_MS });
  else f.count += 1;
  // 防止大量不同 IP 撑大内存：顺手清掉过期记录
  if (failures.size > 10000) for (const [k, v] of failures) if (v.resetAt <= now) failures.delete(k);
}

function basicAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || '';
  // 不带认证头：客户端在探测，要求认证即可，不计数
  if (!header) { challenge(res); return; }
  const key = failureKey(req);
  const now = Date.now();
  if (isLockedOut(key, now)) {
    res.status(429).type('text/plain; charset=utf-8').send('密码错误次数过多，请稍后再试');
    return;
  }
  const fail = () => { recordFailure(key, now); challenge(res); };
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
