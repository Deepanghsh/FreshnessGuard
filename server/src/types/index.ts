export type ClaimCategory = 'pricing' | 'version' | 'date' | 'law' | 'leadership' | 'fact';
export type Verdict = 'current' | 'stale' | 'unverified';
export type Mode = 'inline' | 'async' | 'basic' | 'bypass';

export interface Source {
  url: string;
  title: string;
  publishedDate?: string;
  domain?: string;
  isOfficial?: boolean;
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
  checkedAt?: Date;
  correctedText?: string;
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
}

export interface ScoredClaim extends Claim {
  score: number;
  verdict: Verdict;
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
  originalText: string;
  correctedAnswer?: string;
  checkedAt: Date;
  claims: ScoredClaim[];
  overallScore: number;
  staleCount: number;
  totalClaims: number;
  fromCache: boolean;
  processingMs: number;
  mode: Mode;
}
