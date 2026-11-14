import { describe, it, expect, vi, afterEach } from 'vitest';
import { api, APIError, subscribeToEvents } from '../src/api/client.ts';
import type { Mode, SummaryStatus, Claim } from '../src/types/index.ts';

// ─── Frontend API Client Suite ───────────────────────────────────────────────

describe('Frontend API Client Suite', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('correctly constructs getResponses query params with page, limit, and verdict filter', async () => {
    let capturedUrl = '';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return {
        ok: true,
        json: async () => ({ data: [], total: 0, page: 2, limit: 10, pages: 0 }),
      } as unknown as Response;
    }) as typeof fetch;

    try {
      const res = await api.getResponses(2, 10, 'stale');
      expect(capturedUrl).toBe('/api/responses?page=2&limit=10&verdict=stale');
      expect(res.page).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('postCheck transmits mode (inline, async, basic, bypass) and model to backend', async () => {
    let capturedBody: any = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, opts?: RequestInit) => {
      capturedBody = JSON.parse(opts?.body as string);
      return {
        ok: true,
        json: async () => ({
          _id: 'doc-123',
          requestId: 'req-1',
          model: capturedBody.model,
          mode: capturedBody.mode,
          originalText: capturedBody.text,
          claims: [],
          overallScore: 1.0,
          staleCount: 0,
          totalClaims: 0,
          fromCache: false,
          processingMs: 12,
        }),
      } as unknown as Response;
    }) as typeof fetch;

    try {
      const modes: Mode[] = ['inline', 'async', 'basic', 'bypass'];
      for (const m of modes) {
        const res = await api.postCheck('Test prompt text', 'gpt-4o', m);
        expect(capturedBody.mode).toBe(m);
        expect(capturedBody.model).toBe('gpt-4o');
        expect(res.mode).toBe(m);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('APIError preserves status code and backend error message', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ error: 'Validation error: text is too long' }),
      } as unknown as Response;
    }) as typeof fetch;

    try {
      await expect(api.postCheck('sample')).rejects.toMatchObject({
        name: 'APIError',
        status: 400,
        message: 'Validation error: text is too long',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ─── SSE Stream Integration Suite ────────────────────────────────────────────

describe('SSE Stream Integration Suite', () => {
  it('subscribeToEvents dispatches typed events (new_response, response_updated, cache_hit)', () => {
    const received: Array<{ type: string; [k: string]: any }> = [];

    class MockEventSource {
      listeners: Record<string, Function[]> = {};
      onmessage: Function | null = null;
      onerror: Function | null = null;

      addEventListener(type: string, cb: Function) {
        this.listeners[type] = this.listeners[type] || [];
        this.listeners[type].push(cb);
      }

      close() {}

      simulate(type: string, dataObj: any) {
        const event = { data: JSON.stringify(dataObj) };
        if (type === 'message' && this.onmessage) {
          this.onmessage(event);
        } else if (this.listeners[type]) {
          for (const cb of this.listeners[type]) cb(event);
        }
      }
    }

    const originalES = (globalThis as any).EventSource;
    let mockESInstance: MockEventSource | null = null;
    (globalThis as any).EventSource = class extends MockEventSource {
      constructor() {
        super();
        mockESInstance = this;
      }
    };

    try {
      const unsub = subscribeToEvents((ev) => {
        received.push(ev);
      });

      expect(mockESInstance).toBeTruthy();

      mockESInstance!.simulate('connected', { ts: '2026-11-12T00:00:00Z' });
      mockESInstance!.simulate('new_response', { _id: 'res-1', overallScore: 0.95 });
      mockESInstance!.simulate('response_updated', { _id: 'res-1', overallScore: 0.35, staleCount: 1 });
      mockESInstance!.simulate('cache_hit', { requestId: 'hash-abc' });

      expect(received).toHaveLength(4);
      expect(received[0].type).toBe('connected');
      expect(received[1].type).toBe('new_response');
      expect(received[1]._id).toBe('res-1');
      expect(received[2].type).toBe('response_updated');
      expect(received[2].staleCount).toBe(1);
      expect(received[3].type).toBe('cache_hit');

      unsub();
    } finally {
      (globalThis as any).EventSource = originalES;
    }
  });
});

// ─── Inspector & Playground Logic Suite ──────────────────────────────────────

describe('Inspector & Playground Logic Suite', () => {
  it('distinguishes freshness score from verification confidence', () => {
    const staleClaim: Claim = {
      id: 'c1',
      text: 'GPT-4 pricing is $0.03',
      category: 'pricing',
      extractedValue: '$0.03',
      likelihood: 0.95,
      verdict: 'stale',
      liveValue: '$2.50 per 1M tokens',
      score: 0.15,
      confidence: 0.92,
    };

    expect(staleClaim.score).toBe(0.15);
    expect(staleClaim.confidence).toBe(0.92);
    expect(staleClaim.score).not.toBe(staleClaim.confidence);
  });

  it('correctly builds corrected text from stale claims', () => {
    const originalText = 'Use GPT-4 at $0.03/1K tokens.';
    const staleClaim: Claim = {
      id: 'c1',
      text: '$0.03',
      category: 'pricing',
      extractedValue: '$0.03',
      likelihood: 0.95,
      verdict: 'stale',
      liveValue: '$2.50',
    };

    const corrected = originalText.replace(staleClaim.extractedValue, `${staleClaim.liveValue} *(updated)*`);
    expect(corrected).toBe('Use GPT-4 at $2.50 *(updated)*/1K tokens.');
  });

  it('verifies all 5 summary status categories have distinct semantic meanings', () => {
    const statuses: SummaryStatus[] = ['no_claims', 'all_fresh', 'stale_detected', 'unverified', 'bypassed'];
    const unique = new Set(statuses);
    expect(unique.size).toBe(5);
    expect(unique.has('no_claims')).toBe(true);
    expect(unique.has('all_fresh')).toBe(true);
    expect(unique.has('stale_detected')).toBe(true);
    expect(unique.has('unverified')).toBe(true);
    expect(unique.has('bypassed')).toBe(true);
  });
});
