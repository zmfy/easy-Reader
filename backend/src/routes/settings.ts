import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getDb } from '../db';
import { strongPasswordSchema } from '../utils/password-policy';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { successResponse, errorResponse } from '../utils/response';
import { aiPlugins, isAiConfigured, getActivePluginName, getAiConfigWarning } from '../ai/ai-manager';
import { getTtsConfig } from '../services/tts';
import { User } from '../types';
import nodemailer from 'nodemailer';
import { deleteUserData } from '../services/relation-cleanup';
import crypto from 'crypto';
import { getUpdateStatus, checkForUpdates, readLocalChangelog, applyUpdateCheckerSetting } from '../services/update-check';

const router = Router();

// 需要掩码的密钥类设置：GET 返回掩码、PUT 遇到掩码值时跳过，两处共用同一判断
function isApiKeySetting(key: string): boolean {
  const k = key.toLowerCase();
  return k.includes('apikey') || k.includes('api_key');
}

// 邮件 HTML 中的文本与属性值转义
function escapeHtmlAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const INVITE_CODE_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// 8 位大写字母数字邀请码，使用密码学安全随机数
function generateInviteCode(): string {
  let code = '';
  for (let i = 0; i < 8; i++) code += INVITE_CODE_ALPHABET[crypto.randomInt(INVITE_CODE_ALPHABET.length)];
  return code;
}

// GET /api/settings/public — no auth required, returns public-facing site info
router.get('/public', (req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM settings WHERE key IN ('site_name', 'site_subtitle', 'site_theme')").all() as Array<{ key: string; value: string }>;
  const data: Record<string, string> = {};
  for (const r of rows) data[r.key] = r.value;
  successResponse(res, { site_name: data['site_name'] || '', site_subtitle: data['site_subtitle'] || '', site_theme: data['site_theme'] || 'indigo' });
});

// GET /api/settings/update-status — 最近一次检查的结果（不联网）
router.get('/update-status', authMiddleware, adminMiddleware, (_req: Request, res: Response) => {
  successResponse(res, getUpdateStatus(getDb()));
});

// POST /api/settings/update-check — 立即检查更新；检查失败也返回 200，错误在状态的 error 里
// 系统提醒关闭（含 UPDATE_CHECK=off）时不联网，直接返回当前状态
router.post('/update-check', authMiddleware, adminMiddleware, async (_req: Request, res: Response) => {
  const db = getDb();
  const status = getUpdateStatus(db);
  if (!status.noticeEnabled) return successResponse(res, status);
  successResponse(res, await checkForUpdates(db));
});

// GET /api/settings/changelog — 本站 CHANGELOG 最近 5 个版本
router.get('/changelog', authMiddleware, adminMiddleware, (_req: Request, res: Response) => {
  const { releases, currentVersion, missing } = readLocalChangelog();
  successResponse(res, { currentVersion, missing, releases: releases.slice(0, 5) });
});

// GET /api/settings
router.get('/', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const db = getDb();
  // reader_prefs_* 是各用户的个人阅读设置，不属于系统设置
  const rows = db.prepare("SELECT key, value FROM settings WHERE key NOT LIKE 'reader\\_prefs\\_%' ESCAPE '\\'").all() as Array<{ key: string; value: string }>;
  const settings: Record<string, string> = {};
  for (const row of rows) {
    if (row.key === 'smtp_pass') {
      settings[row.key] = row.value ? '****' : '';
    } else if (isApiKeySetting(row.key)) {
      settings[row.key] = row.value.length > 8 ? row.value.slice(0, 4) + '****' + row.value.slice(-4) : '****';
    } else {
      settings[row.key] = row.value;
    }
  }
  successResponse(res, settings);
});

// PUT /api/settings
router.put('/', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const schema = z.record(z.string(), z.string().max(200));
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败'); return; }

  const db = getDb();
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

  for (const [key, value] of Object.entries(parsed.data)) {
    // Don't overwrite smtp_pass with masked placeholder
    if (key === 'smtp_pass' && (value === '****' || value === '')) continue;
    // Don't overwrite API keys with masked values (e.g. "sk-12****5678")
    if (isApiKeySetting(key) && value.includes('****')) continue;
    upsert.run(key, value);
  }
  // 「系统提醒」开关变化时启停后台更新检查
  if ('system_notice_enabled' in parsed.data) applyUpdateCheckerSetting(db);
  successResponse(res, null, '设置已更新');
});

