import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';
import apiRouter from './routes/api';

const app = express();

// Disable x-powered-by header for information disclosure protection
app.disable('x-powered-by');

// ─── Security Headers Middleware ──────────────────────────────────────────────
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser requests (no origin header, e.g. curl, tests, server-to-server)
    if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      callback(null, true);
    } else {
      callback(new Error('Blocked by CORS policy'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-FreshnessGuard-Key'],
  credentials: true,
}));

// ─── Body / logging ───────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ─── Rate limiting ────────────────────────────────────────────────────────────
const isTest = process.env.NODE_ENV === 'test';

const globalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '60000', 10),
  max:      isTest ? 5000 : parseInt(process.env.RATE_LIMIT_MAX ?? '100', 10),
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many requests, slow down.' },
});
app.use('/api', globalLimiter);

const checkLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_CHECK_WINDOW_MS ?? '60000', 10),
  max:      isTest ? 5000 : parseInt(process.env.RATE_LIMIT_CHECK_MAX ?? '60', 10),
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Verification rate limit exceeded. Too many claims checked, please slow down.' },
});
app.use('/api/check', checkLimiter);

// ─── Authentication Boundary Middleware ───────────────────────────────────────
// Optional API key enforcement for mutating routes (POST /api/check, POST /api/verify/:id)
export const apiKeyAuth: express.RequestHandler = (req, res, next) => {
  const configuredKey = process.env.FRESHNESSGUARD_API_KEY?.trim();
  if (!configuredKey) {
    return next(); // Auth boundary disabled in dev/demo mode when no key configured
  }

  const authHeader = req.headers.authorization;
  const bearerKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  const customKey = (req.headers['x-freshnessguard-key'] as string | undefined)?.trim();
  const providedKey = bearerKey || customKey;

  if (!providedKey || providedKey !== configuredKey) {
    res.status(401).json({ error: 'Unauthorized: Invalid or missing API key' });
    return;
  }
  next();
};

app.post('/api/check', apiKeyAuth);
app.post('/api/verify/:id', apiKeyAuth);

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
  // Handle URI decoding errors (e.g. malformed percent-encoding like % or %%)
  if (err instanceof URIError) {
    res.status(400).json({ error: 'Invalid identifier format' });
    return;
  }
  // Handle Zod validation errors from any route
  if (err?.constructor?.name === 'ZodError' || (err as any)?._tag === 'ZodError' || (err as any)?.name === 'ZodError') {
    res.status(400).json({ error: 'Validation error', details: (err as any).errors });
    return;
  }
  // Handle CORS rejection
  if (err.message === 'Blocked by CORS policy') {
    res.status(403).json({ error: 'CORS forbidden: Origin not allowed' });
    return;
  }
  console.error('[FreshnessGuard] Unhandled error:', err.message);
  const isProd = process.env.NODE_ENV === 'production';
  res.status(500).json({
    error: 'Internal server error',
    ...(isProd ? {} : { message: err.message }),
  });
});

// ─── MongoDB + server startup ─────────────────────────────────────────────────
const PORT       = parseInt(process.env.PORT ?? '3001');
const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/freshnessguard';

async function start(): Promise<void> {
  try {
    try {
      await mongoose.connect(MONGODB_URI, {
        serverSelectionTimeoutMS: 10000,
        family: 4,
      });
      console.log('[FreshnessGuard] MongoDB connected:', MONGODB_URI.replace(/\/\/.*@/, '//<credentials>@'));
    } catch (dbErr) {
      console.warn('[FreshnessGuard] MongoDB connection unavailable:', (dbErr as Error).message);
      console.warn('[FreshnessGuard] Running in degraded mode with in-memory caching and fail-safe handling');
    }

    const server = app.listen(PORT, () => {
      console.log(`[FreshnessGuard] Server listening on http://localhost:${PORT}`);
      console.log(`[FreshnessGuard] Dashboard: http://localhost:5173`);
    });

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      console.log('[FreshnessGuard] SIGTERM received — shutting down gracefully');
      server.close(async () => {
        if (mongoose.connection.readyState === 1) {
          await mongoose.disconnect();
        }
        process.exit(0);
      });
    });
    process.on('SIGINT', async () => {
      if (mongoose.connection.readyState === 1) {
        await mongoose.disconnect();
      }
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

