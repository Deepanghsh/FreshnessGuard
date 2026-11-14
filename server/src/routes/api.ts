import { Router, Request, Response as ExpressResponse, NextFunction } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import mongoose from 'mongoose';
import { Response as ResponseModel } from '../models/Response';
import { extractClaims } from '../services/extraction';
import { triageClaims } from '../services/triage';
import { verifyClaim, verifyClaims } from '../services/verification';
import {
  scoreClaim,
  scoreResponse,
  buildCorrectedAnswer,
  calculateConfidence,
  calculateOverallConfidence,
  getResponseSummary,
} from '../services/scoring';
import { getCached, saveToCache, hashText, getCacheStats } from '../services/cache';
import type { Claim, ScoredClaim, Mode } from '../types/index';

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

// ─── Latency tracking (p95 / p99) ─────────────────────────────────────────────
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
  text:      z.string().trim().min(1).max(60_000),
  requestId: z.string().trim().max(128).optional(),
  model:     z.string().trim().max(128).optional(),
  mode:      z.enum(['inline', 'async', 'basic', 'bypass']).optional(),
  provider:  z.string().trim().max(128).optional(),
});

const PaginationSchema = z.object({
  page:    z.coerce.number().int().positive().max(10_000).default(1),
  limit:   z.coerce.number().int().min(1).max(100).default(20),
  verdict: z.enum(['current', 'stale', 'unverified']).optional(),
  model:   z.string().trim().max(128).optional(),
});

// ─── Safe persistence helper ──────────────────────────────────────────────────
async function safeSave(doc: any): Promise<void> {
  try {
    if (mongoose.connection.readyState === 1) {
      await doc.save();
    }
  } catch (err) {
    console.warn('[FreshnessGuard] Database persistence skipped:', (err as Error).message);
  }
}

