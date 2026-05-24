import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import { getDb } from './db';
import authRoutes from './routes/auth';
import libraryRoutes from './routes/library';
import manualOverridesRoutes from './routes/manual-overrides';
import shelfRoutes from './routes/shelf';
import readerRoutes from './routes/reader';
import settingsRoutes from './routes/settings';

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');

// Initialize DB
getDb();

// Serve downloaded book covers
const coversDir = path.join(DATA_DIR, 'covers');
if (!fs.existsSync(coversDir)) fs.mkdirSync(coversDir, { recursive: true });
app.use('/covers', express.static(coversDir));

// Security middleware
app.use(helmet({ contentSecurityPolicy: false }));
const frontendUrl = process.env.FRONTEND_URL;
if (frontendUrl) {
  app.use(cors({ origin: frontendUrl, credentials: true }));
}

// Serve frontend static files (when built into the same container)
const publicDir = path.join(__dirname, '../public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
}

// Rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { success: false, code: 'RATE_LIMIT', message: '请求过于频繁，请稍后再试' },
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/library/manual-overrides', manualOverridesRoutes);
app.use('/api/library', libraryRoutes);
app.use('/api/shelf', shelfRoutes);
app.use('/api/reader', readerRoutes);
app.use('/api/settings', settingsRoutes);

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
});

export default app;
