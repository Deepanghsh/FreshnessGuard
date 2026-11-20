export type ClaimCategory = 'pricing' | 'version' | 'date' | 'law' | 'leadership' | 'fact';
export type Verdict = 'current' | 'stale' | 'false' | 'unverified';
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
  reliability?: 'high' | 'medium' | 'low';
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
  checkedAt?: Date;
  correctedText?: string;
  entity?: string;
  product?: string;
  attribute?: string;
  unit?: string;
  region?: string;
  tier?: string;
  timePeriod?: string;
  enclosingSentence?: string;
}

export interface ExtractionResult {
  claims: Claim[];
  fromLLM: boolean;
}

export interface VerificationResult {
  claim: Claim;
  verdict: Verdict;
  liveValue?: string;
  sources: Source[];
  answer?: string;
  correctedText?: string;
  confidence?: number;
}

export interface ScoredClaim extends Claim {
  score: number;
  verdict: Verdict;
  confidence?: number;
}

export interface CheckRequest {
  text: string;
  requestId?: string;
  model?: string;
  mode?: Mode;
  provider?: string;
}

export interface CheckResponse {
  _id?: string;
  requestId: string;
  model: string;
  provider?: string;
  originalText: string;
  correctedAnswer?: string;
  checkedAt: Date;
  claims: ScoredClaim[];
  overallScore: number;
  overallConfidence?: number | null;
  summaryStatus: SummaryStatus;
  summaryMessage: string;
  staleCount: number;
  totalClaims: number;
  fromCache: boolean;
  cacheHitAt?: Date;
  processingMs: number;
  mode: Mode;
  fromLLM: boolean;
}
