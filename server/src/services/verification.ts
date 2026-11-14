import { tavily } from '@tavily/core';
import type { Claim, Source, Verdict, VerificationResult } from '../types/index';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * TokenBucket Rate Limiter (Single-Instance Node.js Process)
 * ─────────────────────────────────────────────────────────────────────────────
 * Caps external Tavily API calls to 10 requests per minute to prevent burst
 * HTTP 429 (Rate Limit Exceeded) errors and respect API tier boundaries.
 *
 * ARCHITECTURAL LIMITATION (MULTI-INSTANCE / CLUSTER DEPLOYMENTS):
 * This rate limiter maintains token state within the private memory heap of a
 * single Node.js process. In horizontally scaled deployments (e.g. multi-replica
 * Kubernetes deployments or Node cluster workers), each process instance maintains
 * an independent token bucket, which could collectively exceed Tavily quota limits.
 *
 * RECOMMENDED DISTRIBUTED PRODUCTION EVOLUTION:
 * For multi-instance production deployments, replace this in-memory bucket with
 * an atomic Redis-backed token bucket (e.g., using Redis EVAL Lua scripts with EXPIRE
 * or a distributed rate limiting library such as `ioredis-ratelimit`) to enforce a
 * global, cluster-wide rate limit across all gateway workers.
 * ─────────────────────────────────────────────────────────────────────────────
 */
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
// Note: Domain heuristics alone MUST NOT automatically establish source authority.
// Source authority is evaluated dynamically in `scoring.ts` by blending domain type
// with Tavily's semantic relevance score and claim corroboration.
const OFFICIAL_TLD_PATTERN = /\.(?:gov|mil|edu)(?:\.[a-z]{2})?$/i;
const OFFICIAL_SUBDOMAIN_PATTERN = /^(?:docs|api|developer|developer-portal|support|help)\.[a-z0-9-]+\.[a-z]{2,}$/i;
const KNOWN_OFFICIAL_DOMAINS = new Set([
  'github.com',
  'openai.com',
  'anthropic.com',
  'microsoft.com',
  'google.com',
  'apple.com',
  'python.org',
  'golang.org',
  'nodejs.org',
  'rust-lang.org',
  'kernel.org',
  'w3.org',
  'ecma-international.org',
  'ietf.org',
]);

export function isOfficialDomain(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (OFFICIAL_TLD_PATTERN.test(host)) return true;
    if (OFFICIAL_SUBDOMAIN_PATTERN.test(host)) return true;
    if (KNOWN_OFFICIAL_DOMAINS.has(host) || KNOWN_OFFICIAL_DOMAINS.has(host.replace(/^www\./, ''))) return true;
    return false;
  } catch { return false; }
}

