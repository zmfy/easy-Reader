import rateLimit from 'express-rate-limit';

const WINDOW_MS = 15 * 60 * 1000;
const message = { success: false, code: 'RATE_LIMIT', message: '请求过于频繁，请稍后再试' };

/**
 * 登录、改密码：每个 IP 15 分钟内最多 20 次失败（成功的请求不计），防止暴力猜密码。
 * 经反向代理访问时需设置 TRUST_PROXY，否则所有人共用代理的 IP、互相占用额度。
 */
export const credentialLimiter = rateLimit({ windowMs: WINDOW_MS, limit: 20, skipSuccessfulRequests: true, message });

/** 注册：成功的也计数（开放注册时防止批量建号），每个 IP 15 分钟内最多 20 次 */
export const registerLimiter = rateLimit({ windowMs: WINDOW_MS, limit: 20, message });

/** 令牌续期：客户端会定期调用，额度放宽，只防滥用 */
export const refreshLimiter = rateLimit({ windowMs: WINDOW_MS, limit: 120, message });
