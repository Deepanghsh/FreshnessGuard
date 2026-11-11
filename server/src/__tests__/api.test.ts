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

jest.mock('../services/verification', () => ({
  verifyClaim: jest.fn().mockResolvedValue({
    claim: { id: 'c1', text: 'v1.0', category: 'version', extractedValue: 'v1.0', likelihood: 0.9 },
    verdict: 'stale',
    liveValue: 'v3.0',
    sources: [{ url: 'https://example.com', title: 'Example', isOfficial: false }],
  }),
}));

jest.mock('../services/scoring', () => ({
  scoreClaim: jest.fn().mockReturnValue(0.1),
  scoreResponse: jest.fn().mockReturnValue(0.1),
  buildCorrectedAnswer: jest.fn().mockReturnValue('corrected text'),
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
    findById: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: 'mock-id-123',
        requestId: 'req-1',
        originalText: 'test',
        overallScore: 0.9,
        staleCount: 0,
        claims: [],
      }),
    }),
    findByIdAndUpdate: jest.fn().mockResolvedValue(undefined),
    countDocuments: jest.fn().mockResolvedValue(1),
    aggregate: jest.fn().mockImplementation((pipeline: any[]) => {
      // Return appropriate aggregation results
      return Promise.resolve([
        {
          _id: null,
          totalClaims: 1,
          totalStale: 0,
          totalCurrent: 1,
          totalUnverified: 0,
          avgMs: 45,
        },
      ]);
    }),
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
  });

  describe('POST /api/check', () => {
    it('rejects empty text with 400', async () => {
      const res = await request(app)
        .post('/api/check')
        .send({ text: '' });
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('rejects missing text with 400', async () => {
      const res = await request(app)
        .post('/api/check')
        .send({});
      expect(res.status).toBe(400);
    });

    it('accepts valid text and returns 201', async () => {
      const res = await request(app)
        .post('/api/check')
        .send({ text: 'GPT-4 API costs $0.03 per 1K tokens. Python 3.11 is latest.' });
      expect([200, 201]).toContain(res.status);
    });

    it('handles mode: bypass returning status 200 and mode bypass', async () => {
      const res = await request(app)
        .post('/api/check')
        .send({ text: 'Some text', mode: 'bypass' });
      expect(res.status).toBe(200);
      expect(res.body.mode).toBe('bypass');
      expect(res.body.overallScore).toBe(1.0);
    });

    it('honors x-bf-eh-freshnessguard-bypass header', async () => {
      const res = await request(app)
        .post('/api/check')
        .set('x-bf-eh-freshnessguard-bypass', 'true')
        .send({ text: 'Some text' });
      expect(res.status).toBe(200);
      expect(res.body.mode).toBe('bypass');
    });

    it('handles mode: async returning 202 Accepted', async () => {
      const res = await request(app)
        .post('/api/check')
        .send({ text: 'GPT-4 pricing claim', mode: 'async' });
      expect(res.status).toBe(202);
      expect(res.body.mode).toBe('async');
    });

    it('handles mode: basic returning 201 without external verification', async () => {
      const res = await request(app)
        .post('/api/check')
        .send({ text: 'Python 3.11 is the latest version.', mode: 'basic' });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('claims');
      expect(res.body).toHaveProperty('overallScore');
    });

    it('rejects text that is too long with 400', async () => {
      const res = await request(app)
        .post('/api/check')
        .send({ text: 'x'.repeat(70_000) });
      expect(res.status).toBe(400);
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
  });

  describe('GET /api/responses', () => {
    it('returns paginated responses list', async () => {
      const res = await request(app).get('/api/responses');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('page');
    });
  });

  describe('GET /api/responses/:id', () => {
    it('returns single response document', async () => {
      const res = await request(app).get('/api/responses/mock-id-123');
      expect(res.status).toBe(200);
      expect(res.body._id).toBe('mock-id-123');
    });
  });
});

