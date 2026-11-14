import request from 'supertest';

// ─── Deterministic External Mocks for Reproducible E2E Integration Testing ───
const mockTavilySearch = jest.fn().mockImplementation(async (query: string) => {
  const q = query.toLowerCase();
  if (q.includes('parag agrawal') || q.includes('twitter')) {
    return {
      results: [
        {
          url: 'https://en.wikipedia.org/wiki/Twitter',
          title: 'Twitter Leadership - Linda Yaccarino named CEO',
          content: 'Linda Yaccarino is the current CEO of Twitter / X succeeding Parag Agrawal.',
          published_date: '2024-01-15',
          score: 0.95,
        },
      ],
    };
  }
  if (q.includes('satya nadella') || q.includes('microsoft')) {
    return {
      results: [
        {
          url: 'https://news.microsoft.com/exec/satya-nadella/',
          title: 'Satya Nadella - Chairman and Chief Executive Officer',
          content: 'Satya Nadella is Chairman and CEO of Microsoft.',
          publishedDate: new Date().toISOString().slice(0, 10),
          published_date: new Date().toISOString().slice(0, 10),
          score: 0.98,
        },
      ],
    };
  }
  return { results: [] };
});

jest.mock('@tavily/core', () => ({
  tavily: jest.fn(() => ({
    search: mockTavilySearch,
  })),
}));

jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn().mockRejectedValue(new Error('Simulated LLM fallback to regex in tests')),
      },
    },
  }));
});

// Mock mongoose connection state to report connected
jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return {
    ...actual,
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    connection: { readyState: 1 },
  };
});

// In-memory simulated storage for Mongoose Response model
const inMemoryStore: Record<string, any> = {};

jest.mock('../models/Response', () => {
  const mockModel: any = jest.fn().mockImplementation(function (data: any) {
    const doc: any = {
      ...data,
      _id: 'mock-' + Math.random().toString(36).substring(7),
      save: jest.fn().mockImplementation(async function (this: any) {
        inMemoryStore[this.requestId] = { ...this };
        return this;
      }),
      toJSON: function (this: any) {
        return { ...this };
      },
    };
    return doc;
  });

  mockModel.findOne = jest.fn().mockImplementation(({ requestId }: { requestId: string }) => ({
    lean: async () => inMemoryStore[requestId] || null,
  }));

  mockModel.findOneAndUpdate = jest.fn().mockImplementation(({ requestId }: { requestId: string }, update: any) => {
    const existing = inMemoryStore[requestId] || {};
    const updated = { ...existing, ...(update.$set || update) };
    inMemoryStore[requestId] = updated;
    return updated;
  });

  mockModel.countDocuments = jest.fn().mockImplementation(async () => Object.keys(inMemoryStore).length);

  mockModel.findById = jest.fn().mockImplementation((id: string) => ({
    lean: async () => Object.values(inMemoryStore).find((d: any) => d._id === id) || null,
  }));

  mockModel.findByIdAndUpdate = jest.fn().mockImplementation(async (id: string, update: any) => {
    const found = Object.values(inMemoryStore).find((d: any) => d._id === id);
    if (found) {
      Object.assign(found, update.$set || update);
      return found;
    }
    return null;
  });

  mockModel.deleteOne = jest.fn().mockImplementation(async ({ requestId }: { requestId: string }) => {
    delete inMemoryStore[requestId];
    return { deletedCount: 1 };
  });

  return {
    Response: mockModel,
  };
});

import { app } from '../index';
import { triageClaims } from '../services/triage';
import { scoreClaim, scoreResponse, buildCorrectedAnswer, calculateConfidence, calculateOverallConfidence, getResponseSummary } from '../services/scoring';
import { extractWithRegex } from '../services/extraction';
import { getCacheStats, resetCacheStats } from '../services/cache';
import { ScoredClaim } from '../types';

