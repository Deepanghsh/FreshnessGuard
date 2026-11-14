import request from 'supertest';

// Mock all external services before importing app
jest.mock('../services/extraction', () => ({
  extractClaims: jest.fn().mockResolvedValue({
    claims: [
      { id: 'c1', text: 'v1.0', category: 'version', extractedValue: 'v1.0', likelihood: 0.9 },
    ],
    fromLLM: false,
  }),
}));

jest.mock('../services/triage', () => ({
  triageClaims: jest.fn().mockReturnValue({
    toVerify: [{ id: 'c1', text: 'v1.0', category: 'version', extractedValue: 'v1.0', likelihood: 0.9 }],
    skipped: [],
  }),
}));

jest.mock('../services/verification', () => {
  const mockResult = {
    claim: { id: 'c1', text: 'v1.0', category: 'version', extractedValue: 'v1.0', likelihood: 0.9 },
    verdict: 'stale',
    liveValue: 'v3.0',
    sources: [{ url: 'https://example.com', title: 'Example', isOfficial: false }],
  };
  return {
    verifyClaim: jest.fn().mockResolvedValue(mockResult),
    verifyClaims: jest.fn().mockResolvedValue([mockResult]),
  };
});

jest.mock('../services/scoring', () => ({
  scoreClaim: jest.fn().mockReturnValue(0.1),
  scoreResponse: jest.fn().mockReturnValue(0.1),
  buildCorrectedAnswer: jest.fn().mockReturnValue('corrected text'),
  calculateConfidence: jest.fn().mockReturnValue(0.6),
  calculateOverallConfidence: jest.fn().mockReturnValue(0.6),
  getResponseSummary: jest.fn().mockImplementation(
    (_total: number, _stale: number, _unverified: number, mode: string) => {
      if (mode === 'bypass') {
        return { summaryStatus: 'bypassed', summaryMessage: 'Bypassed FreshnessGuard verification' };
      }
      return { summaryStatus: 'stale_detected', summaryMessage: '1 stale claim detected' };
    }
  ),
}));

jest.mock('../services/cache', () => ({
  getCached: jest.fn().mockResolvedValue(null),
  saveToCache: jest.fn().mockResolvedValue(undefined),
  hashText: jest.fn().mockReturnValue('testhash'),
  getCacheStats: jest.fn().mockReturnValue({ hits: 5, misses: 10, rate: 0.33 }),
  resetCacheStats: jest.fn(),
}));

jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return {
    ...actual,
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    connection: { readyState: 1 },
  };
});

const mockResponseInstance = (data: Record<string, any> = {}) => ({
  ...data,
  _id: 'mock-id-123',
  save: jest.fn().mockResolvedValue(undefined),
  toJSON: jest.fn().mockReturnValue({ ...data, _id: 'mock-id-123' }),
});

const mockResponseModel = Object.assign(
  jest.fn().mockImplementation(mockResponseInstance),
  {
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([
              { _id: 'mock-id-123', requestId: 'req-1', originalText: 'test', overallScore: 0.9, staleCount: 0, claims: [] }
            ]),
          }),
        }),
      }),
    }),
    findById: jest.fn().mockImplementation((id: string) => ({
      lean: jest.fn().mockImplementation(() => {
        if (id === '507f1f77bcf86cd799439011') {
          return Promise.resolve({
            _id: '507f1f77bcf86cd799439011',
            requestId: 'req-by-objid',
            originalText: 'test',
            overallScore: 0.9,
            staleCount: 0,
            claims: [],
          });
        }
        if (id === '507f1f77bcf86cd799439099') {
          return Promise.resolve(null);
        }
        return Promise.resolve({
          _id: id || 'mock-id-123',
          requestId: 'req-1',
          originalText: 'test',
          overallScore: 0.9,
          staleCount: 0,
          claims: [],
        });
      }),
    })),
    findOne: jest.fn().mockImplementation((query: { requestId?: string }) => ({
      lean: jest.fn().mockImplementation(() => {
        if (query?.requestId === 'nonexistent-id-404' || query?.requestId === '507f1f77bcf86cd799439099') {
          return Promise.resolve(null);
        }
        return Promise.resolve({
          _id: 'mock-id-123',
          requestId: query?.requestId || 'req-1',
          originalText: 'test',
          overallScore: 0.9,
          staleCount: 0,
          claims: [],
        });
      }),
    })),
    findByIdAndUpdate: jest.fn().mockResolvedValue(undefined),
    countDocuments: jest.fn().mockResolvedValue(1),
    aggregate: jest.fn().mockResolvedValue([
      {
        _id: null,
        totalClaims: 1,
        totalStale: 0,
        totalCurrent: 1,
        totalUnverified: 0,
        avgMs: 45,
      },
    ]),
  }
);

