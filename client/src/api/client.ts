import type { ResponseDoc, StatsData, PaginatedResponses, HealthStatus, Mode, SSEEvent } from '../types';

const BASE = '';

class APIError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'APIError';
    this.status = status;
  }
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new APIError(res.status, body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getResponses: (page = 1, limit = 20, verdict?: string) => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (verdict) params.set('verdict', verdict);
    return apiFetch<PaginatedResponses>(`/api/responses?${params}`);
  },

  getResponse: (id: string) =>
    apiFetch<ResponseDoc>(`/api/responses/${id}`),

  getStats: () =>
    apiFetch<StatsData>('/api/stats'),

  postCheck: (text: string, model?: string, mode: Mode = 'inline', provider?: string) =>
    apiFetch<ResponseDoc>('/api/check', {
      method: 'POST',
      body: JSON.stringify({ text, model, mode, provider }),
    }),

  postVerify: (id: string) =>
    apiFetch<ResponseDoc>(`/api/verify/${id}`, {
      method: 'POST',
      body: '{}',
    }),

  getHealth: () =>
    apiFetch<HealthStatus>('/healthz'),
};

export type SSECallback = (event: SSEEvent) => void;

const SSE_EVENT_TYPES = ['message', 'connected', 'new_response', 'response_updated', 'cache_hit', 'reverify'];

export function subscribeToEvents(onMessage: SSECallback): () => void {
  let es: EventSource | null = null;
  let retryTimeout: ReturnType<typeof setTimeout> | null = null;
  let isClosed = false;

  function connect() {
    if (isClosed) return;
    try {
      es = new EventSource('/api/events');

      const handleRaw = (type: string, rawData: string) => {
        try {
          const parsed = JSON.parse(rawData);
          onMessage({ type, ...(typeof parsed === 'object' && parsed !== null ? parsed : { data: parsed }) });
        } catch {
          onMessage({ type, data: rawData });
        }
      };

      es.onmessage = (e) => handleRaw('message', e.data);

      for (const evType of SSE_EVENT_TYPES) {
        if (evType !== 'message') {
          es.addEventListener(evType, (e: Event) => {
            const me = e as MessageEvent;
            handleRaw(evType, me.data);
          });
        }
      }

      es.onerror = () => {
        if (es) {
          es.close();
          es = null;
        }
        if (!isClosed) {
          retryTimeout = setTimeout(connect, 3000);
        }
      };
    } catch {
      if (!isClosed) {
        retryTimeout = setTimeout(connect, 5000);
      }
    }
  }

  connect();

  return () => {
    isClosed = true;
    if (retryTimeout) clearTimeout(retryTimeout);
    if (es) {
      es.close();
      es = null;
    }
  };
}

export { APIError };
