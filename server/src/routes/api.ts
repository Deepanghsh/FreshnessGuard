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

    // 4. Verification + Scoring
    const mode = body.mode ?? (process.env.STALEGUARD_MODE as 'inline' | 'async') ?? 'inline';
    const verifiedClaims: ScoredClaim[] = [];

    for (const claim of toVerify) {
      const result  = await verifyClaim(claim);
      const score   = scoreClaim(result);
      verifiedClaims.push({
        ...claim,
        verdict:    result.verdict,
        liveValue:  result.liveValue,
        sources:    result.sources,
        score,
        checkedAt:  new Date(),
        correctedText: result.correctedText,
      } as ScoredClaim);
    }

    // Add skipped claims as unverified with neutral score
    const skippedScored: ScoredClaim[] = skipped.map(c => ({
      ...c,
      verdict: 'unverified' as const,
      score: 0.5,
      sources: [],
    }));

    const allClaims: ScoredClaim[] = [...verifiedClaims, ...skippedScored];
    const staleCount  = verifiedClaims.filter(c => c.verdict === 'stale').length;
    const overallScore = scoreResponse(allClaims);
    const correctedAnswer = staleCount > 0 ? buildCorrectedAnswer(body.text, allClaims) : undefined;
    const processingMs = Date.now() - start;
    recordLatency(processingMs);

    // 5. Persist
    const doc = new ResponseModel({
      requestId: textHash,
      model:     body.model ?? 'unknown',
      provider:  body.provider,
      originalText: body.text,
      correctedAnswer,
      claims:   allClaims,
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
      ResponseModel.aggregate([{
        $group: {
          _id: null,
          totalStale: { $sum: '$staleCount' },
          avgMs:      { $avg: '$processingMs' },
        },
      }]),
      ResponseModel.aggregate([
        { $unwind: '$claims' },
        { $group: { _id: '$claims.category', count: { $sum: 1 }, staleCount: { $sum: { $cond: [{ $eq: ['$claims.verdict', 'stale'] }, 1, 0] } } } },
      ]),
      // Last 24h hourly buckets
      ResponseModel.aggregate([
        { $match: { checkedAt: { $gte: new Date(Date.now() - 24 * 3_600_000) } } },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m-%dT%H:00:00Z', date: '$checkedAt' } },
          total: { $sum: 1 },
          stale: { $sum: '$staleCount' },
          current: { $sum: { $subtract: ['$totalClaims', '$staleCount'] } },
        } },
        { $sort: { _id: 1 } },
      ]),
    ]);

    const cacheStats = getCacheStats();

    res.json({
      totalScanned,
      totalStale:       agg[0]?.totalStale ?? 0,
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

