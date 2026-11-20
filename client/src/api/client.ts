import type { ResponseDoc, StatsData, PaginatedResponses, HealthStatus, Mode, SSEEvent, User, AuthResponse } from '../types';

const BASE = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/$/, '') || '';

export function getBackendBase(): string {
  return BASE;
}

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem('fg_token');
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem('fg_token', token);
    } else {
      localStorage.removeItem('fg_token');
    }
  } catch {
    // Ignore storage issues
  }
}

class APIError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'APIError';
    this.status = status;
  }
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getStoredToken();
  const authHeaders: Record<string, string> = {};
  if (token) {
    authHeaders['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(BASE + path, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
      ...options?.headers,
    },
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

  postAsk: (question: string, model?: string, mode: Mode = 'inline', provider?: string) =>
    apiFetch<ResponseDoc>('/api/ask', {
      method: 'POST',
      body: JSON.stringify({ question, model, mode, provider }),
    }),

  postVerify: (id: string) =>
    apiFetch<ResponseDoc>(`/api/verify/${id}`, {
      method: 'POST',
      body: '{}',
    }),

  getHealth: () =>
    apiFetch<HealthStatus>('/healthz'),

  getBenchmark: () =>
    apiFetch<any>('/api/benchmark'),

  postRunBenchmark: () =>
    apiFetch<any>('/api/benchmark/run', {
      method: 'POST',
      body: '{}',
    }),

  // ─── Authentication Endpoints ───────────────────────────────────────────────
  register: (email: string, password: string, displayName: string) =>
    apiFetch<AuthResponse>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, displayName }),
    }),

  login: (email: string, password: string) =>
    apiFetch<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  logout: () =>
    apiFetch<{ success: boolean; message: string }>('/api/auth/logout', {
      method: 'POST',
    }),

  getMe: async (): Promise<{ user: User | null }> => {
    try {
      return await apiFetch<{ user: User }>('/api/auth/me');
    } catch (err: any) {
      if (err instanceof APIError && err.status === 401) {
        return { user: null };
      }
      throw err;
    }
  },

  forgotPassword: (email: string) =>
    apiFetch<{ message: string; resetToken?: string }>('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  resetPassword: (token: string, password: string) =>
    apiFetch<{ message: string }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    }),

  updateProfile: (data: { displayName?: string; avatarUrl?: string; preferences?: Partial<User['preferences']> }) =>
    apiFetch<{ message: string; user: User }>('/api/auth/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  exportUserData: () =>
    apiFetch<any>('/api/auth/export'),

  getAuthProviders: async (): Promise<{ google: boolean; local?: boolean; demo?: boolean }> => {
    try {
      return await apiFetch<{ google: boolean; local?: boolean; demo?: boolean }>('/api/auth/providers');
    } catch {
      // Safe fallback
      return { google: true, local: true, demo: true };
    }
  },

  loginDemo: () =>
    apiFetch<AuthResponse>('/api/auth/demo', {
      method: 'POST',
    }),

  deleteAccount: () =>
    apiFetch<{ message: string }>('/api/auth/account', {
      method: 'DELETE',
    }),
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
      es = new EventSource(`${BASE}/api/events`);

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