// ─── POST /api/check ──────────────────────────────────────────────────────────
router.post('/check', async (req: Request, res: ExpressResponse, next: NextFunction) => {
  const start = Date.now();

  try {
    const body = CheckBodySchema.parse(req.body);
    const textHash = hashText(body.text);

    // 0. Bypass check: Internal recursion protection or explicit bypass mode
    const isBypassHeader =
      req.headers['x-freshnessguard-bypass'] === 'true' ||
      req.headers['x-freshnessguard-bypass'] === '1' ||
      req.headers['x-bf-eh-freshnessguard-bypass'] === 'true' ||
      req.headers['x-bf-eh-freshnessguard-bypass'] === '1';

    if (body.mode === 'bypass' || isBypassHeader) {
      const processingMs = Date.now() - start;
      return res.status(200).json({
        requestId: textHash,
        model: body.model ?? 'unknown',
        provider: body.provider,
        originalText: body.text,
        claims: [],
        overallScore: 1.0,
        overallConfidence: 1.0,
        summaryStatus: 'bypassed' as const,
        summaryMessage: 'Bypassed FreshnessGuard verification',
        staleCount: 0,
        totalClaims: 0,
        fromCache: false,
        processingMs,
        mode: 'bypass' as Mode,
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

    const mode: Mode =
      body.mode ??
      (process.env.FRESHNESSGUARD_MODE as Mode) ??
      (process.env.STALEGUARD_MODE as Mode) ??
      'inline';

    // Fast-path: 0 claims extracted -> "No claims requiring verification"
    if (rawClaims.length === 0) {
      const processingMs = Date.now() - start;
      recordLatency(processingMs);
      const { summaryStatus, summaryMessage } = getResponseSummary(0, 0, 0, mode);

      const doc = new ResponseModel({
        requestId: textHash,
        model: body.model ?? 'unknown',
        provider: body.provider,
        originalText: body.text,
        claims: [],
        overallScore: 1.0,
        overallConfidence: 1.0,
        summaryStatus,
        summaryMessage,
        staleCount: 0,
        totalClaims: 0,
        fromCache: false,
        processingMs,
        mode,
        fromLLM,
      });
      await safeSave(doc);

      broadcastSSE('new_response', {
        _id: doc._id,
        requestId: textHash,
        model: doc.model,
        overallScore: 1.0,
        overallConfidence: 1.0,
        summaryStatus,
        summaryMessage,
        staleCount: 0,
        totalClaims: 0,
        processingMs,
        checkedAt: doc.checkedAt,
        previewText: body.text.slice(0, 100),
      });

      return res.status(201).json(doc);
    }

    // 3. Triage
    const { toVerify, skipped } = triageClaims(rawClaims);

    // 4A. Basic mode: local heuristic scoring only, zero external network calls
    if (mode === 'basic') {
      const basicClaims: ScoredClaim[] = rawClaims.map(c => {
        const isRisky = c.likelihood >= 0.75;
        return {
          ...c,
          verdict: isRisky ? ('stale' as const) : ('current' as const),
          score: isRisky ? 0.35 : 0.85,
          confidence: 0.50, // Local heuristic baseline confidence
          sources: [],
          checkedAt: new Date(),
        };
      });
      const staleCount = basicClaims.filter(c => c.verdict === 'stale').length;
      const unverifiedCount = basicClaims.filter(c => c.verdict === 'unverified').length;
      const overallScore = scoreResponse(basicClaims);
      const overallConfidence = calculateOverallConfidence(basicClaims);
      const { summaryStatus, summaryMessage } = getResponseSummary(
        basicClaims.length,
        staleCount,
        unverifiedCount,
        'basic'
      );
      const processingMs = Date.now() - start;
      recordLatency(processingMs);

      const doc = new ResponseModel({
        requestId: textHash,
        model: body.model ?? 'unknown',
        provider: body.provider,
        originalText: body.text,
        claims: basicClaims,
        overallScore,
        overallConfidence,
        summaryStatus,
        summaryMessage,
        staleCount,
        totalClaims: basicClaims.length,
        fromCache: false,
        processingMs,
        mode: 'basic',
        fromLLM: false,
      });
      await safeSave(doc);
      return res.status(201).json(doc);
    }

    // 4B. Async mode: return immediately with accepted status (202), verify in background
    if (mode === 'async') {
      const initialClaims: ScoredClaim[] = rawClaims.map(c => ({
        ...c,
        verdict: 'unverified' as const,
        score: 0.50,
        confidence: 0.30,
        sources: [],
      }));
      const { summaryStatus, summaryMessage } = getResponseSummary(
        initialClaims.length,
        0,
        initialClaims.length,
        'async'
      );

      const doc = new ResponseModel({
        requestId: textHash,
        model: body.model ?? 'unknown',
        provider: body.provider,
        originalText: body.text,
        claims: initialClaims,
        overallScore: 0.50,
        overallConfidence: 0.30,
        summaryStatus,
        summaryMessage,
        staleCount: 0,
        totalClaims: initialClaims.length,
        fromCache: false,
        processingMs: Date.now() - start,
        mode: 'async',
        fromLLM,
      });
      await safeSave(doc);

      // Return initial accepted status immediately
      res.status(202).json(doc);

      // Complete verification asynchronously in the background
      (async () => {
        try {
          const results = await verifyClaims(toVerify, 3);
          const verifiedClaims: ScoredClaim[] = results.map(r => ({
            ...r.claim,
            verdict: r.verdict,
            liveValue: r.liveValue,
            sources: r.sources,
            score: scoreClaim(r),
            confidence: calculateConfidence(r),
            checkedAt: new Date(),
            correctedText: r.correctedText,
          }));
          const allClaims: ScoredClaim[] = [
            ...verifiedClaims,
            ...skipped.map(c => ({
              ...c,
              verdict: 'unverified' as const,
              score: 0.50,
              confidence: 0.20,
              sources: [],
            })),
          ];
          const staleCount = verifiedClaims.filter(c => c.verdict === 'stale').length;
          const unverifiedCount = allClaims.filter(c => c.verdict === 'unverified').length;
          const overallScore = scoreResponse(allClaims);
          const overallConfidence = calculateOverallConfidence(allClaims);
          const correctedAnswer =
            staleCount > 0 ? buildCorrectedAnswer(body.text, allClaims) : undefined;
          const processingMs = Date.now() - start;
          recordLatency(processingMs);

          const summary = getResponseSummary(
            allClaims.length,
            staleCount,
            unverifiedCount,
            'async'
          );

          await ResponseModel.findByIdAndUpdate(doc._id, {
            claims: allClaims,
            staleCount,
            overallScore,
            overallConfidence,
            summaryStatus: summary.summaryStatus,
            summaryMessage: summary.summaryMessage,
            correctedAnswer,
            processingMs,
          });

          broadcastSSE('response_updated', {
            _id: doc._id,
            requestId: textHash,
            overallScore,
            overallConfidence,
            summaryStatus: summary.summaryStatus,
            summaryMessage: summary.summaryMessage,
            staleCount,
            totalClaims: allClaims.length,
          });
        } catch (err: any) {
          console.warn('[FreshnessGuard] Async verification error:', err.message);
        }
      })();
      return;
    }

    // 4C. Inline mode: live verification via Tavily with rate limiting & controlled concurrency
    const results = await verifyClaims(toVerify, 3);
    const verifiedClaims: ScoredClaim[] = results.map(r => ({
      ...r.claim,
      verdict: r.verdict,
      liveValue: r.liveValue,
      sources: r.sources,
      score: scoreClaim(r),
      confidence: calculateConfidence(r),
      checkedAt: new Date(),
      correctedText: r.correctedText,
    }));

    // Add skipped claims as unverified with neutral score & low confidence
    const skippedScored: ScoredClaim[] = skipped.map(c => ({
      ...c,
      verdict: 'unverified' as const,
      score: 0.50,
      confidence: 0.20,
      sources: [],
    }));

    const allClaims: ScoredClaim[] = [...verifiedClaims, ...skippedScored];
    const staleCount = verifiedClaims.filter(c => c.verdict === 'stale').length;
    const unverifiedCount = allClaims.filter(c => c.verdict === 'unverified').length;
    const overallScore = scoreResponse(allClaims);
    const overallConfidence = calculateOverallConfidence(allClaims);
    const correctedAnswer =
      staleCount > 0 ? buildCorrectedAnswer(body.text, allClaims) : undefined;
    const processingMs = Date.now() - start;
    recordLatency(processingMs);

    const { summaryStatus, summaryMessage } = getResponseSummary(
      allClaims.length,
      staleCount,
      unverifiedCount,
      mode
    );

    // 5. Persist
    const doc = new ResponseModel({
      requestId: textHash,
      model: body.model ?? 'unknown',
      provider: body.provider,
      originalText: body.text,
      correctedAnswer,
      claims: allClaims,
      overallScore,
      overallConfidence,
      summaryStatus,
      summaryMessage,
      staleCount,
      totalClaims: allClaims.length,
      fromCache: false,
      processingMs,
      mode,
      fromLLM,
    });
    await safeSave(doc);

    broadcastSSE('new_response', {
      _id: doc._id,
      requestId: textHash,
      model: doc.model,
      overallScore,
      overallConfidence,
      summaryStatus,
      summaryMessage,
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

    if (mongoose.connection.readyState !== 1) {
      res.json({ data: [], total: 0, page, limit, pages: 0 });
      return;
    }

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
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: err.errors });
      return;
    }
    next(err);
  }
});

// ─── GET /api/responses/:id ───────────────────────────────────────────────────
router.get('/responses/:id', async (req: Request, res: ExpressResponse, next: NextFunction) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      res.status(404).json({ error: 'Database unavailable' });
      return;
    }
    const rawId = req.params.id?.trim();
    if (!rawId || !/^[a-zA-Z0-9_.-]{1,128}$/.test(rawId)) {
      res.status(400).json({ error: 'Invalid identifier format' });
      return;
    }

    let doc = null;
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(rawId) && mongoose.Types.ObjectId.isValid(rawId);
    if (isObjectId) {
      doc = await ResponseModel.findById(rawId).lean();
    }
    if (!doc) {
      doc = await ResponseModel.findOne({ requestId: rawId }).lean();
    }

    if (!doc) {
      res.status(404).json({ error: 'Response not found' });
      return;
    }
    res.json(doc);
  } catch (err) {
    if ((err as Error)?.name === 'CastError') {
      res.status(400).json({ error: 'Invalid identifier format' });
      return;
    }
    next(err);
  }
});

