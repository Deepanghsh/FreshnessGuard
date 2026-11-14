import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import type { Claim, ClaimCategory, ExtractionResult } from '../types/index';

// ─── Volatility weights per category ──────────────────────────────────────────
const VOLATILITY: Record<ClaimCategory, number> = {
  pricing: 0.95,
  version: 0.90,
  leadership: 0.85,
  date: 0.70,
  law: 0.65,
  fact: 0.40,
};

// ─── Regex patterns ────────────────────────────────────────────────────────────
const VERSION_RE = /(?<!\$)\bv?\d+\.\d+(?:\.\d+)?(?:-[a-z0-9.]+)?\b/gi;
const PRICE_RE   = /\$\s*\d[\d,]*(?:\.\d{1,2})?(?:\s*(?:per|\/)\s*(?:month|year|mo|yr|user|seat|request|token|k\s*tokens?))?/gi;
const DATE_RE    = /\b(202[0-9]|203[0-9])\b/g;
const STALE_RE   = /\b(latest|current|as of|updated|recent|now supports|currently|at the time of writing|at present|today)\b/gi;
const LAW_RE     = /\b(GDPR|CCPA|HIPAA|SOX|Basel\s*(?:I{1,3}|IV)|Dodd.Frank|MiFID|PCI.DSS|regulation|directive)\b/gi;
const CEO_RE     = /\b(?:CEO|CTO|COO|CFO|President|Founder|Chairman|Chairwoman|Director)\b.{0,80}/gi;

export function extractWithRegex(text: string): Claim[] {
  const claims: Claim[] = [];
  const seen = new Set<string>();

  function add(matchText: string, category: ClaimCategory, value: string) {
    const key = `${category}:${value.toLowerCase().trim()}`;
    if (!seen.has(key)) {
      seen.add(key);
      claims.push({ id: uuidv4(), text: matchText.trim(), category, extractedValue: value.trim(), likelihood: VOLATILITY[category] });
    }
  }

  for (const m of text.matchAll(VERSION_RE))  add(m[0], 'version',    m[0]);
  for (const m of text.matchAll(PRICE_RE))    add(m[0], 'pricing',    m[0]);
  for (const m of text.matchAll(DATE_RE))     add(m[0], 'date',       m[0]);
  for (const m of text.matchAll(LAW_RE))      add(m[0], 'law',        m[0].toUpperCase());
  for (const m of text.matchAll(CEO_RE))      add(m[0], 'leadership', m[0]);
  const staleMatches = [...text.matchAll(STALE_RE)];
  if (staleMatches.length > 0) add(`"${staleMatches[0][0]}" indicator`, 'fact', staleMatches[0][0].toLowerCase());
  return claims;
}

const SYSTEM_PROMPT = `You are a claim-extraction specialist. Extract ONLY time-sensitive factual claims that could become stale.
Focus on: software versions, prices/costs, laws/regulations, company leadership roles, specific years/dates, and anything described as "latest", "current", or "as of".
Return ONLY valid JSON: {"claims": [{"text": "<exact quote>", "category": "<pricing|version|date|law|leadership|fact>", "extractedValue": "<specific value>", "likelihood": <0.0-1.0>}]}
If no time-sensitive claims exist, return: {"claims": []}`;

export async function extractClaims(text: string): Promise<ExtractionResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseURL = process.env.OPENAI_BASE_URL;
  const model = process.env.LLM_MODEL ?? 'gpt-4o-mini';

  if (!apiKey) {
    console.warn('[FreshnessGuard] No OPENAI_API_KEY — using regex fallback');
    return { claims: extractWithRegex(text), fromLLM: false };
  }

  try {
    // Pass Bifrost extra header prefix (x-bf-eh-) so Bifrost maps freshnessguard-bypass into request context
    const client = new OpenAI({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
      defaultHeaders: {
        'x-bf-eh-freshnessguard-bypass': 'true',
        'x-freshnessguard-bypass': 'true',
      },
    });
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: `Extract time-sensitive claims from:\n\n${text.slice(0, 8000)}` },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 1500,
    });
    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error('Empty LLM response');
    const parsed = JSON.parse(raw) as { claims: Array<{ text: string; category: string; extractedValue: string; likelihood: number }> };
    const claims: Claim[] = parsed.claims.map(c => ({ id: uuidv4(), text: c.text, category: c.category as ClaimCategory, extractedValue: c.extractedValue, likelihood: Math.min(1, Math.max(0, Number(c.likelihood))) }));
    return { claims, fromLLM: true };
  } catch (err) {
    console.warn('[FreshnessGuard] LLM extraction failed — regex fallback:', (err as Error).message);
    return { claims: extractWithRegex(text), fromLLM: false };
  }
}