// GET /api/settings/ai-plugins
router.get('/ai-plugins', authMiddleware, (_req: Request, res: Response) => {
  const plugins = aiPlugins.map(p => ({ name: p.name, label: p.label, fields: p.fields, placeholders: p.placeholders || {}, options: p.options || {} }));
  successResponse(res, plugins);
});

// GET /api/settings/ai-status — whether AI is usable (plugin selected + credential filled)
router.get('/ai-status', authMiddleware, (_req: Request, res: Response) => {
  const db = getDb();
  successResponse(res, { configured: isAiConfigured(db), active_plugin: getActivePluginName(db), tts_enabled: getTtsConfig(db).enabled, config_warning: getAiConfigWarning(db) });
});

// GET /api/settings/reader-plugins
router.get('/reader-plugins', authMiddleware, (_req: Request, res: Response) => {
  const db = getDb();
  // 未设置时默认逐页显示，与 reader 路由一致
  const pdfUsePlugin = (db.prepare("SELECT value FROM settings WHERE key = 'pdf_use_plugin'").get() as { value: string } | undefined)?.value !== 'false';
  successResponse(res, [
    { format: 'txt', label: 'TXT 纯文本', description: '支持 UTF-8/GBK 编码的纯文本小说' },
    { format: 'epub', label: 'EPUB 电子书', description: '支持 EPUB 2/3 格式' },
    { format: 'pdf', label: 'PDF 文档', description: '支持 PDF 文档格式', usePlugin: pdfUsePlugin },
    { format: 'umd', label: 'UMD 小说', description: '支持 UMD 格式中文电子书' },
  ]);
});

// GET /api/settings/reader-prefs  (per-user reader settings)
router.get('/reader-prefs', authMiddleware, (req: Request, res: Response) => {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(`reader_prefs_${req.user!.userId}`) as { value: string } | undefined;
  if (row) {
    try { successResponse(res, JSON.parse(row.value)); return; } catch { /* fall through */ }
  }
  successResponse(res, null);
});

// PUT /api/settings/reader-prefs
// 只接受扁平的简单值对象，限制字段数与总大小，防止任意大数据写入 settings 表
const readerPrefsSchema = z.record(z.string(), z.union([z.string().max(200), z.number(), z.boolean()]))
  .refine(v => Object.keys(v).length <= 30, '字段过多');
const READER_PREFS_MAX_BYTES = 4 * 1024;

router.put('/reader-prefs', authMiddleware, (req: Request, res: Response) => {
  const parsed = readerPrefsSchema.safeParse(req.body);
  const value = parsed.success ? JSON.stringify(parsed.data) : '';
  if (!parsed.success || Buffer.byteLength(value) > READER_PREFS_MAX_BYTES) {
    errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败');
    return;
  }
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
    `reader_prefs_${req.user!.userId}`,
    value
  );
  successResponse(res, null, '阅读设置已保存');
});

// GET /api/settings/users
router.get('/users', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const db = getDb();
  const users = db.prepare('SELECT id, username, role, created_at FROM users ORDER BY created_at DESC').all() as Omit<User, 'password_hash'>[];
  successResponse(res, users);
});

// POST /api/settings/users/invite
router.post('/users/invite', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const db = getDb();
  const code = generateInviteCode();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO invite_codes (code, created_by, expires_at) VALUES (?, ?, ?)').run(code, req.user!.userId, expiresAt);
  successResponse(res, { code, expiresAt }, '邀请码已生成', 201);
});