describe('Phase 6: End-to-End Integration Testing Suite (Mocked Storage)', () => {
  beforeEach(() => {
    resetCacheStats();
    for (const key of Object.keys(inMemoryStore)) {
      delete inMemoryStore[key];
    }
    jest.clearAllMocks();
  });

  // 1. Current Claims Flow
  test('E2E: verifies current claim with high freshness and high confidence', async () => {
    const text = 'Satya Nadella is the CEO of Microsoft.';
    const res = await request(app)
      .post('/api/check')
      .send({ text, mode: 'inline' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('overallScore');
    expect(res.body.overallScore).toBeGreaterThanOrEqual(0.70);
    expect(res.body).toHaveProperty('overallConfidence');
    expect(res.body.summaryStatus).toBe('all_fresh');
    expect(res.body.staleCount).toBe(0);
  });

  // 2. Stale Claims Flow
  test('E2E: detects stale claim, calculates degraded score and builds corrected answer', async () => {
    const text = 'Parag Agrawal is the current CEO of Twitter.';
    const res = await request(app)
      .post('/api/check')
      .send({ text, mode: 'inline' });

    expect(res.status).toBe(201);
    expect(res.body.staleCount).toBeGreaterThan(0);
    expect(res.body.overallScore).toBeLessThan(0.70);
    expect(res.body.summaryStatus).toBe('stale_detected');
    expect(res.body.correctedAnswer).toBeDefined();
    expect(typeof res.body.correctedAnswer).toBe('string');
  });

  // 3. Response Without Time-Sensitive Claims Flow
  test('E2E: response without time-sensitive claims returns summaryStatus=no_claims', async () => {
    const text = 'The quick brown fox jumps over the lazy dog in the sunny afternoon.';
    const res = await request(app)
      .post('/api/check')
      .send({ text, mode: 'inline' });

    expect(res.status).toBe(201);
    expect(res.body.totalClaims).toBe(0);
    expect(res.body.staleCount).toBe(0);
    expect(res.body.overallScore).toBe(1.0);
    expect(res.body.overallConfidence).toBe(1.0);
    expect(res.body.summaryStatus).toBe('no_claims');
    expect(res.body.summaryMessage).toContain('No claims requiring verification');
  });

  // 4. Conflicting Evidence / Conservative Scoring Flow
  test('Integration: conservative scoring bounds confidence and freshness under conflicting evidence', () => {
    const conflictingClaimResult = {
      claim: { id: 'c-conf', text: 'Pricing changed recently', category: 'pricing' as const, extractedValue: '$10', likelihood: 0.8 },
      verdict: 'unverified' as const,
      sources: [
        { url: 'https://source-a.com', title: 'Source A', excerpt: 'Price is $10', isOfficial: false, relevance: 0.6 },
        { url: 'https://source-b.com', title: 'Source B', excerpt: 'Price is $20', isOfficial: false, relevance: 0.5 },
      ],
    };

    const score = scoreClaim(conflictingClaimResult);
    const confidence = calculateConfidence(conflictingClaimResult);

    expect(score).toBeLessThanOrEqual(0.50);
    expect(confidence).toBeLessThanOrEqual(0.50);
  });

  // 5. Unverified Claims Flow
  test('Integration: unverified claims are capped at 0.50 and flagged in summaryStatus', () => {
    const unverifiedClaims: ScoredClaim[] = [
      {
        id: 'u-1',
        text: 'Obscure tool v0.1 released yesterday',
        category: 'version',
        extractedValue: 'v0.1',
        likelihood: 0.7,
        verdict: 'unverified',
        score: 0.50,
        confidence: 0.30,
        sources: [],
      },
    ];

    const overallScore = scoreResponse(unverifiedClaims);
    const summary = getResponseSummary(1, 0, 1, 'inline');

    expect(overallScore).toBeLessThanOrEqual(0.50);
    expect(summary.summaryStatus).toBe('unverified');
    expect(summary.summaryMessage).toContain('unverified');
  });

  // 6. All Four Operating Modes
  describe('Operating Modes', () => {
    const sampleText = 'Python 2.7 is actively supported by the Python Software Foundation.';

    test('Mode: inline returns synchronous verification response', async () => {
      const res = await request(app)
        .post('/api/check')
        .send({ text: sampleText, mode: 'inline' });

      expect(res.status).toBe(201);
      expect(res.body.mode).toBe('inline');
      expect(res.body).toHaveProperty('claims');
      expect(res.body).toHaveProperty('overallScore');
    });

    test('Mode: async returns 202 Accepted immediately with initial payload', async () => {
      const res = await request(app)
        .post('/api/check')
        .send({ text: sampleText, mode: 'async' });

      expect(res.status).toBe(202);
      expect(res.body.mode).toBe('async');
      expect(res.body.summaryStatus).toBe('unverified');
      expect(res.body.overallScore).toBe(0.50);
    });

    test('Mode: basic returns 201 with lightweight regex check without external calls', async () => {
      const res = await request(app)
        .post('/api/check')
        .send({ text: sampleText, mode: 'basic' });

      expect(res.status).toBe(201);
      expect(res.body.mode).toBe('basic');
      expect(res.body.fromLLM).toBe(false);
    });

    test('Mode: bypass skips verification completely returning status 200', async () => {
      const res = await request(app)
        .post('/api/check')
        .send({ text: sampleText, mode: 'bypass' });

      expect(res.status).toBe(200);
      expect(res.body.mode).toBe('bypass');
      expect(res.body.summaryStatus).toBe('bypassed');
      expect(res.body.overallScore).toBe(1.0);
      expect(res.body.totalClaims).toBe(0);
    });
  });

  // 7. Recursion Prevention Headers
  describe('Recursion Prevention', () => {
    test('treats x-bf-eh-freshnessguard-bypass header as bypass mode', async () => {
      const res = await request(app)
        .post('/api/check')
        .set('x-bf-eh-freshnessguard-bypass', 'true')
        .send({ text: 'Parag Agrawal is CEO of Twitter.', mode: 'inline' });

      expect(res.status).toBe(200);
      expect(res.body.mode).toBe('bypass');
      expect(res.body.summaryStatus).toBe('bypassed');
    });

    test('treats x-freshnessguard-bypass header as bypass mode', async () => {
      const res = await request(app)
        .post('/api/check')
        .set('x-freshnessguard-bypass', '1')
        .send({ text: 'Parag Agrawal is CEO of Twitter.', mode: 'inline' });

      expect(res.status).toBe(200);
      expect(res.body.mode).toBe('bypass');
    });
  });

  // 8. Cache Behaviour
  test('E2E: identical request hits in-memory cache and returns fromCache=true', async () => {
    const text = 'Node.js 14 is the current active LTS release.';
    const res1 = await request(app).post('/api/check').send({ text, mode: 'basic' });
    expect(res1.status).toBe(201);
    expect(res1.body.fromCache).toBe(false);

    // Second request with exact same text
    const res2 = await request(app).post('/api/check').send({ text, mode: 'basic' });
    expect(res2.status).toBe(200);
    expect(res2.body.fromCache).toBe(true);
    expect(res2.body.overallScore).toBe(res1.body.overallScore);
    expect(res2.body.summaryStatus).toBe(res1.body.summaryStatus);

    const stats = getCacheStats();
    expect(stats.hits).toBeGreaterThanOrEqual(1);
  });

  // 9. Input Validation & Error Handling
  describe('Input Validation & Safety', () => {
    test('rejects empty text with 400 Bad Request', async () => {
      const res = await request(app).post('/api/check').send({ text: '   ' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    test('rejects missing text field with 400 Bad Request', async () => {
      const res = await request(app).post('/api/check').send({ model: 'gpt-4o' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    test('rejects oversized inputs (>100,000 characters) with 400 Bad Request', async () => {
      const hugeText = 'a'.repeat(105000);
      const res = await request(app).post('/api/check').send({ text: hugeText });
      expect(res.status).toBe(400);
    });

    test('rejects invalid mode with 400 Bad Request', async () => {
      const res = await request(app).post('/api/check').send({ text: 'hello', mode: 'invalid_mode' });
      expect(res.status).toBe(400);
    });
  });

  // 10. Triage & Extraction Unit-Integration
  test('Triage correctly classifies claims by likelihood and filters noise', () => {
    const raw = extractWithRegex('Next.js 12 is released. Cost is $99. Parag Agrawal is CEO.');
    const triaged = triageClaims(raw);

    expect(triaged.toVerify.length).toBeGreaterThan(0);
    triaged.toVerify.forEach(c => {
      expect(['version', 'pricing', 'leadership', 'date', 'law', 'fact']).toContain(c.category);
      expect(c.likelihood).toBeGreaterThanOrEqual(0.6);
    });
  });
});
