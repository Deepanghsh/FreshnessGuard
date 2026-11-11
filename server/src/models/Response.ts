import mongoose, { Schema, Document } from 'mongoose';
import type { ClaimCategory, Verdict, Mode } from '../types/index';

export interface ISource {
  url: string;
  title: string;
  publishedDate?: string;
  domain?: string;
  isOfficial?: boolean;
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
  checkedAt?: Date;
  correctedText?: string;
}

export interface IResponse {
  _id?: any;
  requestId: string;
  model: string;
  provider?: string;
  originalText: string;
  correctedAnswer?: string;
  checkedAt: Date;
  claims: IClaim[];
  overallScore: number;
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
  verdict: { type: String, enum: ['current', 'stale', 'unverified'] },
  liveValue: String,
  sources: [SourceSchema],
  score: { type: Number, min: 0, max: 1 },
  checkedAt: Date,
  correctedText: String,
}, { _id: false });

const ResponseSchema = new Schema<IResponse>({
  requestId: { type: String, required: true, index: true },
  model: { type: String, required: true },
  provider: String,
  originalText: { type: String, required: true },
  correctedAnswer: String,
  checkedAt: { type: Date, default: Date.now, index: true },
  claims: [ClaimSchema],
  overallScore: { type: Number, required: true, min: 0, max: 1, default: 1 },
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
ResponseSchema.index({ staleCount: 1, checkedAt: -1 });

export const Response = mongoose.model<IResponse>('Response', ResponseSchema);
