import mongoose, { Schema, Document } from 'mongoose';
import type { ClaimCategory, Verdict, Mode, SummaryStatus } from '../types/index';

export interface ISource {
  url: string;
  title: string;
  publishedDate?: string;
  domain?: string;
  isOfficial?: boolean;
  content?: string;
  score?: number;
  reliability?: 'high' | 'medium' | 'low';
}

export interface IClaim {
  id: string;
  text: string;
  category: ClaimCategory;
  extractedValue: string;
  likelihood: number;
  verdict?: Verdict;
  liveValue?: string;
  sources?: ISource[];
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

export interface IResponse {
  _id?: any;
  userId?: mongoose.Types.ObjectId;
  isPublic?: boolean;
  requestId: string;
  question?: string;
  model: string;
  provider?: string;
  originalText: string;
  correctedAnswer?: string;
  checkedAt: Date;
  claims: IClaim[];
  overallScore: number;
  overallConfidence?: number | null;
  summaryStatus?: SummaryStatus;
  summaryMessage?: string;
  staleCount: number;
  totalClaims: number;
  fromCache: boolean;
  cacheHitAt?: Date;
  processingMs: number;
  mode: Mode;
  fromLLM: boolean;
}

const SourceSchema = new Schema<ISource>({
  url: { type: String, required: true },
  title: { type: String, required: true },
  publishedDate: String,
  domain: String,
  isOfficial: Boolean,
  content: String,
  score: Number,
  reliability: { type: String, enum: ['high', 'medium', 'low'] },
}, { _id: false });

const ClaimSchema = new Schema<IClaim>({
  id: { type: String, required: true },
  text: { type: String, required: true },
  category: {
    type: String,
    enum: ['pricing', 'version', 'date', 'law', 'leadership', 'fact'],
    required: true,
  },
  extractedValue: { type: String, required: true },
  likelihood: { type: Number, required: true, min: 0, max: 1 },
  verdict: { type: String, enum: ['current', 'stale', 'false', 'unverified'] },
  liveValue: String,
  sources: [SourceSchema],
  score: { type: Number, min: 0, max: 1 },
  confidence: { type: Number, min: 0, max: 1 },
  checkedAt: Date,
  correctedText: String,
  entity: String,
  product: String,
  attribute: String,
  unit: String,
  region: String,
  tier: String,
  timePeriod: String,
  enclosingSentence: String,
}, { _id: false });

const ResponseSchema = new Schema<IResponse>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', index: true, required: false },
  isPublic: { type: Boolean, default: false, index: true },
  requestId: { type: String, required: true, index: true },
  question: { type: String, required: false },
  model: { type: String, required: true },
  provider: String,
  originalText: { type: String, required: true },
  correctedAnswer: String,
  checkedAt: { type: Date, default: Date.now },
  claims: [ClaimSchema],
  overallScore: { type: Number, required: true, min: 0, max: 1, default: 1 },
  overallConfidence: { type: Number, min: 0, max: 1, default: null },
  summaryStatus: {
    type: String,
    enum: ['no_claims', 'all_fresh', 'stale_detected', 'unverified', 'bypassed'],
    default: 'no_claims',
  },
  summaryMessage: { type: String, default: 'No claims requiring verification' },
  staleCount: { type: Number, required: true, default: 0 },
  totalClaims: { type: Number, required: true, default: 0 },
  fromCache: { type: Boolean, default: false },
  cacheHitAt: Date,
  processingMs: { type: Number, required: true, default: 0 },
  mode: {
    type: String,
    enum: ['inline', 'async', 'basic', 'bypass'],
    default: 'inline',
  },
  fromLLM: { type: Boolean, default: false },
});

// 72h TTL — the longest per-category TTL. Soft per-category TTL enforced in cache.ts.
// Category TTLs: pricing=6h, version=12h, date=24h, leadership=24h, law=72h, fact=48h
ResponseSchema.index({ checkedAt: 1 }, { expireAfterSeconds: 259200 });
ResponseSchema.index({ checkedAt: -1 });
ResponseSchema.index({ userId: 1, checkedAt: -1 });
ResponseSchema.index({ staleCount: 1, checkedAt: -1 });
ResponseSchema.index({ 'claims.verdict': 1, checkedAt: -1 });

export const Response = mongoose.model<IResponse>('Response', ResponseSchema);
