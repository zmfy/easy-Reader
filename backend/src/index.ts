import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { getDb } from './db';
import authRoutes from './routes/auth';
import libraryRoutes from './routes/library';
import shelfRoutes from './routes/shelf';
import readerRoutes from './routes/reader';
import settingsRoutes from './routes/settings';

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize DB
getDb();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:8080',
  credentials: true,
}));

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
app.use('/api/library', libraryRoutes);
app.use('/api/shelf', shelfRoutes);
app.use('/api/reader', readerRoutes);
app.use('/api/settings', settingsRoutes);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ success: false, code: 'RESOURCE_NOT_FOUND', message: '接口不存在' });
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
