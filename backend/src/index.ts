import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import { getDb } from './db';
import authRoutes from './routes/auth';
import libraryRoutes from './routes/library';
import manualOverridesRoutes from './routes/manual-overrides';
import scanBatchesRoutes from './routes/scan-batches';
import seriesRoutes from './routes/series';
import auditLogRoutes from './routes/audit-log';
import shelfRoutes from './routes/shelf';
import readerRoutes from './routes/reader';
import settingsRoutes from './routes/settings';
import studySummaryRoutes from './routes/study-summary';
import noticesRoutes from './routes/notices';
import { kickApplyWorker } from './services/ai-apply-job';
import { parseCorsOrigins } from './utils/cors-origins';
import { parseTrustProxy } from './utils/trust-proxy';
import { startUpdateChecker } from './services/update-check';
import { readApiDocs, renderApiDocsPage } from './utils/api-docs';
import { buildManifest } from './services/pwa';
import { certDir } from './services/https-cert';
import { startHttpsManager, isHttpsEnabled } from './services/https-server';

const app = express();
// 经反向代理（Nginx、群晖反代等）访问时，按 X-Forwarded-For 识别真实客户端 IP（限流按 IP 计数）
app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');

// Initialize DB
getDb();

// Serve downloaded book covers
const coversDir = path.join(DATA_DIR, 'covers');
if (!fs.existsSync(coversDir)) fs.mkdirSync(coversDir, { recursive: true });
// 只对外提供图片，避免目录中的其他文件被公开访问
app.use('/covers', (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!/\.(jpe?g|png|webp|gif|svg)$/i.test(req.path)) {
    res.status(404).end();
    return;
  }
  // 系统生成的默认封面是 SVG：禁止脚本与外部资源，即使被单独打开也无法执行
  if (/\.svg$/i.test(req.path)) {
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }
  next();
}, express.static(coversDir));

// Security middleware
// 不发 HSTS：它按主机名生效、不分端口，用户用 https://域名:8443 访问过后，http://域名:8080 会被浏览器强制改成 HTTPS 而打不开
app.use(helmet({ contentSecurityPolicy: false, hsts: false }));
// 网页版（FRONTEND_URL）与网页类第三方客户端（CORS_ORIGINS，逗号分隔）；原生 App 不受跨域限制
const corsOrigins = parseCorsOrigins(process.env.FRONTEND_URL, process.env.CORS_ORIGINS);
if (corsOrigins.length) {
  app.use(cors({ origin: corsOrigins, credentials: true }));
}

// PWA 清单：名称跟随网站名称，动态生成（不缓存，改名后浏览器可取到新名称）
app.get('/manifest.webmanifest', (_req: express.Request, res: express.Response) => {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = 'site_name'").get() as { value: string } | undefined;
  res.setHeader('Cache-Control', 'no-cache');
  res.type('application/manifest+json').send(JSON.stringify(buildManifest(row?.value || '')));
});

// Serve frontend static files (when built into the same container)
const publicDir = path.join(__dirname, '../public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
}

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Routes：/api/v1 是给第三方客户端的稳定版本，与网页版使用的 /api 是同一组路由
const api = express.Router();
api.use('/auth', authRoutes);
api.use('/library/manual-overrides', manualOverridesRoutes);
api.use('/library/scan-batches', scanBatchesRoutes);
api.use('/library/series', seriesRoutes);
api.use('/library/audit-log', auditLogRoutes);
api.use('/library', libraryRoutes);
api.use('/shelf', shelfRoutes);
api.use('/reader', readerRoutes);
api.use('/settings', settingsRoutes);
api.use('/study', studySummaryRoutes);
api.use('/notices', noticesRoutes);

// API 文档（docs/api.md）：/api/docs 网页查看，/api/docs.md 原文
api.get('/docs.md', (_req: express.Request, res: express.Response) => {
  const md = readApiDocs();
  if (md === null) { res.status(404).json({ success: false, code: 'RESOURCE_NOT_FOUND', message: '文档不存在' }); return; }
  res.type('text/markdown; charset=utf-8').send(md);
});
api.get('/docs', (_req: express.Request, res: express.Response) => {
  const md = readApiDocs();
  if (md === null) { res.status(404).json({ success: false, code: 'RESOURCE_NOT_FOUND', message: '文档不存在' }); return; }
  res.type('html').send(renderApiDocsPage(md));
});

app.use('/api/v1', api);
app.use('/api', api);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API 404 handler
app.use('/api/*', (_req: express.Request, res: express.Response) => {
  res.status(404).json({ success: false, code: 'RESOURCE_NOT_FOUND', message: '接口不存在' });
});

// SPA catch-all: serve index.html for all non-API routes
app.get('*', (_req: express.Request, res: express.Response) => {
  const indexPath = path.join(__dirname, '../public/index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Not found');
  }
});

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ success: false, code: 'INTERNAL_ERROR', message: '服务器内部错误' });
});

app.listen(PORT, () => {
  console.log(`Novel Reader Backend running on port ${PORT}`);
  if (process.env.NODE_ENV !== 'test' && !process.env.JEST_WORKER_ID) {
    startUpdateChecker();
    kickApplyWorker();   // 接着跑重启前没跑完的后台采纳任务
    // 使用自己的证书：设置页「启用 HTTPS」打开且 DATA_DIR/certs 里有可用的 fullchain.pem + privkey.pem 时，在 HTTPS_PORT 上提供 HTTPS
    startHttpsManager(app, { dir: certDir(DATA_DIR), port: Number(process.env.HTTPS_PORT) || 3443, isEnabled: () => isHttpsEnabled(getDb()) });
  }
});

export default app;
