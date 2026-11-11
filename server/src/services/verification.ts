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

// ─── Verdict extraction from Tavily answer & source snippets ──────────────────
function extractVerdict(
  answer: string | undefined | null,
  claim: Claim,
  results: Array<{ title: string; content?: string; url: string }> = []
): { verdict: Verdict; liveValue?: string; correctedText?: string } {
  const v = claim.extractedValue.toLowerCase().trim();

  // Combine synthesized answer with top search snippets
  const corpus = [
    answer ?? '',
    ...results.slice(0, 3).map(r => `${r.title} ${r.content ?? ''}`),
  ].join('\n').toLowerCase();

  if (!corpus.trim()) return { verdict: 'unverified' };

  // 1. Direct corroboration: check if the exact claim value is affirmed in the corpus
  const hasClaimValue = corpus.includes(v);

  // 2. Look for clear contradiction patterns associated with this category
  let liveValue: string | undefined;

  if (claim.category === 'pricing') {
    // Look for prices mentioned in the evidence
    const priceMatches = (answer ?? corpus).match(/\$[\d,]+(?:\.\d{1,2})?(?:\s*(?:per|\/)\s*(?:month|year|mo|yr|1m|1k|token|user|seat))?/gi);
    if (priceMatches && priceMatches.length > 0) {
      const topPrice = priceMatches[0].trim();
      if (!topPrice.toLowerCase().includes(v) && !v.includes(topPrice.toLowerCase())) {
        liveValue = topPrice;
      }
    }
  } else if (claim.category === 'version') {
    // Look for version numbers in the evidence
    const verMatches = (answer ?? corpus).match(/\bv?(\d+\.\d+(?:\.\d+)?)\b/g);
    if (verMatches && verMatches.length > 0) {
      // Find the most recent/highest version mentioned in relation to the entity
      const topVer = verMatches[0].trim();
      if (topVer.toLowerCase() !== v && !v.includes(topVer.toLowerCase())) {
        liveValue = topVer;
      }
    }
  } else if (claim.category === 'leadership') {
    const nameMatch = (answer ?? corpus).match(/(?:ceo|chief executive officer|president|led by|appointed)\s+(?:is\s+)?([A-Z][a-z]+ [A-Z][a-z]+)/i);
    if (nameMatch && nameMatch[1]) {
      const liveName = nameMatch[1].trim();
      if (!liveName.toLowerCase().includes(v) && !v.includes(liveName.toLowerCase())) {
        liveValue = liveName;
      }
    }
  }

  // 3. Evaluate verdict based on evidence comparison
  if (liveValue) {
    const correctedText = claim.text && claim.extractedValue
      ? claim.text.replace(claim.extractedValue, liveValue)
      : undefined;
    return { verdict: 'stale', liveValue, correctedText };
  }

  // If the exact value was verified in live sources and no conflicting value was found:
  if (hasClaimValue) {
    return { verdict: 'current' };
  }

  // If evidence mentions replacement, discontinuation, or invalidation:
  const explicitInvalidation = /(?:superseded by|deprecated in|no longer supported|invalidated by|repealed|stepped down)/i;
  if (explicitInvalidation.test(corpus)) {
    return { verdict: 'stale' };
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

      const { verdict, liveValue, correctedText } = extractVerdict(result.answer, claim, result.results);
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

