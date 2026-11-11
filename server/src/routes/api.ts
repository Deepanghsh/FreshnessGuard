import { Router, Request, Response as ExpressResponse, NextFunction } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import mongoose from 'mongoose';
import { Response as ResponseModel } from '../models/Response';
import { extractClaims } from '../services/extraction';
import { triageClaims } from '../services/triage';
import { verifyClaim } from '../services/verification';
import { scoreClaim, scoreResponse, buildCorrectedAnswer } from '../services/scoring';
import { getCached, saveToCache, hashText, getCacheStats } from '../services/cache';
import type { Claim, ScoredClaim } from '../types/index';

const router = Router();

// ─── SSE registry ─────────────────────────────────────────────────────────────
const sseClients = new Set<ExpressResponse>();

export function broadcastSSE(eventType: string, data: unknown): void {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      (client as unknown as { write(s: string): void }).write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

// ─── Latency tracking (p95) ───────────────────────────────────────────────────
const latencies: number[] = [];

function recordLatency(ms: number) {
  latencies.push(ms);
  if (latencies.length > 2000) latencies.shift();
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * (p / 100))] ?? 0;
}

// ─── Validation schemas ───────────────────────────────────────────────────────
const CheckBodySchema = z.object({
  text:      z.string().min(1).max(60_000),
  requestId: z.string().optional(),
  model:     z.string().optional(),
  mode:      z.enum(['inline', 'async', 'basic', 'bypass']).optional(),
  provider:  z.string().optional(),
});

const PaginationSchema = z.object({
  page:    z.coerce.number().int().positive().default(1),
  limit:   z.coerce.number().int().min(1).max(100).default(20),
  verdict: z.enum(['current', 'stale', 'unverified']).optional(),
  model:   z.string().optional(),
});

