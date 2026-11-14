export type ClaimCategory = 'pricing' | 'version' | 'date' | 'law' | 'leadership' | 'fact';
export type Verdict = 'current' | 'stale' | 'unverified';
export type Mode = 'inline' | 'async' | 'basic' | 'bypass';
export type SummaryStatus = 'no_claims' | 'all_fresh' | 'stale_detected' | 'unverified' | 'bypassed';

export interface Source {
  url: string;
  title: string;
  publishedDate?: string;
  domain?: string;
  isOfficial?: boolean;
  content?: string;
  score?: number;
}

export interface Claim {
  id: string;
  text: string;
  category: ClaimCategory;
  extractedValue: string;
  likelihood: number;
  verdict?: Verdict;
  liveValue?: string;
  sources?: Source[];
  score?: number;
  confidence?: number;
  checkedAt?: string;
  correctedText?: string;
}

export interface ResponseDoc {
  _id: string;
  requestId: string;
  model: string;
  provider?: string;
  originalText: string;
  correctedAnswer?: string;
  checkedAt: string;
  claims: Claim[];
  overallScore: number;
  overallConfidence?: number;
  summaryStatus?: SummaryStatus;
  summaryMessage?: string;
  staleCount: number;
  totalClaims: number;
  fromCache: boolean;
  cacheHitAt?: string;
  processingMs: number;
  mode: Mode;
  fromLLM?: boolean;
}

export interface StatsData {
  totalScanned: number;
  totalClaims: number;
  totalStale: number;
  totalCurrent: number;
  totalUnverified: number;
  cacheHitRate: number;
  cacheHits: number;
  cacheMisses: number;
  avgProcessingMs: number;
  p95ProcessingMs: number;
  p99ProcessingMs: number;
  claimsPerCategory?: Array<{
    _id: string;
    count: number;
    staleCount: number;
    currentCount?: number;
    unverifiedCount?: number;
  }>;
  hourlyHistory?: Array<{
    _id: string;
    total: number;
    stale: number;
    current: number;
    unverified?: number;
  }>;
}

export interface PaginatedResponses {
  data: ResponseDoc[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface HealthStatus {
  status: 'ok' | 'error';
  service?: string;
  version?: string;
  mongodb: 'connected' | 'disconnected';
  timestamp: string;
  sseClients?: number;
}

export interface SSEEvent {
  type?: string;
  data?: unknown;
  _id?: string;
  requestId?: string;
  model?: string;
  overallScore?: number;
  overallConfidence?: number;
  summaryStatus?: SummaryStatus;
  summaryMessage?: string;
  staleCount?: number;
  totalClaims?: number;
  processingMs?: number;
  checkedAt?: string;
  previewText?: string;
}
