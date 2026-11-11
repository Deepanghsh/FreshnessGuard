import { getCacheStats, hashText, resetCacheStats } from '../services/cache';

// Mock mongoose so tests don't need a real DB
jest.mock('../models/Response', () => {
  const mockData: Record<string, unknown> = {};
  return {
    Response: {
      findOne: jest.fn().mockImplementation(({ requestId }: { requestId: string }) => ({
        lean: jest.fn().mockResolvedValue(mockData[requestId] ?? null),
      })),
      findOneAndUpdate: jest.fn().mockImplementation(({ requestId }: { requestId: string }, { $set: data }: { $set: any }) => {
        mockData[requestId] = data;
        return Promise.resolve(data);
      }),
      deleteOne: jest.fn().mockResolvedValue({}),
    },
  };
});

describe('cache utilities', () => {
  beforeEach(() => resetCacheStats());

  it('hashText returns a 32-char hex string', () => {
    const h = hashText('hello world');
    expect(h).toHaveLength(32);
    expect(/^[0-9a-f]+$/.test(h)).toBe(true);
  });

  it('same text produces same hash', () => {
    expect(hashText('  test  ')).toBe(hashText('  test  '));
  });

  it('getCacheStats starts at zero', () => {
    const stats = getCacheStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(stats.rate).toBe(0);
  });

  it('cache miss increments misses counter', async () => {
    const { getCached } = await import('../services/cache');
    await getCached('nonexistent-hash-xyz');
    expect(getCacheStats().misses).toBe(1);
  });
});