// POST /api/settings/users/invite/send-email
router.post('/users/invite/send-email', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  const schema = z.object({
    email: z.string().email(),
    code: z.string(),
    inviteUrl: z.string().url().refine(u => /^https?:\/\//i.test(u), '邀请链接必须是 http(s) 地址'),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败'); return; }

  const db = getDb();
  const rows = db.prepare(
    "SELECT key, value FROM settings WHERE key IN ('smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from', 'site_name')"
  ).all() as Array<{ key: string; value: string }>;
  const cfg: Record<string, string> = {};
  for (const row of rows) cfg[row.key] = row.value;

  if (!cfg.smtp_host) {
    errorResponse(res, 400, 'SMTP_NOT_CONFIGURED', 'SMTP 服务器未配置');
    return;
  }

  try {
    const port = parseInt(cfg.smtp_port || '587');
    const transporter = nodemailer.createTransport({
      host: cfg.smtp_host,
      port,
      secure: port === 465,
      auth: cfg.smtp_user ? { user: cfg.smtp_user, pass: cfg.smtp_pass } : undefined,
    });

    const siteName = cfg.site_name || '简单书房';
    const safeSiteName = escapeHtmlAttr(siteName);
    const safeUrl = escapeHtmlAttr(parsed.data.inviteUrl);
    const safeCode = escapeHtmlAttr(parsed.data.code);

    await transporter.sendMail({
      from: cfg.smtp_from || cfg.smtp_user,
      to: parsed.data.email,
      subject: `您收到了来自 ${siteName} 的邀请`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
          <h2 style="color:#1a1a2e;">您好！</h2>
          <p>您收到了一份来自 <strong>${safeSiteName}</strong> 的邀请，点击下方按钮完成注册：</p>
          <p style="margin:24px 0;">
            <a href="${safeUrl}"
               style="background:#7c5cff;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-size:15px;">
              立即注册
            </a>
          </p>
          <p style="color:#666;font-size:13px;">或复制以下链接到浏览器：</p>
          <p style="color:#444;word-break:break-all;font-size:13px;">${safeUrl}</p>
          <p style="margin-top:16px;">邀请码：<strong style="letter-spacing:2px;">${safeCode}</strong></p>
          <p style="color:#999;font-size:12px;margin-top:24px;">此邀请码 7 天内有效，仅限一人使用。</p>
        </div>
      `,
    });

    successResponse(res, null, '邀请邮件已发送');
  } catch (err) {
    errorResponse(res, 500, 'SMTP_ERROR', `发送失败：${(err as Error).message}`);
  }
});

// PUT /api/settings/users/:id/role
router.put('/users/:id/role', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const schema = z.object({ role: z.enum(['admin', 'user']) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败'); return; }

  const db = getDb();
  const result = db.prepare('UPDATE users SET role = ? WHERE id = ?').run(parsed.data.role, req.params.id);
  if (result.changes === 0) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '用户不存在'); return; }
  successResponse(res, null, '角色已更新');
});

// PUT /api/settings/users/:id/password
router.put('/users/:id/password', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const schema = z.object({ password: strongPasswordSchema });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    errorResponse(res, 422, 'VALIDATION_ERROR', parsed.error.issues[0]?.message || '密码格式不符合要求');
    return;
  }

  const db = getDb();
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '用户不存在'); return; }

  const hash = bcrypt.hashSync(parsed.data.password, 10);
  // 递增令牌版本：该用户此前签发的所有令牌立即失效（被盗号后重置密码可踢下线）
  db.prepare('UPDATE users SET password_hash = ?, token_version = COALESCE(token_version, 0) + 1 WHERE id = ?').run(hash, req.params.id);
  successResponse(res, null, '密码已修改');
});

// DELETE /api/settings/users/:id
router.delete('/users/:id', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const db = getDb();
  // Prevent self-deletion
  if (req.user!.userId === req.params.id) {
    errorResponse(res, 400, 'BUSINESS_CONFLICT', '不能删除自己的账号'); return;
  }
  const result = db.transaction(() => {
    const r = db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    // 同时清理该用户的书架、进度、书签与个人阅读设置
    if (r.changes > 0) deleteUserData(db, req.params.id);
    return r;
  })();
  if (result.changes === 0) { errorResponse(res, 404, 'RESOURCE_NOT_FOUND', '用户不存在'); return; }
  successResponse(res, null, '用户已删除');
});

export default router;
