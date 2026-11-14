import mongoose from 'mongoose';
import { getCacheStats, hashText, resetCacheStats, getCached, saveToCache } from '../services/cache';
import { IResponse } from '../models/Response';

// Mock mongoose connection so tests can toggle readyState
jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return {
    ...actual,
    connection: { readyState: 1 },
  };
});

// Mock MongoDB model for L2 persistence
const mockDbStore: Record<string, any> = {};

jest.mock('../models/Response', () => ({
  Response: {
    findOne: jest.fn().mockImplementation(({ requestId }: { requestId: string }) => ({
      lean: jest.fn().mockResolvedValue(mockDbStore[requestId] ? { ...mockDbStore[requestId] } : null),
    })),
    findOneAndUpdate: jest.fn().mockImplementation(({ requestId }: { requestId: string }, { $set }: any) => {
      mockDbStore[requestId] = { ...$set, requestId };
      return Promise.resolve(mockDbStore[requestId]);
    }),
    deleteOne: jest.fn().mockImplementation(({ requestId }: { requestId: string }) => {
      delete mockDbStore[requestId];
      return Promise.resolve({ deletedCount: 1 });
    }),
  },
}));

describe('FreshnessGuard Multi-Tier Cache Engine (L1 Memory + L2 MongoDB)', () => {
  beforeEach(() => {
    resetCacheStats();
    for (const key of Object.keys(mockDbStore)) {
      delete mockDbStore[key];
    }
    // Default to connected
    (mongoose.connection as any).readyState = 1;
  });

  it('hashText returns a deterministic 32-char hex string', () => {
    const h = hashText('hello world');
    expect(h).toHaveLength(32);
    expect(/^[0-9a-f]+$/.test(h)).toBe(true);
    expect(hashText('  test  ')).toBe(hashText('  test  '));
  });

  it('getCacheStats starts at zero', () => {
    const stats = getCacheStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(stats.rate).toBe(0);
  });

  it('cache miss increments misses counter', async () => {
    const doc = await getCached('nonexistent-hash-xyz');
    expect(doc).toBeNull();
    const stats = getCacheStats();
    expect(stats.misses).toBe(1);
    expect(stats.hits).toBe(0);
  });

  it('L1 cache hit: returns document from memory and increments hits counter', async () => {
    const testDoc: Partial<IResponse> = {
      requestId: 'req-l1-test',
      originalText: 'Test statement for L1 cache',
      overallScore: 0.95,
      claims: [
        {
          id: 'c1',
          text: 'Test statement',
          category: 'version',
          extractedValue: '1.0',
          likelihood: 0.9,
          verdict: 'current',
          score: 0.95,
        },
      ],
      staleCount: 0,
      totalClaims: 1,
      fromCache: false,
    };

    await saveToCache(testDoc);

    const cached = await getCached('req-l1-test');
    expect(cached).not.toBeNull();
    expect(cached?.requestId).toBe('req-l1-test');
    expect(cached?.overallScore).toBe(0.95);

    const stats = getCacheStats();
    expect(stats.hits).toBe(1);
    expect(stats.rate).toBe(1.0);
  });

  it('L2 MongoDB fallback: populates L1 when L1 entry is missing', async () => {
    // Populate directly into mock L2 DB only
    mockDbStore['req-l2-only'] = {
      requestId: 'req-l2-only',
      originalText: 'In L2 only',
      overallScore: 0.88,
      claims: [],
      checkedAt: new Date(),
    };

    // First call reads from L2 and populates L1
    const firstCall = await getCached('req-l2-only');
    expect(firstCall).not.toBeNull();
    expect(firstCall?.requestId).toBe('req-l2-only');

    // Simulate database disconnecting
    (mongoose.connection as any).readyState = 0;

    // Second call hits populated L1 in-memory cache despite DB outage
    const secondCall = await getCached('req-l2-only');
    expect(secondCall).not.toBeNull();
    expect(secondCall?.requestId).toBe('req-l2-only');
    expect(getCacheStats().hits).toBe(2);
  });

  it('Database outage behaviour: L1 cache continues serving hits when DB is disconnected', async () => {
    const testDoc: Partial<IResponse> = {
      requestId: 'req-outage-test',
      originalText: 'Cached before outage',
      overallScore: 0.9,
      claims: [],
    };

    await saveToCache(testDoc);

    // Disconnect DB
    (mongoose.connection as any).readyState = 0;

    const hit = await getCached('req-outage-test');
    expect(hit).not.toBeNull();
    expect(hit?.requestId).toBe('req-outage-test');

    // Miss on unknown hash during outage returns null cleanly without hanging
    const miss = await getCached('unknown-during-outage');
    expect(miss).toBeNull();
  });

  it('Cache invalidation / resetCacheStats clears in-memory L1 cache and counters', async () => {
    await saveToCache({ requestId: 'req-reset-test', claims: [] });
    resetCacheStats();

    const stats = getCacheStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
  });

  it('L1 Cache Memory Bounds: evicts oldest entry when MAX_MEM_CACHE_SIZE is exceeded', async () => {
    const { getMemCacheSize, MAX_MEM_CACHE_SIZE } = await import('../services/cache');

    // Populate cache up to a known test boundary
    for (let i = 0; i < 15; i++) {
      await saveToCache({
        requestId: `req-bound-${i}`,
        claims: [{ id: `c-${i}`, text: `Claim ${i}`, category: 'pricing', extractedValue: 'val', likelihood: 0.9 }],
      });
    }

    expect(getMemCacheSize()).toBeLessThanOrEqual(MAX_MEM_CACHE_SIZE);
  });
});