// ─── POST /api/check ──────────────────────────────────────────────────────────
router.post('/check', async (req: Request, res: ExpressResponse, next: NextFunction) => {
  const start = Date.now();

  try {
    const body = CheckBodySchema.parse(req.body);
    const textHash = hashText(body.text);

    // 0. Bypass check: Internal recursion protection or explicit bypass mode
    const isBypassHeader = req.headers['x-freshnessguard-bypass'] === 'true' || req.headers['x-bf-eh-freshnessguard-bypass'] === 'true';
    if (body.mode === 'bypass' || isBypassHeader) {
      const processingMs = Date.now() - start;
      return res.status(200).json({
        requestId: textHash,
        model: body.model ?? 'unknown',
        provider: body.provider,
        originalText: body.text,
        claims: [],
        overallScore: 1.0,
        staleCount: 0,
        totalClaims: 0,
        fromCache: false,
        processingMs,
        mode: 'bypass',
        fromLLM: false,
      });
    }

    // 1. Cache check
    const cached = await getCached(textHash);
    if (cached) {
      const doc = {
        ...cached,
        fromCache: true,
        cacheHitAt: new Date(),
      };
      broadcastSSE('cache_hit', { requestId: textHash });
      res.json(doc);
      return;
    }

    // 2. Extraction
    const { claims: rawClaims, fromLLM } = await extractClaims(body.text);

    // 3. Triage
    const { toVerify, skipped } = triageClaims(rawClaims);
    const mode = body.mode ?? (process.env.FRESHNESSGUARD_MODE as 'inline' | 'async' | 'basic') ?? (process.env.STALEGUARD_MODE as 'inline' | 'async') ?? 'inline';

    // 4A. Basic mode: local regex scoring only, zero network calls
    if (mode === 'basic') {
      const basicClaims: ScoredClaim[] = rawClaims.map(c => {
        const isRisky = c.likelihood >= 0.75;
        return {
          ...c,
          verdict: isRisky ? ('stale' as const) : ('current' as const),
          score: isRisky ? 0.35 : 0.85,
          sources: [],
          checkedAt: new Date(),
        };
      });
      const staleCount = basicClaims.filter(c => c.verdict === 'stale').length;
      const overallScore = scoreResponse(basicClaims);
      const processingMs = Date.now() - start;
      recordLatency(processingMs);

      const doc = new ResponseModel({
        requestId: textHash,
        model: body.model ?? 'unknown',
        provider: body.provider,
        originalText: body.text,
        claims: basicClaims,
        overallScore,
        staleCount,
        totalClaims: basicClaims.length,
        fromCache: false,
        processingMs,
        mode: 'basic',
        fromLLM: false,
      });
      await doc.save();
      return res.status(201).json(doc);
    }

    // 4B. Async mode: return immediately with unverified status (202), verify in background
    if (mode === 'async') {
      const initialClaims: ScoredClaim[] = rawClaims.map(c => ({
        ...c,
        verdict: 'unverified' as const,
        score: 0.5,
        sources: [],
      }));
      const doc = new ResponseModel({
        requestId: textHash,
        model: body.model ?? 'unknown',
        provider: body.provider,
        originalText: body.text,
        claims: initialClaims,
        overallScore: 0.5,
        staleCount: 0,
        totalClaims: initialClaims.length,
        fromCache: false,
        processingMs: Date.now() - start,
        mode: 'async',
        fromLLM,
      });
      await doc.save();

      // Return initial accepted status immediately
      res.status(202).json(doc);

      // Complete verification asynchronously in the background
      (async () => {
        try {
          const results = await Promise.all(toVerify.map(claim => verifyClaim(claim)));
          const verifiedClaims: ScoredClaim[] = results.map(r => ({
            ...r.claim,
            verdict: r.verdict,
            liveValue: r.liveValue,
            sources: r.sources,
            score: scoreClaim(r),
            checkedAt: new Date(),
            correctedText: r.correctedText,
          }));
          const allClaims = [
            ...verifiedClaims,
            ...skipped.map(c => ({ ...c, verdict: 'unverified' as const, score: 0.5, sources: [] })),
          ];
          const staleCount = verifiedClaims.filter(c => c.verdict === 'stale').length;
          const overallScore = scoreResponse(allClaims);
          const correctedAnswer = staleCount > 0 ? buildCorrectedAnswer(body.text, allClaims) : undefined;
          const processingMs = Date.now() - start;
          recordLatency(processingMs);

          await ResponseModel.findByIdAndUpdate(doc._id, {
            claims: allClaims,
            staleCount,
            overallScore,
            correctedAnswer,
            processingMs,
          });

          broadcastSSE('response_updated', {
            _id: doc._id,
            requestId: textHash,
            overallScore,
            staleCount,
            totalClaims: allClaims.length,
          });
        } catch (err: any) {
          console.warn('[FreshnessGuard] Async verification error:', err.message);
        }
      })();
      return;
    }

    // 4C. Inline mode: parallelized live verification via Tavily with rate limiting
    const results = await Promise.all(toVerify.map(claim => verifyClaim(claim)));
    const verifiedClaims: ScoredClaim[] = results.map(r => ({
      ...r.claim,
      verdict: r.verdict,
      liveValue: r.liveValue,
      sources: r.sources,
      score: scoreClaim(r),
      checkedAt: new Date(),
      correctedText: r.correctedText,
    }));

    // Add skipped claims as unverified with neutral score
    const skippedScored: ScoredClaim[] = skipped.map(c => ({
      ...c,
      verdict: 'unverified' as const,
      score: 0.5,
      sources: [],
    }));

    const allClaims: ScoredClaim[] = [...verifiedClaims, ...skippedScored];
    const staleCount = verifiedClaims.filter(c => c.verdict === 'stale').length;
    const overallScore = scoreResponse(allClaims);
    const correctedAnswer = staleCount > 0 ? buildCorrectedAnswer(body.text, allClaims) : undefined;
    const processingMs = Date.now() - start;
    recordLatency(processingMs);

    // 5. Persist
    const doc = new ResponseModel({
      requestId: textHash,
      model: body.model ?? 'unknown',
      provider: body.provider,
      originalText: body.text,
      correctedAnswer,
      claims: allClaims,
      overallScore,
      staleCount,
      totalClaims: allClaims.length,
      fromCache: false,
      processingMs,
      mode,
      fromLLM,
    });
    await doc.save();

    broadcastSSE('new_response', {
      _id: doc._id,
      requestId: textHash,
      model: doc.model,
      overallScore,
      staleCount,
      totalClaims: allClaims.length,
      processingMs,
      checkedAt: doc.checkedAt,
      previewText: body.text.slice(0, 100),
    });

    res.status(201).json(doc);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: err.errors });
      return;
    }
    next(err);
  }
});

