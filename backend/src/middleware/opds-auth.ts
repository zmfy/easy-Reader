import { Request, Response, NextFunction, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { getDb } from '../db';
import { verifyOpdsLogin } from '../services/opds-credentials';

const REALM = 'Basic realm="easyReader"';

function challenge(res: Response): void {
  res.setHeader('WWW-Authenticate', REALM);
  res.status(401).type('text/plain; charset=utf-8').send('需要 OPDS 用户名和密码');
}

/**
 * 每个 IP 15 分钟内最多 20 次密码错误（与登录相同）。
 * 阅读 App 常先不带认证头探测、收到 401 再带上密码，这类请求不计数。
 */
const opdsFailureLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skip: (req) => !req.headers.authorization,
  requestWasSuccessful: (_req, res) => res.statusCode !== 401,
  skipSuccessfulRequests: true,
  handler: (_req, res) => { res.status(429).type('text/plain; charset=utf-8').send('密码错误次数过多，请稍后再试'); },
});

function basicAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) { challenge(res); return; }
  const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
  const sep = decoded.indexOf(':');
  if (sep < 0) { challenge(res); return; }
  const user = verifyOpdsLogin(getDb(), decoded.slice(0, sep), decoded.slice(sep + 1));
  if (!user) { challenge(res); return; }
  req.user = { userId: user.userId, role: user.role, type: 'access' };
  next();
}

/** OPDS 书目源的认证：HTTP Basic，用户名 + OPDS 专用密码（不是登录密码） */
export const opdsAuth: RequestHandler[] = [opdsFailureLimiter, basicAuth];
