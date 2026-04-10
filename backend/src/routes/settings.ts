import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { successResponse, errorResponse } from '../utils/response';
import { aiPlugins } from '../ai/ai-manager';
import { User } from '../types';
import nodemailer from 'nodemailer';

const router = Router();

// GET /api/settings/public — no auth required, returns public-facing site info
router.get('/public', (req: Request, res: Response) => {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'site_name'").get() as { value: string } | undefined;
  successResponse(res, { site_name: row?.value || '' });
});

// GET /api/settings
router.get('/', authMiddleware, (req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>;
  const settings: Record<string, string> = {};
  for (const row of rows) {
    if (row.key === 'smtp_pass') {
      settings[row.key] = row.value ? '****' : '';
    } else if (row.key.toLowerCase().includes('apikey') || row.key.toLowerCase().includes('api_key')) {
      settings[row.key] = row.value.length > 8 ? row.value.slice(0, 4) + '****' + row.value.slice(-4) : '****';
    } else {
      settings[row.key] = row.value;
    }
  }
  successResponse(res, settings);
});

// PUT /api/settings
router.put('/', authMiddleware, adminMiddleware, (req: Request, res: Response) => {
  const schema = z.record(z.string().max(200));
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { errorResponse(res, 422, 'VALIDATION_ERROR', '参数校验失败'); return; }

  const db = getDb();
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');

  for (const [key, value] of Object.entries(parsed.data)) {
    // Don't overwrite smtp_pass with masked placeholder
    if (key === 'smtp_pass' && (value === '****' || value === '')) continue;
    upsert.run(key, value);
  }
  successResponse(res, null, '设置已更新');
});

// GET /api/settings/ai-plugins
router.get('/ai-plugins', authMiddleware, (_req: Request, res: Response) => {
  const plugins = aiPlugins.map(p => ({ name: p.name, label: p.label, fields: p.fields, placeholders: p.placeholders || {} }));
  successResponse(res, plugins);
});

// GET /api/settings/reader-plugins
router.get('/reader-plugins', authMiddleware, (_req: Request, res: Response) => {
  successResponse(res, [
    { format: 'txt', label: 'TXT 纯文本', description: '支持 UTF-8/GBK 编码的纯文本小说' },
    { format: 'epub', label: 'EPUB 电子书', description: '支持 EPUB 2/3 格式' },
    { format: 'pdf', label: 'PDF 文档', description: '支持 PDF 文档格式' },
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
router.put('/reader-prefs', authMiddleware, (req: Request, res: Response) => {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
    `reader_prefs_${req.user!.userId}`,
    JSON.stringify(req.body)
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
  const code = Math.random().toString(36).slice(2, 10).toUpperCase();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO invite_codes (code, created_by, expires_at) VALUES (?, ?, ?)').run(code, req.user!.userId, expiresAt);
  successResponse(res, { code, expiresAt }, '邀请码已生成', 201);
});

// POST /api/settings/users/invite/send-email
router.post('/users/invite/send-email', authMiddleware, adminMiddleware, async (req: Request, res: Response) => {
  const schema = z.object({
    email: z.string().email(),
    code: z.string(),
    inviteUrl: z.string(),
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

    const siteName = cfg.site_name || '夜航书房';

    await transporter.sendMail({
      from: cfg.smtp_from || cfg.smtp_user,
      to: parsed.data.email,
      subject: `您收到了来自 ${siteName} 的邀请`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
          <h2 style="color:#1a1a2e;">您好！</h2>
          <p>您收到了一份来自 <strong>${siteName}</strong> 的邀请，点击下方按钮完成注册：</p>
          <p style="margin:24px 0;">
            <a href="${parsed.data.inviteUrl}"
               style="background:#7c5cff;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-size:15px;">
              立即注册
            </a>
          </p>
          <p style="color:#666;font-size:13px;">或复制以下链接到浏览器：</p>
          <p style="color:#444;word-break:break-all;font-size:13px;">${parsed.data.inviteUrl}</p>
          <p style="margin-top:16px;">邀请码：<strong style="letter-spacing:2px;">${parsed.data.code}</strong></p>
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

export default router;
