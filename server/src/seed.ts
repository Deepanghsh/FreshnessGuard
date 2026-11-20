import 'dotenv/config';
import mongoose from 'mongoose';
import { Response as ResponseModel } from './models/Response';

const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/freshnessguard';

// ─── Demo seed data ───────────────────────────────────────────────────────────
// 10 realistic examples spanning all claim categories.
// These power the dashboard's initial state and the demo.
const seeds = [
  {
    requestId: 'demo-001',
    model: 'gemini-3.1-flash-lite',
    originalText: 'GPT-4 API costs $0.03 per 1K tokens for input. Python 3.11 is the latest stable release. OpenAI CEO is Sam Altman.',
    correctedAnswer: 'GPT-4 API costs $0.01 per 1K tokens for input *(updated)*. Python 3.13 *(updated)* is the latest stable release. OpenAI CEO is Sam Altman.',
    claims: [
      { id: 'd1', text: '$0.03 per 1K tokens', category: 'pricing', extractedValue: '$0.03', likelihood: 0.95, verdict: 'stale', liveValue: '$0.01', score: 0.08, sources: [{ url: 'https://openai.com/pricing', title: 'OpenAI Pricing', isOfficial: true, publishedDate: new Date().toISOString() }], checkedAt: new Date() },
      { id: 'd2', text: 'Python 3.11 is the latest', category: 'version', extractedValue: '3.11', likelihood: 0.90, verdict: 'stale', liveValue: '3.13', score: 0.08, sources: [{ url: 'https://python.org/downloads', title: 'Python Downloads', isOfficial: true, publishedDate: new Date().toISOString() }], checkedAt: new Date() },
      { id: 'd3', text: 'OpenAI CEO is Sam Altman', category: 'leadership', extractedValue: 'Sam Altman', likelihood: 0.85, verdict: 'current', score: 0.92, sources: [{ url: 'https://openai.com/about', title: 'OpenAI About', isOfficial: true, publishedDate: new Date().toISOString() }], checkedAt: new Date() },
    ],
    overallScore: 0.31, staleCount: 2, totalClaims: 3, fromCache: false, processingMs: 1840, mode: 'inline', fromLLM: true,
  },
  {
    requestId: 'demo-002',
    model: 'gemini-3.8-flash',
    originalText: 'React 17 is the current stable version of React. The npm registry hosts over 1 million packages. Node.js 18 LTS is recommended for production.',
    correctedAnswer: 'React 18 *(updated)* is the current stable version of React. The npm registry hosts over 1 million packages. Node.js 20 *(updated)* LTS is recommended for production.',
    claims: [
      { id: 'd4', text: 'React 17 is the current stable version', category: 'version', extractedValue: '17', likelihood: 0.90, verdict: 'stale', liveValue: '18', score: 0.07, sources: [{ url: 'https://react.dev', title: 'React Docs', isOfficial: true, publishedDate: new Date().toISOString() }], checkedAt: new Date() },
      { id: 'd5', text: 'Node.js 18 LTS', category: 'version', extractedValue: 'v18', likelihood: 0.90, verdict: 'stale', liveValue: 'v20', score: 0.07, sources: [{ url: 'https://nodejs.org/en/download', title: 'Node.js Downloads', isOfficial: true, publishedDate: new Date().toISOString() }], checkedAt: new Date() },
    ],
    overallScore: 0.14, staleCount: 2, totalClaims: 2, fromCache: false, processingMs: 2210, mode: 'inline', fromLLM: true,
  },
  {
    requestId: 'demo-003',
    model: 'gemini-3.1-flash-lite',
    originalText: 'The GDPR came into effect on 25 May 2018 and applies to all EU organisations. Under GDPR, fines can be up to €20 million or 4% of annual global turnover.',
    claims: [
      { id: 'd6', text: 'GDPR came into effect on 25 May 2018', category: 'law', extractedValue: 'GDPR', likelihood: 0.65, verdict: 'current', score: 0.88, sources: [{ url: 'https://gdpr.eu', title: 'GDPR.eu', isOfficial: true, publishedDate: new Date().toISOString() }], checkedAt: new Date() },
      { id: 'd7', text: 'fines up to €20 million', category: 'law', extractedValue: '€20 million', likelihood: 0.65, verdict: 'current', score: 0.88, sources: [], checkedAt: new Date() },
    ],
    overallScore: 0.88, staleCount: 0, totalClaims: 2, fromCache: false, processingMs: 980, mode: 'inline', fromLLM: true,
  },
  {
    requestId: 'demo-004',
    model: 'gemini-3.8-flash',
    originalText: 'Tesla CEO is Elon Musk. The company\'s latest car is the Cybertruck, priced at $39,990. Tesla stock (TSLA) is currently around $200.',
    claims: [
      { id: 'd8', text: 'Tesla CEO is Elon Musk', category: 'leadership', extractedValue: 'Elon Musk', likelihood: 0.85, verdict: 'current', score: 0.91, sources: [{ url: 'https://ir.tesla.com', title: 'Tesla Investor Relations', isOfficial: true, publishedDate: new Date().toISOString() }], checkedAt: new Date() },
      { id: 'd9', text: 'Cybertruck priced at $39,990', category: 'pricing', extractedValue: '$39,990', likelihood: 0.95, verdict: 'stale', liveValue: '$49,990', score: 0.09, sources: [{ url: 'https://tesla.com/cybertruck', title: 'Cybertruck Order Page', isOfficial: true, publishedDate: new Date().toISOString() }], checkedAt: new Date() },
      { id: 'd10', text: 'TSLA around $200', category: 'pricing', extractedValue: '$200', likelihood: 0.95, verdict: 'stale', liveValue: '$248', score: 0.09, sources: [{ url: 'https://finance.yahoo.com/quote/TSLA', title: 'TSLA Quote', isOfficial: false, publishedDate: new Date().toISOString() }], checkedAt: new Date() },
    ],
    overallScore: 0.36, staleCount: 2, totalClaims: 3, fromCache: false, processingMs: 2100, mode: 'inline', fromLLM: true,
  },
  {
    requestId: 'demo-005',
    model: 'gemini-3.1-flash-lite',
    originalText: 'TypeScript 5.0 introduced const type parameters. The latest version is TypeScript 4.9. npm install -g typescript@latest to get started.',
    correctedAnswer: 'TypeScript 5.0 introduced const type parameters. The latest version is TypeScript 5.5 *(updated)*. npm install -g typescript@latest to get started.',
    claims: [
      { id: 'd11', text: 'TypeScript 4.9', category: 'version', extractedValue: '4.9', likelihood: 0.90, verdict: 'stale', liveValue: '5.5', score: 0.07, sources: [{ url: 'https://typescriptlang.org', title: 'TypeScript', isOfficial: true, publishedDate: new Date().toISOString() }], checkedAt: new Date() },
    ],
    overallScore: 0.07, staleCount: 1, totalClaims: 1, fromCache: false, processingMs: 1320, mode: 'inline', fromLLM: false,
  },
];

async function seed() {
  await mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
    family: 4,
  });
  console.log('[Seed] Connected to MongoDB');

  // Remove old demo docs
  await ResponseModel.deleteMany({ requestId: { $in: seeds.map(s => s.requestId) } });

  const docs = seeds.map(s => ({
    ...s,
    checkedAt: new Date(Date.now() - Math.random() * 3_600_000), // random time in last hour
  }));

  await ResponseModel.insertMany(docs);
  console.log(`[Seed] Inserted ${docs.length} demo documents`);
  await mongoose.disconnect();
}

seed().catch(err => { console.error('[Seed] Error:', err); process.exit(1); });

