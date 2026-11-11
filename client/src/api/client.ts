import type { ResponseDoc, StatsData, PaginatedResponses, HealthStatus } from '../types';

const BASE = '';

class APIError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'APIError';
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

  postCheck: (text: string, model?: string) =>
    apiFetch<ResponseDoc>('/api/check', {
      method: 'POST',
      body: JSON.stringify({ text, model }),
    }),

  postVerify: (id: string) =>
    apiFetch<ResponseDoc>(`/api/verify/${id}`, {
      method: 'POST',
      body: '{}',
    }),

  getHealth: () =>
    apiFetch<HealthStatus>('/healthz'),
};

export function subscribeToEvents(onMessage: (data: unknown) => void): () => void {
  let es: EventSource;
  let retryTimeout: ReturnType<typeof setTimeout>;

  function connect() {
    es = new EventSource('/api/events');
    es.onmessage = (e) => {
      try { onMessage(JSON.parse(e.data as string)); } catch { /* ignore parse errors */ }
    };
    es.onerror = () => {
      es.close();
      retryTimeout = setTimeout(connect, 5000); // reconnect after 5s
    };
  }

  connect();
  return () => {
    clearTimeout(retryTimeout);
    es?.close();
  };
}

export { APIError };
