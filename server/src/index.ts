import path from 'path';
import dotenv from 'dotenv';

// ─── Environment Configuration Loading ────────────────────────────────────────
// Load environment variables with explicit directory resolutions (server/.env and root .env)
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), 'server/.env') });
dotenv.config(); // fallback

import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';
import apiRouter from './routes/api';
import authRouter from './routes/auth';

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
      return;
    }
    // Allow localhost and 127.0.0.1 on any dev port when localhost is configured in allowedOrigins or in dev
    const isLocalhost = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    if (isLocalhost && (process.env.NODE_ENV !== 'production' || allowedOrigins.some(o => o.includes('localhost') || o.includes('127.0.0.1')))) {
      callback(null, true);
      return;
    }
    callback(new Error('Blocked by CORS policy'));
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

// ─── Authentication Rate Limiting ─────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max:      isTest ? 5000 : 20,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { error: 'Too many authentication requests, please slow down.' },
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

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
app.post('/api/ask', apiKeyAuth);
app.post('/api/verify/:id', apiKeyAuth);

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api', apiRouter);
app.get('/healthz', async (req, res) => {
  const isConnected = mongoose.connection.readyState === 1;
  const tavilyKey = process.env.TAVILY_API_KEY?.trim();
  const tavilyStatus = tavilyKey
    ? (tavilyKey.startsWith('tvly-') && tavilyKey.length >= 20 ? 'configured' : 'misconfigured')
    : 'not_configured';

  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  const geminiStatus = geminiKey ? (geminiKey.length > 10 ? 'configured' : 'misconfigured') : 'not_configured';

  // Actively probe Bifrost Gateway if reachable
  let bifrostStatus = 'not_configured';
  const bifrostUrl = process.env.BIFROST_URL?.trim() || 'http://localhost:8080';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1200);
    const resp = await fetch(bifrostUrl, { signal: controller.signal });
    clearTimeout(timeout);
    bifrostStatus = resp.ok || resp.status < 500 ? 'connected' : 'unhealthy';
  } catch (_e) {
    bifrostStatus = 'unreachable';
  }

  res.json({
    status: 'ok',
    service: 'freshnessguard',
    version: '1.0.0',
    mongodb: isConnected ? 'connected' : 'disconnected',
    storageMode: isConnected ? 'mongodb_atlas' : 'in_memory_l1_degraded',
    tavily: tavilyStatus,
    bifrost: bifrostStatus,
    gemini: geminiStatus,
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
const PORT       = parseInt(process.env.PORT ?? '5000');
const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/freshnessguard';

async function start(): Promise<void> {
  try {
    try {
      await mongoose.connect(MONGODB_URI, {
        serverSelectionTimeoutMS: 10000,
        family: 4,
      });
      // Perform database ping healthcheck before declaring online
      await mongoose.connection.db?.admin().ping();
      const sanitizedUri = MONGODB_URI.replace(/\/\/[^:]+:[^@]+@/, '//***:***@');
      console.log('[FreshnessGuard] MongoDB connected & verified:', sanitizedUri);
    } catch (dbErr) {
      console.warn('[FreshnessGuard] MongoDB connection unavailable:', (dbErr as Error).message);
      console.warn('[FreshnessGuard] Running in degraded mode with in-memory caching and fail-safe handling');
    }

    const server = app.listen(PORT, '0.0.0.0', () => {
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

