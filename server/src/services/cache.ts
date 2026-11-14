import { createHash } from 'crypto';
import mongoose from 'mongoose';
import { Response as ResponseModel, IResponse } from '../models/Response';

// ─── Per-category TTL (milliseconds) ─────────────────────────────────────────
const CATEGORY_TTL_MS: Record<string, number> = {
  pricing:    6  * 3_600_000,  //  6 hours
  version:    12 * 3_600_000,  // 12 hours
  date:       24 * 3_600_000,  // 24 hours
  leadership: 24 * 3_600_000,  // 24 hours
  fact:       48 * 3_600_000,  // 48 hours
  law:        72 * 3_600_000,  // 72 hours
};

// ─── In-memory L1 cache & stats ───────────────────────────────────────────────
export const MAX_MEM_CACHE_SIZE = parseInt(process.env.CACHE_MAX_ENTRIES ?? '1000', 10);
const memCache = new Map<string, { doc: IResponse; expiresAt: number }>();
let hits   = 0;
let misses = 0;

export function getCacheStats() {
  const total = hits + misses;
  return {
    hits,
    misses,
    total,
    rate: total === 0 ? 0 : hits / total,
    l1Size: memCache.size,
    l1Capacity: MAX_MEM_CACHE_SIZE,
  };
}

export function getMemCacheSize(): number {
  return memCache.size;
}

export function resetCacheStats() {
  hits = 0;
  misses = 0;
  memCache.clear();
}

/**
 * Prunes expired entries from L1 in-memory cache to reclaim memory.
 */
function pruneExpired(now: number): void {
  for (const [key, val] of memCache.entries()) {
    if (val.expiresAt <= now) {
      memCache.delete(key);
    }
  }
}

/**
 * Enforces maximum capacity by evicting the least recently inserted/accessed entries (LRU).
 */
function enforceCapacity(): void {
  while (memCache.size >= MAX_MEM_CACHE_SIZE) {
    const oldestKey = memCache.keys().next().value;
    if (!oldestKey) break;
    memCache.delete(oldestKey);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
export function hashText(text: string): string {
  return createHash('sha256').update(text.trim()).digest('hex').slice(0, 32);
}

function effectiveTTL(doc: IResponse): number {
  const categories = [...new Set(doc.claims.map(c => c.category))];
  if (categories.length === 0) return CATEGORY_TTL_MS.fact;
  return Math.min(...categories.map(cat => CATEGORY_TTL_MS[cat] ?? CATEGORY_TTL_MS.fact));
}

// ─── Cache operations ─────────────────────────────────────────────────────────
export async function getCached(textHash: string): Promise<IResponse | null> {
  const now = Date.now();

  // 1. Fast L1 in-memory lookup
  const memEntry = memCache.get(textHash);
  if (memEntry) {
    if (memEntry.expiresAt > now) {
      hits++;
      // LRU refresh: re-insert to move key to MRU (end of Map insertion order)
      memCache.delete(textHash);
      memCache.set(textHash, memEntry);
      return memEntry.doc;
    }
    memCache.delete(textHash);
  }

  // 2. L2 MongoDB lookup (if connected)
  if (mongoose.connection.readyState !== 1) {
    misses++;
    return null;
  }

  try {
    const doc = await ResponseModel.findOne({ requestId: textHash }).lean() as IResponse | null;
    if (!doc) { misses++; return null; }

    const age = now - new Date(doc.checkedAt).getTime();
    const ttl = effectiveTTL(doc);
    if (age > ttl) {
      misses++;
      ResponseModel.deleteOne({ requestId: textHash }).catch(() => {});
      return null;
    }

    // Populate L1 cache with bounded LRU eviction
    pruneExpired(now);
    enforceCapacity();
    memCache.set(textHash, { doc, expiresAt: now + (ttl - age) });
    hits++;
    return doc;
  } catch (err) {
    console.error('[FreshnessGuard] Cache lookup error:', (err as Error).message);
    misses++;
    return null;
  }
}

export async function saveToCache(doc: Partial<IResponse>): Promise<void> {
  if (!doc.requestId) return;

  const now = Date.now();
  const ttl = doc.claims ? effectiveTTL(doc as IResponse) : CATEGORY_TTL_MS.fact;

  // Save to L1 cache with bounded LRU eviction
  pruneExpired(now);
  enforceCapacity();
  memCache.set(doc.requestId, {
    doc: { ...doc, checkedAt: new Date() } as IResponse,
    expiresAt: now + ttl,
  });

  // Save to L2 MongoDB (if connected)
  if (mongoose.connection.readyState === 1) {
    try {
      await ResponseModel.findOneAndUpdate(
        { requestId: doc.requestId },
        { $set: { ...doc, checkedAt: new Date() } },
        { upsert: true, new: true },
      );
    } catch (err) {
      console.error('[FreshnessGuard] Cache save error:', (err as Error).message);
    }
  }
}