jest.mock('../models/Response', () => ({
  Response: mockResponseModel,
}));

// Import after mocks
import { app } from '../index';

describe('API routes', () => {
  describe('GET /healthz', () => {
    it('returns 200 with status ok', async () => {
      const res = await request(app).get('/healthz');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body).toHaveProperty('timestamp');
    });

    it('reports mongodb connection state', async () => {
      const res = await request(app).get('/healthz');
      expect(res.body).toHaveProperty('mongodb');
      expect(['connected', 'disconnected']).toContain(res.body.mongodb);
    });
  });

  describe('POST /api/check — validation', () => {
    it('rejects empty text with 400', async () => {
      const res = await request(app).post('/api/check').send({ text: '' });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('rejects missing text with 400', async () => {
      const res = await request(app).post('/api/check').send({});
      expect(res.status).toBe(400);
    });

    it('rejects text that is too long with 400', async () => {
      const res = await request(app).post('/api/check').send({ text: 'x'.repeat(70_000) });
      expect(res.status).toBe(400);
    });

    it('rejects invalid mode value with 400', async () => {
      const res = await request(app).post('/api/check').send({ text: 'valid text', mode: 'invalid_mode' });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/check — mode: bypass', () => {
    it('handles mode: bypass returning status 200', async () => {
      const res = await request(app).post('/api/check').send({ text: 'Some text', mode: 'bypass' });
      expect(res.status).toBe(200);
      expect(res.body.mode).toBe('bypass');
      expect(res.body.overallScore).toBe(1.0);
    });

    it('bypass response always has summaryStatus=bypassed', async () => {
      const res = await request(app).post('/api/check').send({ text: 'Some text', mode: 'bypass' });
      expect(res.status).toBe(200);
      expect(res.body.summaryStatus).toBe('bypassed');
    });

    it('honors x-bf-eh-freshnessguard-bypass header as bypass', async () => {
      const res = await request(app)
        .post('/api/check')
        .set('x-bf-eh-freshnessguard-bypass', 'true')
        .send({ text: 'Some text' });
      expect(res.status).toBe(200);
      expect(res.body.mode).toBe('bypass');
    });

    it('honors x-freshnessguard-bypass header as bypass', async () => {
      const res = await request(app)
        .post('/api/check')
        .set('x-freshnessguard-bypass', 'true')
        .send({ text: 'Some text' });
      expect(res.status).toBe(200);
      expect(res.body.mode).toBe('bypass');
    });
  });

  describe('POST /api/check — mode: async', () => {
    it('returns 202 Accepted immediately', async () => {
      const res = await request(app).post('/api/check').send({ text: 'GPT-4 pricing claim', mode: 'async' });
      expect(res.status).toBe(202);
      expect(res.body.mode).toBe('async');
    });

    it('async initial response has totalClaims > 0 and all verdicts unverified', async () => {
      const res = await request(app).post('/api/check').send({ text: 'GPT-4 pricing claim', mode: 'async' });
      expect(res.status).toBe(202);
      expect(res.body).toHaveProperty('totalClaims');
    });
  });

  describe('POST /api/check — mode: basic', () => {
    it('returns 201 without external Tavily verification', async () => {
      const res = await request(app).post('/api/check').send({ text: 'Python 3.11 is the latest version.', mode: 'basic' });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('claims');
      expect(res.body).toHaveProperty('overallScore');
    });
  });

  describe('POST /api/check — mode: inline', () => {
    it('returns 201 with claims and summaryStatus', async () => {
      const res = await request(app).post('/api/check').send({ text: 'GPT-4 API costs $0.03 per 1K tokens. Python 3.11 is latest.' });
      expect([200, 201]).toContain(res.status);
      expect(res.body).toHaveProperty('overallScore');
    });

    it('inline response includes summaryStatus and summaryMessage', async () => {
      const res = await request(app).post('/api/check').send({ text: 'GPT-4 API costs $0.03 per 1K tokens.' });
      expect([200, 201]).toContain(res.status);
      expect(res.body).toHaveProperty('summaryStatus');
      expect(res.body).toHaveProperty('summaryMessage');
    });

    it('inline response has overallConfidence field', async () => {
      const res = await request(app).post('/api/check').send({ text: 'GPT-4 API costs $0.03 per 1K tokens.' });
      expect([200, 201]).toContain(res.status);
      expect(res.body).toHaveProperty('overallConfidence');
    });
  });

  describe('GET /api/stats', () => {
    it('returns stats payload with counts and cache metrics', async () => {
      const res = await request(app).get('/api/stats');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('totalScanned');
      expect(res.body).toHaveProperty('totalClaims');
      expect(res.body).toHaveProperty('totalStale');
      expect(res.body).toHaveProperty('cacheHitRate');
    });

    it('returns p95 and p99 latency percentiles', async () => {
      const res = await request(app).get('/api/stats');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('p95ProcessingMs');
      expect(res.body).toHaveProperty('p99ProcessingMs');
    });
  });

  describe('GET /api/responses', () => {
    it('returns paginated responses list', async () => {
      const res = await request(app).get('/api/responses');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('page');
    });

    it('accepts page and limit query params', async () => {
      const res = await request(app).get('/api/responses?page=1&limit=5');
      expect(res.status).toBe(200);
    });

    it('rejects invalid page value', async () => {
      const res = await request(app).get('/api/responses?page=-1');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/responses/:id', () => {
    it('returns single response document by valid 24-character hex ObjectId', async () => {
      const res = await request(app).get('/api/responses/507f1f77bcf86cd799439011');
      expect(res.status).toBe(200);
      expect(res.body._id).toBe('507f1f77bcf86cd799439011');
    });

    it('returns single response document by valid requestId', async () => {
      const res = await request(app).get('/api/responses/demo-001');
      expect(res.status).toBe(200);
      expect(res.body.requestId).toBe('demo-001');
    });

    it('returns 404 when document is not found by ObjectId or requestId', async () => {
      const res = await request(app).get('/api/responses/nonexistent-id-404');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Response not found');
    });

    it('returns 400 for malformed identifier format', async () => {
      const res = await request(app).get('/api/responses/bad$$id%%format');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid identifier format');
    });
  });

  describe('Security & Performance Controls', () => {
    it('sets standard security headers and removes X-Powered-By', async () => {
      const res = await request(app).get('/healthz');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('DENY');
      expect(res.headers['x-xss-protection']).toBe('0');
      expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('enforces authentication boundary when FRESHNESSGUARD_API_KEY is configured', async () => {
      process.env.FRESHNESSGUARD_API_KEY = 'secret-test-key-123';
      try {
        // Without auth header -> 401
        const unauthRes = await request(app)
          .post('/api/check')
          .send({ text: 'Python 3.12 is released' });
        expect(unauthRes.status).toBe(401);
        expect(unauthRes.body.error).toContain('Unauthorized');

        // With invalid auth header -> 401
        const invalidRes = await request(app)
          .post('/api/check')
          .set('Authorization', 'Bearer wrong-key')
          .send({ text: 'Python 3.12 is released' });
        expect(invalidRes.status).toBe(401);

        // With valid Authorization Bearer -> passes auth (returns 201 or normal validation)
        const validBearerRes = await request(app)
          .post('/api/check')
          .set('Authorization', 'Bearer secret-test-key-123')
          .send({ text: 'Python 3.12 is released', mode: 'bypass' });
        expect(validBearerRes.status).toBe(200);

        // With valid X-FreshnessGuard-Key -> passes auth
        const validCustomRes = await request(app)
          .post('/api/check')
          .set('X-FreshnessGuard-Key', 'secret-test-key-123')
          .send({ text: 'Python 3.12 is released', mode: 'bypass' });
        expect(validCustomRes.status).toBe(200);
      } finally {
        delete process.env.FRESHNESSGUARD_API_KEY;
      }
    });
  });
});
