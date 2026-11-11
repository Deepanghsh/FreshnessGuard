import { tavily } from '@tavily/core';
import type { Claim, Source, Verdict, VerificationResult } from '../types/index';

// ─── Token-bucket rate limiter ─────────────────────────────────────────────────
// Caps Tavily calls to 10 per minute regardless of concurrency.
class TokenBucket {
  private tokens: number;
  private readonly max: number;
  private readonly refillRatePerMs: number;
  private lastRefill: number;

  constructor(maxPerMinute: number) {
    this.max = maxPerMinute;
    this.tokens = maxPerMinute;
    this.refillRatePerMs = maxPerMinute / 60_000;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    const now = Date.now();
    this.tokens = Math.min(this.max, this.tokens + (now - this.lastRefill) * this.refillRatePerMs);
    this.lastRefill = now;

    if (this.tokens < 1) {
      const waitMs = Math.ceil((1 - this.tokens) / this.refillRatePerMs);
      await new Promise(r => setTimeout(r, waitMs));
      this.tokens = 0;
    } else {
      this.tokens -= 1;
    }
  }
}

const rateLimiter = new TokenBucket(10);

// ─── Domain authority helpers ──────────────────────────────────────────────────
const OFFICIAL_PATTERNS = [
  /\.gov$/i,
  /^docs\./i,
  /^api\./i,
  /^developer\./i,
  /\.edu$/i,
  /official/i,
  /^blog\./i,
  /^support\./i,
];

function isOfficialDomain(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return OFFICIAL_PATTERNS.some(p => p.test(h));
  } catch { return false; }
}

function extractDomain(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

// ─── Verdict extraction from Tavily answer ────────────────────────────────────
function extractVerdict(answer: string | undefined | null, claim: Claim): { verdict: Verdict; liveValue?: string; correctedText?: string } {
  if (!answer) return { verdict: 'unverified' };
  const a = answer.toLowerCase();
  const v = claim.extractedValue.toLowerCase();

  // Direct confirmation
  if (a.includes(v)) return { verdict: 'current' };

  // Contradiction signals
  const contradictionSignals = ['changed', 'updated', 'replaced', 'deprecated', 'discontinued', 'now costs', 'currently costs', 'now is', 'currently is', 'latest is', 'is now'];
  const hasContradiction = contradictionSignals.some(s => a.includes(s));

  if (hasContradiction) {
    // Try to extract live value
    const priceMatch   = answer.match(/\$[\d,]+(?:\.\d{2})?/);
    const versionMatch = answer.match(/v?\d+\.\d+(?:\.\d+)?/);
    const nameMatch    = answer.match(/(?:is|are|was|became)\s+([A-Z][a-z]+ [A-Z][a-z]+)/);
    const liveValue    = priceMatch?.[0] ?? versionMatch?.[0] ?? nameMatch?.[1];
    const correctedText = liveValue
      ? claim.text.replace(claim.extractedValue, liveValue)
      : undefined;
    return { verdict: 'stale', liveValue, correctedText };
  }

  return { verdict: 'unverified' };
}

// ─── Main verification function ───────────────────────────────────────────────

export async function verifyClaim(claim: Claim): Promise<VerificationResult> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    console.warn('[FreshnessGuard] No TAVILY_API_KEY — skipping live verification');
    return { claim, verdict: 'unverified', sources: [] };
  }

  await rateLimiter.acquire();

  const tvly = tavily({ apiKey });

  // Build a focused query
  const categoryContext: Record<string, string> = {
    pricing:    'current price cost subscription',
    version:    'latest stable release version',
    leadership: 'current CEO CTO executive',
    law:        'current law regulation status 2024 2025',
    date:       'current date updated',
    fact:       'current status accurate',
  };
  const ctx = categoryContext[claim.category] ?? 'current accurate';
  const query = `${claim.extractedValue} ${ctx}: is "${claim.extractedValue}" still accurate?`;

  const TIMEOUT_MS = 10_000;
  let attempt = 0;

  while (attempt < 2) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const result = await tvly.search(query, {
        searchDepth: attempt === 0 ? 'advanced' : 'basic',
        maxResults: 5,
        includeAnswer: true,
      });
      clearTimeout(timer);

      const sources: Source[] = result.results
        .map(r => ({
          url:           r.url,
          title:         r.title,
          publishedDate: r.publishedDate ?? undefined,
          domain:        extractDomain(r.url),
          isOfficial:    isOfficialDomain(r.url),
        }))
        .sort((a, b) => {
          // Prefer official, then recent
          if (a.isOfficial && !b.isOfficial) return -1;
          if (!a.isOfficial && b.isOfficial) return 1;
          if (a.publishedDate && b.publishedDate) {
            return new Date(b.publishedDate).getTime() - new Date(a.publishedDate).getTime();
          }
          return 0;
        });

      const { verdict, liveValue, correctedText } = extractVerdict(result.answer, claim);
      return { claim, verdict, liveValue, sources, answer: result.answer ?? undefined, correctedText };
    } catch (err) {
      clearTimeout(timer);
      attempt++;
      if (attempt >= 2) {
        console.warn('[FreshnessGuard] Tavily verification failed after retry:', (err as Error).message);
        return { claim, verdict: 'unverified', sources: [] };
      }
      await new Promise(r => setTimeout(r, 1500 * attempt));
    }
  }

  return { claim, verdict: 'unverified', sources: [] };
}