// ─── GET /api/responses ───────────────────────────────────────────────────────
router.get('/responses', async (req: Request, res: ExpressResponse, next: NextFunction) => {
  try {
    const { page, limit, verdict, model } = PaginationSchema.parse(req.query);
    const filter: Record<string, unknown> = {};
    if (verdict) filter['claims.verdict'] = verdict;
    if (model)   filter['model'] = { $regex: model, $options: 'i' };

    const [docs, total] = await Promise.all([
      ResponseModel
        .find(filter)
        .sort({ checkedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      ResponseModel.countDocuments(filter),
    ]);

    res.json({ data: docs, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) { next(err); }
});

// ─── GET /api/responses/:id ───────────────────────────────────────────────────
router.get('/responses/:id', async (req: Request, res: ExpressResponse, next: NextFunction) => {
  try {
    const doc = await ResponseModel.findById(req.params.id).lean();
    if (!doc) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(doc);
  } catch (err) { next(err); }
});

// ─── GET /api/stats ───────────────────────────────────────────────────────────
router.get('/stats', async (req: Request, res: ExpressResponse, next: NextFunction) => {
  try {
    const [totalScanned, agg, categoryAgg, hourlyAgg] = await Promise.all([
      ResponseModel.countDocuments(),
      ResponseModel.aggregate([
        { $unwind: { path: '$claims', preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: null,
            totalClaims: { $sum: 1 },
            totalStale: { $sum: { $cond: [{ $eq: ['$claims.verdict', 'stale'] }, 1, 0] } },
            totalCurrent: { $sum: { $cond: [{ $eq: ['$claims.verdict', 'current'] }, 1, 0] } },
            totalUnverified: { $sum: { $cond: [{ $eq: ['$claims.verdict', 'unverified'] }, 1, 0] } },
            avgMs: { $avg: '$processingMs' },
          },
        },
      ]),
      ResponseModel.aggregate([
        { $unwind: '$claims' },
        {
          $group: {
            _id: '$claims.category',
            count: { $sum: 1 },
            staleCount: { $sum: { $cond: [{ $eq: ['$claims.verdict', 'stale'] }, 1, 0] } },
            currentCount: { $sum: { $cond: [{ $eq: ['$claims.verdict', 'current'] }, 1, 0] } },
            unverifiedCount: { $sum: { $cond: [{ $eq: ['$claims.verdict', 'unverified'] }, 1, 0] } },
          },
        },
      ]),
      // Last 24h hourly buckets
      ResponseModel.aggregate([
        { $match: { checkedAt: { $gte: new Date(Date.now() - 24 * 3_600_000) } } },
        { $unwind: { path: '$claims', preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%dT%H:00:00Z', date: '$checkedAt' } },
            total: { $sum: 1 },
            stale: { $sum: { $cond: [{ $eq: ['$claims.verdict', 'stale'] }, 1, 0] } },
            current: { $sum: { $cond: [{ $eq: ['$claims.verdict', 'current'] }, 1, 0] } },
            unverified: { $sum: { $cond: [{ $eq: ['$claims.verdict', 'unverified'] }, 1, 0] } },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    const cacheStats = getCacheStats();

    res.json({
      totalScanned,
      totalClaims:      agg[0]?.totalClaims ?? 0,
      totalStale:       agg[0]?.totalStale ?? 0,
      totalCurrent:     agg[0]?.totalCurrent ?? 0,
      totalUnverified:  agg[0]?.totalUnverified ?? 0,
      cacheHitRate:     cacheStats.rate,
      cacheHits:        cacheStats.hits,
      cacheMisses:      cacheStats.misses,
      avgProcessingMs:  Math.round(agg[0]?.avgMs ?? 0),
      p95ProcessingMs:  percentile(latencies, 95),
      p99ProcessingMs:  percentile(latencies, 99),
      claimsPerCategory: categoryAgg,
      hourlyHistory:     hourlyAgg,
    });
  } catch (err) { next(err); }
});

// ─── POST /api/verify/:id — re-verify stored response ─────────────────────────
router.post('/verify/:id', async (req: Request, res: ExpressResponse, next: NextFunction) => {
  try {
    const doc = await ResponseModel.findById(req.params.id);
    if (!doc) { res.status(404).json({ error: 'Not found' }); return; }

    const reClaimed: ScoredClaim[] = [];
    for (const claim of doc.claims) {
      const result = await verifyClaim(claim as unknown as Claim);
      const score  = scoreClaim(result);
      reClaimed.push({
        ...(claim as unknown as Claim),
        verdict:   result.verdict,
        liveValue: result.liveValue,
        sources:   result.sources,
        score,
        checkedAt: new Date(),
      } as ScoredClaim);
    }

    doc.claims        = reClaimed as typeof doc.claims;
    doc.staleCount    = reClaimed.filter(c => c.verdict === 'stale').length;
    doc.overallScore  = scoreResponse(reClaimed);
    doc.correctedAnswer = doc.staleCount > 0 ? buildCorrectedAnswer(doc.originalText, reClaimed) : undefined;
    doc.checkedAt     = new Date();
    await doc.save();

    broadcastSSE('reverify', { _id: doc._id, overallScore: doc.overallScore, staleCount: doc.staleCount });
    res.json(doc);
  } catch (err) { next(err); }
});

// ─── GET /api/events (SSE) ────────────────────────────────────────────────────
router.get('/events', (req: Request, res: ExpressResponse) => {
  res.writeHead(200, {
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`event: connected\ndata: {"ts":"${new Date().toISOString()}"}\n\n`);
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));

  // Heartbeat every 30 seconds to keep connection alive
  const hb = setInterval(() => {
    try {
      (res as unknown as { write(s: string): void }).write(': heartbeat\n\n');
    } catch {
      clearInterval(hb);
      sseClients.delete(res);
    }
  }, 30_000);
  req.on('close', () => clearInterval(hb));
});

// ─── GET /healthz ─────────────────────────────────────────────────────────────
router.get('/healthz', (_req: Request, res: ExpressResponse) => {
  res.json({
    status: 'ok',
    service: 'freshnessguard',
    version: '1.0.0',
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
    sseClients: sseClients.size,
  });
});

export default router;