function extractDomain(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

// ─── Verdict extraction from Tavily answer & source snippets ──────────────────
export function extractVerdict(
  answer: string | undefined | null,
  claim: Claim,
  results: Array<{ url: string; title: string; content?: string }>
): { verdict: Verdict; liveValue?: string; correctedText?: string } {
  const corpus = [
    answer ?? '',
    ...results.map(r => `${r.title} ${r.content ?? ''}`),
  ].join(' ').toLowerCase();

  const rawCorpus = [
    answer ?? '',
    ...results.map(r => `${r.title} ${r.content ?? ''}`),
  ].join(' ');

  const claimVal = claim.extractedValue.toLowerCase().trim();
  const hasClaimValue = corpus.includes(claimVal);

  // Category-specific contradiction detection
  if (claim.category === 'pricing') {
    const prices = corpus.match(/\$\s*(\d+(?:\.\d{2})?)/g);
    if (prices && prices.length > 0) {
      const livePrice = prices[0].replace(/\s+/, '');
      if (claim.extractedValue.replace(/\s+/, '') !== livePrice) {
        const correctedText = claim.text && claim.extractedValue
          ? claim.text.replace(claim.extractedValue, livePrice)
          : undefined;
        return { verdict: 'stale', liveValue: livePrice, correctedText };
      }
    }
  }

  if (claim.category === 'version') {
    const versions = corpus.match(/\bv?(\d+\.\d+(?:\.\d+)?)\b/g);
    if (versions && versions.length > 0) {
      const cleanClaim = claim.extractedValue.replace(/^v/i, '').trim();
      const distinct = versions
        .map(v => v.replace(/^v/i, ''))
        .filter(v => v !== cleanClaim);

      if (distinct.length > 0) {
        const highest = distinct.sort((a, b) => {
          const pa = a.split('.').map(Number);
          const pb = b.split('.').map(Number);
          for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const diff = (pb[i] ?? 0) - (pa[i] ?? 0);
            if (diff !== 0) return diff;
          }
          return 0;
        })[0];

        const pa = cleanClaim.split('.').map(Number);
        const pb = highest.split('.').map(Number);
        let isStale = false;
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
          if ((pb[i] ?? 0) > (pa[i] ?? 0)) { isStale = true; break; }
          if ((pb[i] ?? 0) < (pa[i] ?? 0)) { break; }
        }

        if (isStale) {
          // liveValue uses plain semver without 'v' prefix so callers can normalise as needed
          const liveValue = highest;
          const correctedText = claim.text && claim.extractedValue
            ? claim.text.replace(claim.extractedValue, liveValue)
            : undefined;
          return { verdict: 'stale', liveValue, correctedText };
        }
      }
    }
  }

  if (claim.category === 'leadership') {
    // Match "CEO is <Name>" or "<Name> is [current] CEO" without case-insensitivity on the Name capture
    const ceoPattern1 = /(?:CEO|Chief Executive Officer)\s*(?::|\s+is|\s+was|\s+named|\s+replaced by)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/;
    const ceoPattern2 = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\s+(?:is|became|serves\s+as|was\s+named|was\s+appointed)\s+(?:the\s+)?(?:new\s+|current\s+)?(?:CEO|Chief Executive Officer)/;
    const ceoMatch = rawCorpus.match(ceoPattern2) || rawCorpus.match(ceoPattern1);

    if (ceoMatch) {
      const rawName = ceoMatch[1].trim();
      const cleanName = rawName.replace(/\s+(?:appointed|since|in|from|effective|starting|as of|is|was).*$/i, '').trim();
      if (!rawCorpus.toLowerCase().includes(claimVal)) {
        const correctedText = claim.text && claim.extractedValue
          ? claim.text.replace(claim.extractedValue, cleanName)
          : undefined;
        return { verdict: 'stale', liveValue: cleanName, correctedText };
      }
    }
  }

  // If evidence mentions replacement, discontinuation, or invalidation:
  const explicitInvalidation = /(?:superseded by|deprecated in|no longer supported|invalidated by|repealed|stepped down)/i;
  if (explicitInvalidation.test(corpus)) {
    return { verdict: 'stale' };
  }

  // If the exact value was verified in live sources and no conflicting value was found:
  if (hasClaimValue && results.length > 0) {
    return { verdict: 'current' };
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

  // Dynamically compute current year context to avoid stale search biases
  const currentYear = new Date().getFullYear();
  const nextYear = currentYear + 1;

  const categoryContext: Record<string, string> = {
    pricing:    `current price cost subscription ${currentYear}`,
    version:    'latest stable release version',
    leadership: 'current CEO CTO executive leadership',
    law:        `current law regulation status ${currentYear} ${nextYear}`,
    date:       `current status date ${currentYear}`,
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
          publishedDate: r.publishedDate ?? (r as any).published_date ?? undefined,
          domain:        extractDomain(r.url),
          isOfficial:    isOfficialDomain(r.url),
          content:       r.content ? r.content.slice(0, 300) : undefined,
          score:         typeof r.score === 'number' ? r.score : undefined,
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

/**
 * verifyClaims — executes claim verification with controlled concurrency
 * to respect Tavily rate limits and avoid socket exhaustion.
 */
export async function verifyClaims(claims: Claim[], concurrency = 3): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];
  for (let i = 0; i < claims.length; i += concurrency) {
    const batch = claims.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(c => verifyClaim(c)));
    results.push(...batchResults);
  }
  return results;
}
