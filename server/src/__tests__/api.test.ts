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

jest.mock('../models/Response', () => ({
  Response: jest.fn().mockImplementation((data: Record<string, any> = {}) => ({
    ...data,
    _id: 'mock-id-123',
    save: jest.fn().mockResolvedValue(undefined),
    toJSON: jest.fn().mockReturnValue({ ...data, _id: 'mock-id-123' }),
  })),
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

    it('rejects text that is too long with 400', async () => {
      const res = await request(app)
        .post('/api/check')
        .send({ text: 'x'.repeat(70_000) });
      expect(res.status).toBe(400);
    });
  });
});