// ─── GET /api/stats ───────────────────────────────────────────────────────────
router.get('/stats', async (req: Request, res: ExpressResponse, next: NextFunction) => {
  try {
    const cacheStats = getCacheStats();

    if (mongoose.connection.readyState !== 1) {
      res.json({
        totalScanned: 0,
        totalClaims: 0,
        totalStale: 0,
        totalCurrent: 0,
        totalUnverified: 0,
        cacheHitRate: cacheStats.rate,
        cacheHits: cacheStats.hits,
        cacheMisses: cacheStats.misses,
        avgProcessingMs: 0,
        p95ProcessingMs: 0,
        p99ProcessingMs: 0,
        claimsPerCategory: [],
        hourlyHistory: [],
      });
      return;
    }

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
    const rawId = req.params.id?.trim();
    if (!rawId || !/^[a-zA-Z0-9_.-]{1,128}$/.test(rawId)) {
      res.status(400).json({ error: 'Invalid identifier format' });
      return;
    }

    let doc = null;
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(rawId) && mongoose.Types.ObjectId.isValid(rawId);
    if (isObjectId) {
      doc = await ResponseModel.findById(rawId);
    }
    if (!doc) {
      doc = await ResponseModel.findOne({ requestId: rawId });
    }
    if (!doc) { res.status(404).json({ error: 'Response not found' }); return; }

    const reClaimed: ScoredClaim[] = [];
    for (const claim of doc.claims) {
      const result = await verifyClaim(claim as unknown as Claim);
      const score  = scoreClaim(result);
      const confidence = calculateConfidence(result);
      reClaimed.push({
        ...(claim as unknown as Claim),
        verdict:    result.verdict,
        liveValue:  result.liveValue,
        sources:    result.sources,
        score,
        confidence,
        checkedAt:  new Date(),
      } as ScoredClaim);
    }

    doc.claims        = reClaimed as typeof doc.claims;
    doc.staleCount    = reClaimed.filter(c => c.verdict === 'stale').length;
    const unverifiedCount = reClaimed.filter(c => c.verdict === 'unverified').length;
    doc.overallScore  = scoreResponse(reClaimed);
    doc.overallConfidence = calculateOverallConfidence(reClaimed);
    const summary     = getResponseSummary(reClaimed.length, doc.staleCount, unverifiedCount, doc.mode);
    doc.summaryStatus = summary.summaryStatus;
    doc.summaryMessage = summary.summaryMessage;
    doc.correctedAnswer = doc.staleCount > 0 ? buildCorrectedAnswer(doc.originalText, reClaimed) : undefined;
    doc.checkedAt     = new Date();
    await safeSave(doc);

    broadcastSSE('reverify', {
      _id: doc._id,
      overallScore: doc.overallScore,
      overallConfidence: doc.overallConfidence,
      staleCount: doc.staleCount,
      summaryStatus: doc.summaryStatus,
      summaryMessage: doc.summaryMessage,
    });
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

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearInterval(hb);
    sseClients.delete(res);
  };

  // Heartbeat every 30 seconds to keep connection alive
  const hb = setInterval(() => {
    try {
      (res as unknown as { write(s: string): void }).write(': heartbeat\n\n');
    } catch {
      cleanup();
    }
  }, 30_000);
  hb.unref();

  req.on('close', cleanup);
  res.on('finish', cleanup);
  res.on('error', cleanup);
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
