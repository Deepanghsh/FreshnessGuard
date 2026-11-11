import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';
import apiRouter from './routes/api';

const app = express();

// ─── CORS ─────────────────────────────────────────────────────────────────────
const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(',').map(s => s.trim());
app.use(cors({
  origin: origins,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-FreshnessGuard-Key'],
}));

// ─── Body / logging ───────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ─── Rate limiting ────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '60000'),
  max:      parseInt(process.env.RATE_LIMIT_MAX ?? '100'),
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests, slow down.' },
});
app.use('/api', limiter);

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api', apiRouter);
app.get('/healthz', (req, res) => {
  res.json({
    status: 'ok',
    service: 'freshnessguard',
    version: '1.0.0',
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
  });
});

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[FreshnessGuard] Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// ─── MongoDB + server startup ─────────────────────────────────────────────────
const PORT       = parseInt(process.env.PORT ?? '3001');
const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/freshnessguard';

async function start(): Promise<void> {
  try {
    await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    console.log('[FreshnessGuard] MongoDB connected:', MONGODB_URI.replace(/\/\/.*@/, '//<credentials>@'));

    const server = app.listen(PORT, () => {
      console.log(`[FreshnessGuard] Server listening on http://localhost:${PORT}`);
      console.log(`[FreshnessGuard] Dashboard: http://localhost:5173`);
    });

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      console.log('[FreshnessGuard] SIGTERM received — shutting down gracefully');
      server.close(async () => {
        await mongoose.disconnect();
        process.exit(0);
      });
    });
    process.on('SIGINT', async () => {
      await mongoose.disconnect();
      process.exit(0);
    });
  } catch (err) {
    console.error('[FreshnessGuard] Startup error:', err);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  start();
}
export { app };

