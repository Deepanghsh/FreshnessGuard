import { createHash } from 'crypto';
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

// ─── In-memory stats ──────────────────────────────────────────────────────────
let hits   = 0;
let misses = 0;

export function getCacheStats() {
  const total = hits + misses;
  return { hits, misses, total, rate: total === 0 ? 0 : hits / total };
}

export function resetCacheStats() {
  hits = 0; misses = 0;
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
  try {
    const doc = await ResponseModel.findOne({ requestId: textHash }).lean() as IResponse | null;
    if (!doc) { misses++; return null; }

    const age = Date.now() - new Date(doc.checkedAt).getTime();
    const ttl = effectiveTTL(doc);
    if (age > ttl) {
      misses++;
      // Soft-delete expired doc
      ResponseModel.deleteOne({ requestId: textHash }).catch(() => {});
      return null;
    }

    hits++;
    return doc;
  } catch (err) {
    console.error('[FreshnessGuard] Cache lookup error:', (err as Error).message);
    misses++;
    return null;
  }
}

export async function saveToCache(doc: Partial<IResponse>): Promise<void> {
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

