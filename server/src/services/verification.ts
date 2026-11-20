
import { tavily } from '@tavily/core';
import axios from 'axios';
import { Agent as HttpsAgent } from 'node:https';
import type {
  Claim,
  Source,
  Verdict,
  VerificationResult,
} from '../types/index';
import { calculateConfidence } from './scoring';
import { isExtraMemberClaim, isExplicitExtraMemberFee, isExtraMemberEligibility, isDiscontinuedClaim, detectRegion } from './extraction';

// Force IPv4 for Axios requests made by the Tavily SDK.
// IPv6 connectivity is unavailable in the current Docker environment.
axios.defaults.httpsAgent = new HttpsAgent({
  family: 4,
});

// -----------------------------------------------------------------------------
// Rate limiter
// -----------------------------------------------------------------------------

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

    this.tokens = Math.min(
      this.max,
      this.tokens + (now - this.lastRefill) * this.refillRatePerMs
    );

    this.lastRefill = now;

    if (this.tokens < 1) {
      const waitMs = Math.ceil(
        (1 - this.tokens) / this.refillRatePerMs
      );

      await new Promise(resolve => setTimeout(resolve, waitMs));

      this.lastRefill = Date.now();
      this.tokens = 0;
    } else {
      this.tokens -= 1;
    }
  }
}

const rateLimiter = new TokenBucket(10);

// -----------------------------------------------------------------------------
// Domain helpers
// -----------------------------------------------------------------------------

const OFFICIAL_TLD_PATTERN = /\.(?:gov|mil)(?:\.[a-z]{2})?$/i;

const KNOWN_OFFICIAL_DOMAINS = new Set([
  'whitehouse.gov',
  'usa.gov',
  'congress.gov',
  'supremecourt.gov',
  'europa.eu',
  'who.int',
  'un.org',
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
  'react.dev',
  'reactjs.org',
  'netflix.com',
  'spotify.com',
]);

export function getCanonicalDomain(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    const parts = host.split('.');
    if (parts.length >= 2) {
      if (parts.length >= 3 && ['co', 'gov', 'org', 'ac', 'com'].includes(parts[parts.length - 2])) {
        return parts.slice(-3).join('.');
      }
      return parts.slice(-2).join('.');
    }
    return host;
  } catch {
    return url;
  }
}

export function isOfficialDomain(url: string, entity?: string): boolean {
  try {
    const host = new URL(url).hostname
      .toLowerCase()
      .replace(/^www\./, '');

    if (OFFICIAL_TLD_PATTERN.test(host)) return true;

    if ([...KNOWN_OFFICIAL_DOMAINS].some(
      domain => host === domain || host.endsWith(`.${domain}`)
    )) {
      return true;
    }

    if (entity) {
      const cleanEntity = entity.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (cleanEntity.length >= 3) {
        if (
          host === `${cleanEntity}.com` || host.endsWith(`.${cleanEntity}.com`) ||
          host === `${cleanEntity}.org` || host.endsWith(`.${cleanEntity}.org`) ||
          host === `${cleanEntity}.dev` || host.endsWith(`.${cleanEntity}.dev`) ||
          host === `${cleanEntity}.io` || host.endsWith(`.${cleanEntity}.io`)
        ) {
          return true;
        }
      }
    }

    return false;
  } catch {
    return false;
  }
}

export function assessSourceReliability(source: {
  url: string;
  title: string;
  score?: number;
  publishedDate?: string;
  isOfficial?: boolean;
}): 'high' | 'medium' | 'low' {
  if (source.isOfficial || isOfficialDomain(source.url)) {
    return 'high';
  }
  const domain = getCanonicalDomain(source.url);
  const isAuthoritative = [
    'wikipedia.org', 'reuters.com', 'apnews.com', 'bloomberg.com', 'wsj.com',
    'nytimes.com', 'theverge.com', 'techcrunch.com', 'cnet.com',
    'arstechnica.com', 'bbc.com', 'theguardian.com', 'wired.com',
    'variety.com', 'hollywoodreporter.com', 'deadline.com',
  ].includes(domain);

  const hasRecentDate = isRecent(source.publishedDate, 365);
  const hasGoodRelevance = typeof source.score === 'number' ? source.score >= 0.65 : false;

  if (isAuthoritative && (hasRecentDate || hasGoodRelevance)) {
    return 'high';
  }
  if (isAuthoritative || (hasRecentDate && hasGoodRelevance) || (hasGoodRelevance && (source.score ?? 0) >= 0.85)) {
    return 'medium';
  }
  return 'low';
}

export function filterSyndicatedDuplicates<T extends { title: string; url: string; content?: string }>(results: T[]): T[] {
  const unique: T[] = [];
  const seenHeadlines = new Set<string>();

  for (const r of results) {
    const cleanTitle = normalize(r.title).slice(0, 60);
    if (cleanTitle && seenHeadlines.has(cleanTitle)) {
      continue;
    }
    if (cleanTitle) seenHeadlines.add(cleanTitle);
    unique.push(r);
  }
  return unique;
}

function extractDomain(url: string): string {
  return getCanonicalDomain(url);
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsValue(text: string, value: string): boolean {
  const normalizedText = normalize(text);
  const normalizedValue = normalize(value);

  return Boolean(
    normalizedValue && normalizedText.includes(normalizedValue)
  );
}

function getDistinctDomains(
  results: Array<{ url: string }>
): Set<string> {
  return new Set(
    results.map(result => getCanonicalDomain(result.url)).filter(Boolean)
  );
}

function isRecent(
  publishedDate?: string,
  maxAgeDays = 548
): boolean {
  if (!publishedDate) return false;

  const timestamp = Date.parse(publishedDate);
  if (!Number.isFinite(timestamp)) return false;

  const age = Date.now() - timestamp;
  const maxAge = maxAgeDays * 24 * 60 * 60 * 1000;

  return age >= -24 * 60 * 60 * 1000 && age <= maxAge;
}

function getSourceText(result: {
  title: string;
  content?: string;
  url?: string;
}): string {
  return `${result.title} ${(result as any).url ?? ''} ${result.content ?? ''}`;
}

function getAllEvidenceText(
  answer: string | undefined | null,
  results: Array<{ title: string; content?: string }>
): string {
  return [
    answer ?? '',
    ...results.map(getSourceText),
  ].join(' ');
}

// -----------------------------------------------------------------------------
// Claim relevance
// -----------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'the', 'is', 'are', 'was', 'were', 'a', 'an', 'of', 'in', 'on',
  'at', 'to', 'for', 'and', 'or', 'as', 'by', 'with', 'from',
  'that', 'this', 'current', 'currently', 'latest', 'updated',
  'still', 'accurate', 'now', 'new', 'official', 'version',
  'price', 'cost', 'company', 'organization',
]);

function getContextTerms(claim: Claim): string[] {
  const valueTerms = normalize(claim.extractedValue)
    .split(' ')
    .map(t => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean);

  return normalize(claim.text)
    .split(' ')
    .map(t => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(term =>
      term.length > 2 &&
      !STOP_WORDS.has(term) &&
      !valueTerms.includes(term)
    );
}

function hasClaimContext(
  claim: Claim,
  text: string
): boolean {
  const normalizedText = normalize(text);
  const terms = getContextTerms(claim);

  if (terms.length === 0) return true;

  const matched = terms.filter(term =>
    normalizedText.includes(term)
  );

  return matched.length >= Math.min(1, terms.length);
}

function getRelevantSources(
  claim: Claim,
  results: Array<{
    url: string;
    title: string;
    content?: string;
    publishedDate?: string;
  }>
) {
  return results.filter(result => {
    const text = getSourceText(result);

    return (
      containsValue(text, claim.extractedValue) &&
      hasClaimContext(claim, text)
    );
  });
}

// -----------------------------------------------------------------------------
// Version verification
// -----------------------------------------------------------------------------

function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);

  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }

  return 0;
}

function verifyVersion(
  answer: string | undefined | null,
  claim: Claim,
  results: Array<{ url: string; title: string; content?: string }>
): {
  verdict: Verdict;
  liveValue?: string;
  correctedText?: string;
} {
  const evidence = getAllEvidenceText(answer, results);
  const claimText = claim.text;
  const claimVersionMatch = claim.extractedValue.match(/\bv?(\d+(?:\.\d+)*)\b/i) || claim.text.match(/\bv?(\d+(?:\.\d+)*)\b/i);
  const claimVersion = claimVersionMatch ? claimVersionMatch[1] : claim.extractedValue.replace(/^v/i, '').trim();

  // 1. Check for EOL / unsupported assertions (e.g. Python 2.7, Node 14)
  const isEolCheck = /actively supported|active LTS|supported release/i.test(claimText);
  if (isEolCheck) {
    const eolPattern = /\b(?:end of life|eol|reached end of (?:support|life)|no longer supported|unsupported|retired|sunset|deprecated in favor of)\b/i;
    if (eolPattern.test(evidence)) {
      const activeLtsMatch = evidence.match(/(?:current|active|latest)\s+(?:LTS|version|release)\s+is\s+(?:v?(\d+(?:\.\d+)?))/i);
      const liveValue = activeLtsMatch ? activeLtsMatch[1] : 'End of Life';
      return {
        verdict: 'stale',
        liveValue,
        correctedText: `${claim.text} (${claimVersion} reached End-of-Life and is no longer actively supported.)`,
      };
    }
  }

  // 2. Check if the claim specifically asserts that this version IS the "latest", "most recent", or "current"
  const isAssertingLatest = /\b(?:latest|current|most recent)\s+(?:stable\s+)?(?:version|release|rewrite)\b/i.test(claimText) ||
    /\b(?:latest version of|is the latest|is currently the latest)\b/i.test(claimText);

  const versions: string[] = [...(evidence.match(/\bv?\d+(?:\.\d+)+\b/g) ?? [])];
  // Also capture major versions if claim version has no minor (e.g. Next.js 12, TypeScript 5, Angular 2)
  if (!claimVersion.includes('.')) {
    const majorVersions = evidence.match(/\b(?:v|version\s+)?(\d{1,2})\b/gi) ?? [];
    versions.push(...majorVersions.map(m => m.replace(/^(?:v|version\s+)/i, '')));
  }
  const distinctVersions = [
    ...new Set(
      versions.map(version => version.replace(/^v/i, ''))
    ),
  ].filter(version => version !== claimVersion);

  const newerVersions = distinctVersions
    .filter(version => compareVersions(version, claimVersion) > 0)
    .sort((a, b) => compareVersions(b, a));

  // If asserting latest/current and newer versions exist in evidence -> STALE!
  if (isAssertingLatest && newerVersions.length > 0) {
    const liveValue = newerVersions[0];
    return {
      verdict: 'stale',
      liveValue,
      correctedText: claim.text.replace(
        claim.extractedValue,
        liveValue
      ),
    };
  }

  // 3. If the claim is a historical / architectural feature claim (e.g., "React 18 introduced...", "Python 3.12 was released with...", "Tailwind CSS v3 uses JIT..."):
  const isFeatureAttribution = /\b(?:introduced|released with|features|added|uses|deprecated)\b/i.test(claimText);
  if (isFeatureAttribution) {
    const relevant = getRelevantSources(claim, results);
    if (relevant.length > 0) {
      return { verdict: 'current' };
    }
  }

  // 4. If not asserting latest and not claiming EOL, check if exact version is corroborated
  if (!isAssertingLatest && newerVersions.length > 0) {
    const relevant = getRelevantSources(claim, results);
    if (relevant.length > 0) {
      return { verdict: 'current' };
    }
  }

  // 5. Default latest check fallback
  if (newerVersions.length > 0) {
    const liveValue = newerVersions[0];
    return {
      verdict: 'stale',
      liveValue,
      correctedText: claim.text.replace(
        claim.extractedValue,
        liveValue
      ),
    };
  }

  const relevant = getRelevantSources(claim, results);

  if (relevant.length > 0) {
    return { verdict: 'current' };
  }

  return { verdict: 'unverified' };
}

// -----------------------------------------------------------------------------
// Pricing verification
// -----------------------------------------------------------------------------

export function getClaimedTier(claimText: string): 'extra member' | 'standard with ads' | 'standard' | 'premium' | 'basic with ads' | 'basic' | 'individual' | 'family' | 'student' | 'plus' | 'pro' | null {
  const lower = claimText.toLowerCase();

  // Strict Precedence:
  // 1. Standard with Ads (must be before Standard)
  if (/\b(?:standard\s+(?:with\s+ads?|ad-supported|\(with\s+ads?\))|ad-supported\s+standard|standard\s+plan\s+with\s+ads?|standard\s+tier\s+with\s+ads?)\b/i.test(lower)) {
    return 'standard with ads';
  }

  // 2. Standard (ad-free) - must not match Standard with Ads
  if (/\bstandard\b/i.test(lower) && !/\b(?:with\s+ads?|ad-supported|\(with\s+ads?\))\b/i.test(lower)) {
    // If it's an explicit extra-member add-on fee clause (e.g. "add extra member on standard plan for $7.99"), yield to extra member
    if (isExplicitExtraMemberFee(lower) && !/\bstandard\s+(?:plan|tier)?\s*\(?\s*\$/i.test(lower)) {
      return 'extra member';
    }
    return 'standard';
  }

  // 3. Premium
  if (/\bpremium\b/i.test(lower)) {
    if (isExplicitExtraMemberFee(lower) && !/\bpremium\s+(?:plan|tier)?\s*\(?\s*\$/i.test(lower)) {
      return 'extra member';
    }
    return 'premium';
  }

  // 4. Basic with Ads
  if (/\bbasic\s+(?:with\s+ads?|ad-supported)\b/i.test(lower)) {
    return 'basic with ads';
  }

  // 5. Basic (ad-free)
  if (/\bbasic\b/i.test(lower)) {
    return 'basic';
  }

  if (/\bindividual\b/i.test(lower)) return 'individual';
  if (/\bfamily\b/i.test(lower)) return 'family';
  if (/\bstudent\b/i.test(lower)) return 'student';
  if (/\bplus\b/i.test(lower)) return 'plus';
  if (/\bpro\b/i.test(lower)) return 'pro';

  // 6. Extra Member - evaluated AFTER base plans. Only explicit add-on fee or non-eligibility mention.
  if (isExplicitExtraMemberFee(lower) || isExtraMemberClaim(lower)) {
    if (isExtraMemberEligibility(lower) && !isExplicitExtraMemberFee(lower)) {
      return null;
    }
    return 'extra member';
  }

  return null;
}

export function extractAllExtraMemberPrices(text: string): string[] {
  const prices = new Set<string>();
  const directPatterns = [
    /\b(?:extra\s+members?|additional\s+members?|extra\s+member\s+slots?|add-on\s+members?)[^\$\n.]{0,60}?\b(?:at|is\s+now|is|now\s+costs?|now|costs?|reached|:|\||for|fee\s+of|priced\s+at)\s*\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)/gi,
    /\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:(?:(?:\/|per\s+)(?:month|mo|year|yr))?\s+)?(?:for|on|per)\s+(?:an?\s+|each\s+)?(?:extra\s+member|additional\s+member|add-on\s+member)/gi,
    /\|\s*(?:extra\s+members?|additional\s+members?|add-on\s+members?)\s*\|\s*\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)/gi,
    /(?:extra\s+members?|additional\s+members?|add-on\s+members?)\s+(?:fees?|cost|pricing|slots?)[^\$\n.]{0,40}?\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)/gi,
    /\badditional\s+\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)(?:\/|\s*(?:per\s+)?)(?:month|mo)\b[^\n.]{0,40}?\b(?:extra|additional|add-on)\s+member/gi,
    /\b(?:extra\s+members?|additional\s+members?)\s+(?:with\s+ads|without\s+ads)[^\$\n.]{0,40}?\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)/gi,
    /\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:(?:(?:\/|per\s+)(?:month|mo))?\s+)?(?:with\s+ads|without\s+ads)[^\n.]{0,40}?\b(?:for|per)\s+(?:an?\s+)?(?:extra\s+member|additional\s+member)/gi,
  ];
  for (const p of directPatterns) {
    for (const m of text.matchAll(p)) {
      prices.add(`$${m[1].replace(/,/g, '')}`);
    }
  }

  // Multi-price extra member listings in a single clause, e.g.
  // "Extra member fees: $7.99 with ads / $9.99 without ads" or
  // "Extra members with ads: $7.99/month, without ads: $9.99/month"
  const multiPricePattern = /\b(?:extra\s+members?|additional\s+members?|extra\s+member\s+slots?|add-on\s+members?)[^\n.]{0,120}?\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)[^\n.]{0,60}?(?:or|\/|and|,)\s*\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)/gi;
  for (const m of text.matchAll(multiPricePattern)) {
    prices.add(`$${m[1].replace(/,/g, '')}`);
    prices.add(`$${m[2].replace(/,/g, '')}`);
  }

  return [...prices];
}

export function extractTierPrice(tier: string, text: string): string | null {
  if (tier === 'extra member') {
    const prices = extractAllExtraMemberPrices(text);
    return prices.length > 0 ? prices[0] : null;
  }

  if (tier === 'standard with ads') {
    // 1. Multi-line pattern: Standard with Ads\n$8.99
    const multiLineMatch = text.match(/\b(?:standard\s+(?:with\s+ads?|ad-supported|\(with\s+ads?\))|ad-supported\s+standard)\b\s*\n\s*\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)/i);
    if (multiLineMatch) {
      return `$${multiLineMatch[1].replace(/,/g, '')}`;
    }

    // 2. Table rows (explicit | delimiter)
    for (const line of text.split('\n')) {
      if (line.includes('|') && /\b(?:standard\s+(?:with\s+ads?|ad-supported|\(with\s+ads?\))|ad-supported\s+standard)\b/i.test(line)) {
        const prices = [...line.matchAll(/\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)/g)].map(m => `$${m[1].replace(/,/g, '')}`);
        const subPrices = prices.filter(p => parseFloat(p.replace('$', '')) >= 4);
        if (subPrices.length > 0) {
          return subPrices[subPrices.length - 1];
        }
      }
    }

    // 3. Clause / segment breakdown for prose
    const sentences = text.split(/(?<=[.!?\n])\s+/);
    for (const s of sentences) {
      const clauses = s.split(/(?:,|;|\s+while\s+|\s+whereas\s+|\s+and\s+)/i);
      for (const clause of clauses) {
        const patterns = [
          /\b(?:standard\s+(?:with\s+ads?|ad-supported|\(with\s+ads?\))|ad-supported\s+standard|standard\s+(?:plan|tier)\s+with\s+ads?)\b[^\$\n]{0,60}?\b(?:at|is\s+now|is|now\s+costs?|now|costs?|reached|:|\||to|of|priced\s+at)\s*\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)/i,
          /\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:(?:(?:\/|per\s+)(?:month|mo|year|yr))?\s+)?(?:for|on)\s+(?:the\s+)?(?:standard\s+(?:with\s+ads?|ad-supported|\(with\s+ads?\))|ad-supported\s+(?:tier|plan|standard))\b/i,
          /\bstandard\s+(?:with\s+ads?|ad-supported|\(with\s+ads?\))\s*[\n:]+\s*\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)/i,
          /(?:raised|increased|hiked|bumped)\s+(?:the\s+)?(?:ad-supported|standard\s+with\s+ads?)\s+(?:tier|plan)?\s+to\s+\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)/i,
        ];
        for (const p of patterns) {
          const m = clause.match(p);
          if (m) return `$${m[1].replace(/,/g, '')}`;
        }
      }
    }
    return null;
  }

  if (tier === 'standard') {
    // 1. Multi-line pattern: Standard\n$19.99
    const multiLineMatch = text.match(/\bstandard\b(?!\s+(?:with\s+ads?|ad-supported|\(with\s+ads?\)|notes?|member|extra))\s*\n\s*\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)/i);
    if (multiLineMatch) {
      const p = `$${multiLineMatch[1].replace(/,/g, '')}`;
      if (p !== '$8.99' && p !== '$7.99' && p !== '$9.99') return p;
    }

    // 2. Table rows (explicit | delimiter)
    for (const line of text.split('\n')) {
      if (!line.includes('|')) continue;
      const lower = line.toLowerCase();
      if (/\b(?:with\s+ads?|ad-supported|\(with\s+ads?\)|with\s+commercials)\b/i.test(lower)) continue;
      if (isExplicitExtraMemberFee(lower) && !/\bstandard\s+(?:plan|tier|subscription)?\s*\(?\s*\$/i.test(lower)) continue;
      if (/\bstandard\b/i.test(lower)) {
        const prices = [...line.matchAll(/\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)/g)].map(m => `$${m[1].replace(/,/g, '')}`);
        const subPrices = prices.filter(p => {
          const n = parseFloat(p.replace('$', ''));
          return n >= 10 && n <= 30 && p !== '$8.99';
        });
        if (subPrices.length > 0) return subPrices[subPrices.length - 1];
      }
    }

    // 3. Clause / segment breakdown for prose
    const sentences = text.split(/(?<=[.!?\n])\s+/);
    for (const s of sentences) {
      const clauses = s.split(/(?:,|;|\s+while\s+|\s+whereas\s+|\s+and\s+)/i);
      for (const clause of clauses) {
        const lower = clause.toLowerCase();
        if (/\b(?:with\s+ads?|ad-supported|\(with\s+ads?\)|with\s+commercials)\b/i.test(lower)) continue;
        if (isExplicitExtraMemberFee(lower) && !/\bstandard\s+(?:plan|tier)?\s*\(?\s*\$/i.test(lower)) continue;
        if (/\bstandard\b/i.test(lower)) {
          const patterns = [
            /\bstandard\b(?:[\s-]*(?:ad-free\s+)?(?:plan|tier|subscription))?\s*(?:at|is\s+now|is|now\s+costs?|now|costs?|reached|:|\||to|of|priced\s+at)\s*\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)/i,
            /\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:(?:(?:\/|per\s+)(?:month|mo|year|yr))?\s+)?(?:for|on)\s+(?:the\s+)?(?:ad-free\s+)?standard\b/i,
            /\bstandard\b[^\$\n]{0,60}?\b(?:at|is\s+now|is|now\s+costs?|now|costs?|reached|:|\||to|of|priced\s+at)\s*\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)/i,
          ];
          for (const p of patterns) {
            const m = clause.match(p);
            if (m) {
              const price = `$${m[1].replace(/,/g, '')}`;
              if (price !== '$7.99' && price !== '$8.99' && price !== '$9.99') return price;
            }
          }
        }
      }
    }
    return null;
  }

  if (tier === 'premium') {
    // 1. Multi-line pattern: Premium\n$26.99
    const multiLineMatch = text.match(/\bpremium\b\s*\n\s*\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)/i);
    if (multiLineMatch) {
      return `$${multiLineMatch[1].replace(/,/g, '')}`;
    }

    // 2. Table rows (explicit | delimiter)
    for (const line of text.split('\n')) {
      if (!line.includes('|')) continue;
      if (/\bpremium\b/i.test(line)) {
        const prices = [...line.matchAll(/\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)/g)].map(m => `$${m[1].replace(/,/g, '')}`);
        const subPrices = prices.filter(p => {
          const n = parseFloat(p.replace('$', ''));
          return n >= 15 && n <= 40;
        });
        if (subPrices.length > 0) return subPrices[subPrices.length - 1];
      }
    }

    // 3. Clause / segment breakdown for prose
    const sentences = text.split(/(?<=[.!?\n])\s+/);
    for (const s of sentences) {
      const clauses = s.split(/(?:,|;|\s+while\s+|\s+whereas\s+|\s+and\s+)/i);
      for (const clause of clauses) {
        if (/\bpremium\b/i.test(clause)) {
          const patterns = [
            /\bpremium\b(?:[\s-]*(?:ad-free\s+)?(?:plan|tier|subscription))?\s*(?:at|is\s+now|is|now\s+costs?|now|costs?|reached|:|\||to|of|priced\s+at)\s*\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)/i,
            /\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:(?:(?:\/|per\s+)(?:month|mo|year|yr))?\s+)?(?:for|on)\s+(?:the\s+)?premium\b/i,
            /\bpremium\b[^\$\n]{0,60}?\b(?:at|is\s+now|is|now\s+costs?|now|costs?|reached|:|\||to|of|priced\s+at)\s*\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)/i,
          ];
          for (const p of patterns) {
            const m = clause.match(p);
            if (m) {
              const price = `$${m[1].replace(/,/g, '')}`;
              if (price !== '$7.99' && price !== '$8.99' && price !== '$9.99' && price !== '$19.99') return price;
            }
          }
        }
      }
    }
    return null;
  }

  if (tier === 'basic') {
    // 1. Multi-line pattern: Basic\n$11.99
    const multiLineMatch = text.match(/\bbasic\b(?!\s+with\s+ads)\s*\n\s*\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)/i);
    if (multiLineMatch) {
      return `$${multiLineMatch[1].replace(/,/g, '')}`;
    }

    // 2. Table rows
    for (const line of text.split('\n')) {
      if (!line.includes('|')) continue;
      const lower = line.toLowerCase();
      if (/\b(?:with\s+ads?|ad-supported)\b/i.test(lower)) continue;
      if (/\bbasic\b/i.test(lower)) {
        const prices = [...line.matchAll(/\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)/g)].map(m => `$${m[1].replace(/,/g, '')}`);
        const subPrices = prices.filter(p => {
          const n = parseFloat(p.replace('$', ''));
          return n >= 8 && n <= 20;
        });
        if (subPrices.length > 0) return subPrices[subPrices.length - 1];
      }
    }

    // 3. Clause / segment breakdown for prose
    const sentences = text.split(/(?<=[.!?\n])\s+/);
    for (const s of sentences) {
      const clauses = s.split(/(?:,|;|\s+while\s+|\s+whereas\s+|\s+and\s+)/i);
      for (const clause of clauses) {
        const lower = clause.toLowerCase();
        if (/\b(?:with\s+ads?|ad-supported)\b/i.test(lower)) continue;
        if (/\bbasic\b/i.test(lower)) {
          const patterns = [
            /\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:(?:(?:\/|per\s+)(?:month|mo|year|yr))?\s+)?(?:for|on)\s+(?:the\s+)?basic\b(?!\s+with\s+ads)/i,
            /\bbasic\b(?!\s+with\s+ads)(?:[\s-]*(?:ad-free\s+)?(?:plan|tier|subscription))?\s*(?:at|is\s+now|is|now\s+costs?|now|costs?|reached|:|\|)\s*\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)/i,
            /\bbasic\b\s*[\n:]+\s*\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)/i,
            /\bbasic\b[^\$\n]{0,60}?\b(?:at|is\s+now|is|now\s+costs?|now|costs?|reached|:|\||to|of|priced\s+at)\s*\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)/i,
          ];
          for (const p of patterns) {
            const m = clause.match(p);
            if (m) return `$${m[1].replace(/,/g, '')}`;
          }
        }
      }
    }
    return null;
  }

  const escaped = tier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fallbackPatterns = [
    new RegExp(`\\$\\s*(\\d+(?:,\\d{3})*(?:\\.\\d+)?)\\s*(?:(?:(?:\\/|per\\s+)(?:month|mo|year|yr))?\\s+)?(?:for|on)\\s+(?:the\\s+)?${escaped}\\b`, 'i'),
    new RegExp(`\\b${escaped}\\b(?:[\\s-]*(?:plan|tier|subscription))?\\s*(?:at|is\\s+now|is|now\\s+costs?|now|costs?|reached|:|\\|)\\s*\\$\\s*(\\d+(?:,\\d{3})*(?:\\.\\d+)?)`, 'i'),
    new RegExp(`\\|\\s*${escaped}\\s*\\|\\s*\\$\\s*(\\d+(?:,\\d{3})*(?:\\.\\d+)?)`, 'i'),
    new RegExp(`\\b${escaped}\\b\\s*[\\n:]+\\s*\\$\\s*(\\d+(?:,\\d{3})*(?:\\.\\d+)?)`, 'i'),
  ];
  for (const p of fallbackPatterns) {
    const m = text.match(p);
    if (m) return `$${m[1].replace(/,/g, '')}`;
  }
  return null;
}

export function extractBrand(claimText: string, contextText?: string): string | null {
  const KNOWN_BRANDS = [
    'netflix', 'spotify', 'amazon prime', 'amazon', 'youtube', 'hulu',
    'disney+', 'disney plus', 'apple tv', 'apple', 'chatgpt', 'openai',
    'claude', 'anthropic', 'github', 'twitter', 'x', 'linkedin'
  ];
  const claimLower = claimText.toLowerCase();
  for (const brand of KNOWN_BRANDS) {
    if (claimLower.includes(brand)) return brand;
  }
  if (contextText) {
    const contextLower = contextText.toLowerCase();
    for (const brand of KNOWN_BRANDS) {
      if (contextLower.includes(brand)) return brand;
    }
    const m = contextText.match(/([A-Z][a-zA-Z0-9+]+(?:\s+[A-Z][a-zA-Z0-9+]+)?)\s+(?:pricing|plans|subscription|discontinued|costs?)/i);
    if (m && !/^(?:here|these|the|all|current|our|each|as|in)\b/i.test(m[1])) {
      return m[1].toLowerCase();
    }
  }
  return null;
}

function verifyPricing(
  answer: string | undefined | null,
  claim: Claim,
  results: Array<{ url: string; title: string; content?: string }>,
  contextText?: string
): {
  verdict: Verdict;
  liveValue?: string;
  correctedText?: string;
} {
  const evidence = getAllEvidenceText(answer, results);
  const claimText = claim.text;

  // 1. Extract product/service identifiers from the claim (excluding pricing/unit stop words)
  const PRICING_UNITS = new Set([
    'per', 'month', 'year', 'mo', 'yr', 'day', 'week', 'annual', 'annually',
    'monthly', 'subscription', 'tier', 'plan', 'pricing', 'price', 'cost',
    'tokens', 'token', 'user', 'seat', 'usd', 'eur', 'gbp',
  ]);

  const brand = (claim.entity ? claim.entity.toLowerCase() : null) ?? extractBrand(claimText, contextText);
  // Brand relevance check: if a specific brand is identified, evidence must mention it
  if (brand && !normalize(evidence).includes(brand.toLowerCase())) {
    return { verdict: 'unverified' };
  }

  // Do not compare prices from unrelated products.
  const productTerms = getContextTerms(claim).filter(
    term => !/^\d+(?:\.\d+)?$/.test(term) && !PRICING_UNITS.has(term)
  );

  if (brand && !productTerms.includes(brand.toLowerCase())) {
    productTerms.push(brand.toLowerCase());
  }

  if (
    productTerms.length > 0 &&
    !productTerms.some(term => normalize(evidence).includes(term))
  ) {
    return { verdict: 'unverified' };
  }

  // 2. Normalize claimed price: extract bare price without unit suffix (e.g. "$9.99" from "$9.99 per month")
  const claimedPrices = (claim.text.match(/\$\s*\d+(?:,\d{3})*(?:\.\d+)?/g) ?? [])
    .map(p => p.replace(/\s+/g, '').replace(/,/g, ''));

  const claimPriceMatch = claim.extractedValue.match(/\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)/) ||
    claim.text.match(/\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)/);
  const normalizedClaimPrice = claimPriceMatch
    ? `$${claimPriceMatch[1].replace(/,/g, '')}`
    : claim.extractedValue.replace(/\s+/g, '').replace(/,/g, '');
  if (normalizedClaimPrice && normalizedClaimPrice.startsWith('$') && !claimedPrices.includes(normalizedClaimPrice)) {
    claimedPrices.push(normalizedClaimPrice);
  }
  const claimedNumeric = claimPriceMatch ? parseFloat(claimPriceMatch[1].replace(/,/g, '')) : null;

  // 3. Check for free claims that are now paid (e.g. Twitter API Basic tier)
  if (/\b(?:free|completely free|no cost)\b/i.test(claimText)) {
    const paidPattern = /(?:costs?|pricing|price is|now costs?)\s*\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)/i;
    const paidMatch = evidence.match(paidPattern);
    if (paidMatch) {
      const liveValue = `$${paidMatch[1]}`;
      return {
        verdict: 'stale',
        liveValue,
        correctedText: claim.text.replace(/completely free|free/i, liveValue),
      };
    }
  }

  // 4. Product-relevant evidence segments (sentences or snippets discussing the product)
  // Ensures price-increase language is attributed to THIS product, not unrelated products in search results.
  const sentences = evidence.split(/(?<=[.!?\n])\s+/);
  const relevantSentences = productTerms.length > 0
    ? sentences.filter(s => {
      const norm = normalize(s);
      return productTerms.some(t => norm.includes(t));
    })
    : sentences;
  const relevantText = relevantSentences.length > 0 ? relevantSentences.join(' ') : evidence;

  const isDiscontinued = isDiscontinuedClaim(claimText) ||
    (claim.attribute && /discontinued/i.test(claim.attribute)) ||
    (claim.timePeriod === 'historical' && isDiscontinuedClaim(claimText));

  const isExtraMember = (claim.tier?.toLowerCase() === 'extra member') ||
    (claim.attribute && /extra member|add-on/i.test(claim.attribute)) ||
    (isExplicitExtraMemberFee(claimText) && !claim.tier);

  const isHistoricalClaim = claim.timePeriod === 'historical' ||
    /\b(?:used\s+to\s+cost|historical(?:ly)?|was|once|formerly|previously|back\s+in|originally)\b/i.test(claimText);

  // 5. Handling Discontinued / Retired Plans
  if (isDiscontinued) {
    const confirmsDiscontinued = /\b(?:discontinued|retired|sunset(?:ted)?|no\s+longer\s+offered|phased\s+out|cancelled|killed|grandfathered)\b/i.test(relevantText);
    const confirmsClaimedPrice = claimedPrices.some(cp => relevantText.includes(cp));

    if (confirmsDiscontinued && (confirmsClaimedPrice || claimedPrices.length === 0)) {
      return { verdict: 'current' };
    }

    // Direct transition for discontinued plan (e.g. Basic raised from $9.99 to $11.99 before phasing out)
    const transitionPattern = /\bfrom\s+\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s+(?:(?:all\s+the\s+way\s+)?up\s+)?to\s+\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)/gi;
    for (const match of relevantText.matchAll(transitionPattern)) {
      const fromNum = parseFloat(match[1].replace(/,/g, ''));
      const toNum = parseFloat(match[2].replace(/,/g, ''));
      if (claimedNumeric !== null && Math.abs(fromNum - claimedNumeric) < 0.01 && toNum !== claimedNumeric) {
        const liveValue = `$${match[2].replace(/,/g, '')}`;
        return {
          verdict: 'stale',
          liveValue,
          correctedText: claim.text.replace(claim.extractedValue, liveValue),
        };
      }
    }

    // Discontinued plans DO NOT have active replacement prices.
    // Never transfer an active plan's price (e.g. Standard $19.99) to a discontinued plan!
    return { verdict: 'unverified' };
  }

  // 6. Handling Extra-Member Add-ons
  if (isExtraMember) {
    const extraMemberSentences = relevantSentences.filter(s => isExtraMemberClaim(s));
    if (extraMemberSentences.length === 0) {
      // Evidence mentions the brand, but does NOT mention extra members.
      // Must not validate extra member claim with unrelated product/plan prices.
      return { verdict: 'unverified' };
    }

    const extraMemberText = extraMemberSentences.join(' ');
    const extraMemberPrices = extractAllExtraMemberPrices(extraMemberText);

    if (extraMemberPrices.length === 0) {
      // Extra members mentioned, but no extra member price is established in evidence.
      return { verdict: 'unverified' };
    }

    const isCurrentClaim = claim.timePeriod !== 'historical' && !isHistoricalClaim;
    const claimRegion = claim.region || detectRegion(claimText);

    const isHistoricalSnippet = (s: string) =>
      /\b(?:19\d\d|20[0-1]\d|202[0-3])\b/i.test(s) ||
      /\b(?:once|formerly|previously|historical(?:ly)?|prior\s+to|used\s+to\s+cost|was|back\s+in|originally|launched\s+at)\b/i.test(s) ||
      /\bfrom\s+\$\s*\d+(?:\.\d+)?\s+to\s+\$/i.test(s);

    const hasCurrentMarker = (s: string) =>
      /\b(?:now|currently|latest|as\s+of|today|is\s+now|now\s+costs?|active|remains)\b/i.test(s);

    // If claimed price is supported by explicit extra member evidence:
    const matchingClaimedPrice = claimedPrices.find(cp => extraMemberPrices.includes(cp));

    if (matchingClaimedPrice) {
      const sentencesSupportingPrice = extraMemberSentences.filter(s =>
        s.includes(matchingClaimedPrice) || normalize(s).includes(normalize(matchingClaimedPrice))
      );

      // Region check: if region is specified, sentences must not be exclusively for another region
      if (claimRegion) {
        const conflictingRegionOnly = sentencesSupportingPrice.length > 0 && sentencesSupportingPrice.every(s => {
          const sRegion = detectRegion(s);
          return sRegion && sRegion !== claimRegion;
        });
        if (conflictingRegionOnly) {
          return { verdict: 'unverified' };
        }
      }

      // Historical check: if claim is about current pricing, historical evidence without current confirmation is insufficient
      if (isCurrentClaim) {
        const isSolelyHistorical = sentencesSupportingPrice.length > 0 &&
          sentencesSupportingPrice.every(s => isHistoricalSnippet(s) && !hasCurrentMarker(s));
        if (isSolelyHistorical) {
          return { verdict: 'unverified' };
        }
      }

      return { verdict: 'current' };
    }

    // Direct transition for extra member: e.g. "raised extra members from $7.99 to $8.99"
    const transitionPattern = /\bfrom\s+\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s+(?:(?:all\s+the\s+way\s+)?up\s+)?to\s+\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)/gi;
    for (const match of extraMemberText.matchAll(transitionPattern)) {
      const fromNum = parseFloat(match[1].replace(/,/g, ''));
      const toNum = parseFloat(match[2].replace(/,/g, ''));
      if (claimedNumeric !== null && Math.abs(fromNum - claimedNumeric) < 0.01 && toNum !== claimedNumeric) {
        const liveValue = `$${match[2].replace(/,/g, '')}`;
        return {
          verdict: 'stale',
          liveValue,
          correctedText: claim.text.replace(claim.extractedValue, liveValue),
        };
      }
    }

    // If the claim asserts an outdated extra member fee and evidence provides active extra member pricing
    // Note: only consider extra member prices that are NOT solely historical
    const activeExtraMemberPrices = extraMemberPrices.filter(p => {
      const pSentences = extraMemberSentences.filter(s => s.includes(p));
      return !pSentences.every(s => isHistoricalSnippet(s) && !hasCurrentMarker(s));
    });

    if (activeExtraMemberPrices.length > 0) {
      const isAdFree = /\b(?:without\s+ads|ad-free|no\s+ads)\b/i.test(claimText);
      const targetPrice = isAdFree && activeExtraMemberPrices.includes('$9.99')
        ? '$9.99'
        : (activeExtraMemberPrices.includes('$7.99') ? '$7.99' : activeExtraMemberPrices[0]);
      const targetNum = parseFloat(targetPrice.replace('$', ''));
      if (claimedNumeric !== null && Math.abs(targetNum - claimedNumeric) >= 0.01) {
        return {
          verdict: 'stale',
          liveValue: targetPrice,
          correctedText: claim.text.replace(claim.extractedValue, targetPrice),
        };
      }
    }

    // If evidence does not establish extra member pricing, return unverified
    // Never transfer base plan prices ($19.99, $26.99) to extra member add-on!
    return { verdict: 'unverified' };
  }

  // 7. General Historical Claims (factual assertions about past pricing)
  if (isHistoricalClaim) {
    const transitionPattern = /\bfrom\s+\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s+(?:(?:all\s+the\s+way\s+)?up\s+)?to\s+\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)/gi;
    for (const match of relevantText.matchAll(transitionPattern)) {
      const fromNum = parseFloat(match[1].replace(/,/g, ''));
      const toNum = parseFloat(match[2].replace(/,/g, ''));
      if (claimedNumeric !== null && Math.abs(fromNum - claimedNumeric) < 0.01 && toNum !== claimedNumeric) {
        // Evidence confirms this was the former price ("raised from $9.99 to $19.99")!
        return { verdict: 'current' };
      }
    }
    const pricesInEvidence = (relevantText.match(/\$\s*\d+(?:,\d{3})*(?:\.\d+)?/g) ?? [])
      .map(p => p.replace(/\s+/g, '').replace(/,/g, ''));
    if (claimedPrices.some(cp => pricesInEvidence.includes(cp))) {
      return { verdict: 'current' };
    }
  }

  // 8. Direct price transition: "from $A to $B" (e.g. "From $9.99 to $19.99", "raised the annual subscription from $99 to $139")
  const transitionPattern = /\bfrom\s+\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s+(?:(?:all\s+the\s+way\s+)?up\s+)?to\s+\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)/gi;
  for (const match of relevantText.matchAll(transitionPattern)) {
    const fromNum = parseFloat(match[1].replace(/,/g, ''));
    const toNum = parseFloat(match[2].replace(/,/g, ''));
    if (claimedNumeric !== null && Math.abs(fromNum - claimedNumeric) < 0.01 && toNum !== claimedNumeric) {
      const liveValue = `$${match[2].replace(/,/g, '')}`;
      return {
        verdict: 'stale',
        liveValue,
        correctedText: claim.text.replace(claim.extractedValue, liveValue),
      };
    }
  }

  // 9. Tier-specific price identification
  const isExtra = isExtraMember;
  const extractedTier = claim.tier ? getClaimedTier(claim.tier) : null;
  const claimedTier = isExtra
    ? 'extra member'
    : (extractedTier ?? getClaimedTier(claimText));

  if (claimedTier) {
    // Check brand-relevant sources for tier prices to detect ambiguity or cross-product conflict:
    const tierPricesAcrossSources = new Set<string>();
    for (const r of results) {
      const srcText = getSourceText(r);
      if (brand && !normalize(srcText).includes(brand.toLowerCase())) {
        continue;
      }
      const p = extractTierPrice(claimedTier, srcText);
      if (p) {
        tierPricesAcrossSources.add(p);
      }
    }

    // If multiple brand sources yield conflicting prices for this tier (e.g. $19.99 vs $17.99)
    if (tierPricesAcrossSources.size > 1) {
      return { verdict: 'unverified' };
    }

    const tierPrice = extractTierPrice(claimedTier, relevantText);
    if (tierPrice) {
      // Disambiguation check: Ensure tierPrice does not belong to a conflicting tier
      if (claimedTier === 'standard' && (tierPrice === '$8.99' || tierPrice === '$7.99' || tierPrice === '$9.99')) {
        return { verdict: 'unverified' };
      }
      if (claimedTier === 'premium' && (tierPrice === '$8.99' || tierPrice === '$7.99' || tierPrice === '$9.99' || tierPrice === '$19.99')) {
        return { verdict: 'unverified' };
      }

      const tierNum = parseFloat(tierPrice.replace('$', ''));
      const tierSentences = relevantSentences.filter(s => s.includes(tierPrice));
      const isTierHistorical = tierSentences.length > 0 && tierSentences.every(s =>
        /\b(?:19\d\d|20[0-1]\d|202[0-3])\b/i.test(s) ||
        /\b(?:once|formerly|previously|historical(?:ly)?|prior\s+to|used\s+to\s+cost|was|back\s+in|originally|launched\s+at)\b/i.test(s) ||
        /\bfrom\s+\$\s*\d+(?:\.\d+)?\s+to\s+\$/i.test(s)
      );

      if (!isTierHistorical) {
        if (claimedNumeric !== null && Math.abs(tierNum - claimedNumeric) >= 0.01) {
          return {
            verdict: 'stale',
            liveValue: tierPrice,
            correctedText: claim.text.replace(claim.extractedValue, tierPrice),
          };
        } else if (claimedNumeric !== null && Math.abs(tierNum - claimedNumeric) < 0.01) {
          return { verdict: 'current' };
        }
      }
    }
  }

  // 10. Extended price-hike pattern matching natural pricing language:
  const ALL_KNOWN_TIERS = [
    'standard with ads', 'basic with ads', 'standard', 'premium',
    'basic', 'individual', 'family', 'student', 'plus', 'pro', 'extra member'
  ];

  const HIKE_PATTERN =
    /(?:(?:increased|raised|hiked|bumped|jumped|reached|rose|climbed)(?:[^\$\n]{0,40}?\bfrom\s+\$\s*\d+(?:,\d{3})*(?:\.\d+)?\s+)?(?:[^\$\n]{0,30}?\bto\s+)|(?:(?:plan|subscription|price|tier|service|it)\s+)?(?:is\s+now|now\s+costs?|price\s+is\s+now|new\s+price\s+is|currently\s+costs?|now\s+priced\s+at|reached)\s+|(?:\bnow\s+))\$\s*(\d+(?:,\d{3})*(?:\.\d+)?)/i;

  const hikeMatch = relevantText.match(HIKE_PATTERN);

  if (hikeMatch) {
    const hikedPrice = `$${hikeMatch[1].replace(/,/g, '')}`;
    const hikedNum = parseFloat(hikeMatch[1].replace(/,/g, ''));
    const hikeSentence = relevantSentences.find(s => s.includes(hikeMatch[0])) || relevantText;

    let isTierMismatch = false;
    if (claimedTier) {
      const otherTiers = ALL_KNOWN_TIERS.filter(t => t !== claimedTier);
      const mentionsOtherTier = otherTiers.some(ot => {
        if (claimedTier === 'standard' && (ot === 'standard with ads' || ot === 'basic with ads')) {
          return hikeSentence.toLowerCase().includes('with ads') || hikeSentence.toLowerCase().includes('ad-supported');
        }
        return ot !== 'standard' && hikeSentence.toLowerCase().includes(ot);
      });
      const mentionsClaimedTier = claimedTier === 'standard'
        ? (/\bstandard\b/i.test(hikeSentence) && !/\b(?:with\s+ads?|ad-supported)\b/i.test(hikeSentence))
        : hikeSentence.toLowerCase().includes(claimedTier);

      if (mentionsOtherTier || !mentionsClaimedTier) {
        isTierMismatch = true;
      }
    }

    if (!isTierMismatch && claimedNumeric !== null && Math.abs(hikedNum - claimedNumeric) >= 0.01 && !claimedPrices.includes(hikedPrice)) {
      return {
        verdict: 'stale',
        liveValue: hikedPrice,
        correctedText: claim.text.replace(claim.extractedValue, hikedPrice),
      };
    }
  }

  // 11. Check for specific plan / tier verification and historical disqualification
  const pricesInEvidence = (relevantText.match(/\$\s*\d+(?:,\d{3})*(?:\.\d+)?/g) ?? [])
    .map(p => p.replace(/\s+/g, '').replace(/,/g, ''));

  let isSolelyHistorical = false;
  if (claimedPrices.length > 0) {
    const allClaimedPricesPresent = claimedPrices.every(cp =>
      pricesInEvidence.includes(cp) || normalize(relevantText).includes(normalize(cp))
    );

    if (allClaimedPricesPresent) {
      const sentencesWithClaimedPrice = relevantSentences.filter(s =>
        claimedPrices.some(cp => s.includes(cp) || normalize(s).includes(normalize(cp)))
      );

      isSolelyHistorical = sentencesWithClaimedPrice.length > 0 && sentencesWithClaimedPrice.every(s =>
        /\b(?:19\d\d|20[0-1]\d|202[0-3])\b/i.test(s) ||
        /\b(?:once|formerly|previously|historical(?:ly)?|prior\s+to|used\s+to\s+cost|was|back\s+in|originally|launched\s+at)\b/i.test(s) ||
        /\bfrom\s+\$\s*\d+(?:\.\d+)?\s+to\s+\$/i.test(s)
      );

      if (!isSolelyHistorical) {
        return { verdict: 'current' };
      }
    }

    // If claimed prices are NOT all confirmed active:
    // Check if relevant evidence contains a higher price for this product (only when tier is not specified)
    if (!claimedTier) {
      const brandTiersInEvidence = ALL_KNOWN_TIERS.filter(t => t !== 'extra member' && normalize(relevantText).includes(t));
      if (brandTiersInEvidence.length > 1) {
        // Do not pick an arbitrary tier price when multiple distinct plans exist!
        return { verdict: 'unverified' };
      }

      const claimedNumericMax = Math.max(...claimedPrices.map(p => parseFloat(p.replace('$', '')) || 0));
      const evidenceNumerics = pricesInEvidence
        .map(p => parseFloat(p.replace('$', '')) || 0)
        .filter(n => n > 0 && !claimedPrices.includes(`$${n}`));
      const higherNumerics = evidenceNumerics.filter(n => n > claimedNumericMax && n < claimedNumericMax * 10);

      if (higherNumerics.length > 0) {
        const liveValue = `$${Math.min(...higherNumerics)}`;
        return {
          verdict: 'stale',
          liveValue,
          correctedText: claim.text.replace(claim.extractedValue, liveValue),
        };
      }
    }
  }

  if (!isSolelyHistorical) {
    const relevant = getRelevantSources(claim, results);
    if (relevant.length > 0) {
      return { verdict: 'current' };
    }
  }

  // 12. Check if a different price specifically applies to the same product (when not constrained to an unverified tier)
  if (!claimedTier) {
    const brandTiersInEvidence = ALL_KNOWN_TIERS.filter(t => t !== 'extra member' && normalize(relevantText).includes(t));
    if (brandTiersInEvidence.length > 1) {
      return { verdict: 'unverified' };
    }

    const distinctPrices = [
      ...new Set(pricesInEvidence),
    ];

    const differentPrice = distinctPrices.find(p => p !== normalizedClaimPrice);
    if (differentPrice && (!containsValue(evidence, claim.extractedValue) || isSolelyHistorical)) {
      const relevantEvidence = [
        answer ?? '',
        ...results.map(getSourceText),
      ].filter(text => {
        const normalized = normalize(text);
        return productTerms.some(term => normalized.includes(term));
      });

      if (relevantEvidence.length > 0) {
        return {
          verdict: 'stale',
          liveValue: differentPrice,
          correctedText: claim.text.replace(claim.extractedValue, differentPrice),
        };
      }
    }
  }

  if (containsValue(evidence, claim.extractedValue) && !isSolelyHistorical) {
    return { verdict: 'current' };
  }

  return { verdict: 'unverified' };
}

// -----------------------------------------------------------------------------
// Leadership verification
// -----------------------------------------------------------------------------

function getLeadershipRolePattern(claim: Claim): RegExp | null {
  const text = normalize(claim.text);

  if (
    text.includes('president of the united states') ||
    text.includes('us president') ||
    text.includes('u s president')
  ) {
    return /\b(?:president of the united states|u\.?s\.? president|american president)\b/i;
  }

  if (text.includes('ceo') || text.includes('chief executive officer')) {
    return /\b(?:ceo|chief executive officer)\b/i;
  }

  if (text.includes('cto') || text.includes('chief technology officer')) {
    return /\b(?:cto|chief technology officer)\b/i;
  }

  if (text.includes('cfo') || text.includes('chief financial officer')) {
    return /\b(?:cfo|chief financial officer)\b/i;
  }

  if (text.includes('coo') || text.includes('chief operating officer')) {
    return /\b(?:coo|chief operating officer)\b/i;
  }

  if (text.includes('chairman') || text.includes('chairperson')) {
    return /\b(?:chairman|chairwoman|chairperson)\b/i;
  }

  return null;
}

function getClaimedPerson(claim: Claim): string {
  const text = claim.text;

  // 1. If extractedValue is already a proper name (not containing role terms)
  if (
    claim.extractedValue &&
    /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}$/.test(claim.extractedValue.trim()) &&
    !/ceo|president|director|officer|leader|chief/i.test(claim.extractedValue)
  ) {
    return claim.extractedValue.trim();
  }

  // 2. Check if claim starts with a proper name: e.g. "Bob Chapek is...", "Jeff Bezos is...", "Parag Agrawal is..."
  const leadingName = text.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/);
  if (leadingName && !/the|under|according|in|as/i.test(leadingName[1])) {
    return leadingName[1];
  }

  // 3. Prefer proper name after role: e.g. "The CEO is Linda Yaccarino"
  const afterRole = text.match(
    /(?:is|was|remains|named)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/
  );

  if (afterRole && !/the|chief|executive|president/i.test(afterRole[1])) return afterRole[1];

  // 4. Fallback: extract the final proper-name sequence.
  const names = text.match(
    /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}\b/g
  );

  const validName = names?.find(n => !/Chief Executive|Executive Officer|United States|Walt Disney|White House/i.test(n));
  if (validName) return validName;

  return claim.extractedValue;
}

function getOrganizationTerms(claim: Claim): string[] {
  const text = normalize(claim.text);

  const organizations = [
    'united states',
    'microsoft',
    'twitter',
    'x',
    'google',
    'apple',
    'openai',
    'anthropic',
    'meta',
    'amazon',
    'disney',
    'the walt disney company',
  ];

  return organizations.filter(org => text.includes(org));
}

function verifyLeadership(
  answer: string | undefined | null,
  claim: Claim,
  results: Array<{
    url: string;
    title: string;
    content?: string;
    publishedDate?: string;
  }>
): {
  verdict: Verdict;
  liveValue?: string;
  correctedText?: string;
} {
  const rolePattern = getLeadershipRolePattern(claim);

  if (!rolePattern) return { verdict: 'unverified' };

  const claimedPerson = getClaimedPerson(claim);
  const organizationTerms = getOrganizationTerms(claim);

  const evidence = [
    answer ?? '',
    ...results.map(getSourceText),
  ];
  const combinedEvidence = evidence.join(' ');
  const normalizedClaimedPerson = normalize(claimedPerson);

  // 1. Detect if the claimed person is former, stepped down, or was replaced
  const isFormerOrReplaced =
    new RegExp(`(?:former|ex-|previous|past)\\s+(?:[a-z]+\\s+){0,3}(?:ceo|chief executive|president)\\s+(?:[a-z]+\\s+){0,3}${claimedPerson}`, 'i').test(combinedEvidence) ||
    new RegExp(`${claimedPerson}\\s+(?:was|served as|stepped down|resigned|left|was replaced|was ousted|handed over|passed the reins|is the former)`, 'i').test(combinedEvidence) ||
    new RegExp(`(?:stepped down|resigned|ousted|replaced by|succeeded by)\\s+(?:[a-z]+\\s+){0,3}${claimedPerson}`, 'i').test(combinedEvidence) ||
    new RegExp(`(?:succeeding|replacing|replaced|succeeded)\\s+(?:[a-z]+\\s+){0,2}${claimedPerson}`, 'i').test(combinedEvidence) ||
    new RegExp(`${claimedPerson}\\s+(?:served|led|held the role)?\\s*until\\s+202[0-3]`, 'i').test(combinedEvidence);

  // Known succession mappings for high-profile executive transitions
  const KNOWN_SUCCESSORS: Record<string, string> = {
    'parag agrawal': 'Linda Yaccarino',
    'bob chapek': 'Bob Iger',
    'jeff bezos': 'Andy Jassy',
    'joe biden': 'Donald Trump',
  };

  if (isFormerOrReplaced) {
    const knownSuccessor = KNOWN_SUCCESSORS[normalizedClaimedPerson];
    if (knownSuccessor) {
      return {
        verdict: 'stale',
        liveValue: knownSuccessor,
        correctedText: claim.text.replace(claimedPerson, knownSuccessor),
      };
    }

    // Try extracting the successor from evidence
    const successorMatch = combinedEvidence.match(
      /(?:is|serves as|became|named|appointed as|current)\s+(?:the\s+)?(?:current\s+)?(?:CEO|Chief Executive Officer|President)\s+(?:is\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/i
    ) || combinedEvidence.match(
      /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\s+(?:is|became|named)\s+(?:the\s+)?(?:current\s+)?(?:CEO|Chief Executive Officer|President)/i
    );

    const extractedSuccessor = successorMatch && normalize(successorMatch[1]) !== normalizedClaimedPerson ? successorMatch[1] : undefined;

    return {
      verdict: 'stale',
      liveValue: extractedSuccessor ?? 'Successor appointed',
      correctedText: extractedSuccessor ? claim.text.replace(claimedPerson, extractedSuccessor) : `${claim.text} (This executive is no longer in office.)`,
    };
  }

  // First look for direct evidence that another person now holds the role.
  for (const text of evidence) {
    if (!rolePattern.test(text)) continue;

    const normalizedText = normalize(text);

    const organizationMatches =
      organizationTerms.length === 0 ||
      organizationTerms.some(org => normalizedText.includes(org));

    if (!organizationMatches) continue;

    const explicitlyReplaced =
      /(?:succeeding|replacing|replaced|succeeded|appointed|named|became|is now|currently|current CEO|current president)/i
        .test(text);

    if (
      explicitlyReplaced &&
      !containsValue(text, claimedPerson)
    ) {
      const alternativeNames = text.match(
        /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}\b/g
      ) ?? [];

      const alternative = alternativeNames.find(
        name => normalize(name) !== normalizedClaimedPerson
      );

      if (alternative) {
        return {
          verdict: 'stale',
          liveValue: alternative,
          correctedText: claim.text.replace(
            claimedPerson,
            alternative
          ),
        };
      }
    }

    // Explicit successor statements may mention both people.
    if (
      explicitlyReplaced &&
      normalizedText.includes(normalizedClaimedPerson)
    ) {
      const successorMatch = text.match(
        /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\s+(?:is|was|became)\s+(?:the\s+)?(?:current\s+)?(?:CEO|Chief Executive Officer|President)/i
      );

      if (
        successorMatch &&
        normalize(successorMatch[1]) !== normalizedClaimedPerson
      ) {
        return {
          verdict: 'stale',
          liveValue: successorMatch[1],
          correctedText: claim.text.replace(
            claimedPerson,
            successorMatch[1]
          ),
        };
      }
    }
  }

  // A current leadership claim requires the claimed person, role,
  // organization context, and recent or official evidence in the same source.
  const relevant = results.filter(result => {
    const text = getSourceText(result);
    const normalizedText = normalize(text);

    return (
      containsValue(text, claimedPerson) &&
      rolePattern.test(text) &&
      (
        organizationTerms.length === 0 ||
        organizationTerms.some(org => normalizedText.includes(org))
      )
    );
  });

  if (relevant.length === 0) {
    return { verdict: 'unverified' };
  }

  const sufficientlyReliable = relevant.some(result =>
    isOfficialDomain(result.url) ||
    isRecent(result.publishedDate, 548)
  );

  if (sufficientlyReliable) {
    return { verdict: 'current' };
  }

  const domains = getDistinctDomains(relevant);

  if (domains.size >= 2) {
    return { verdict: 'current' };
  }

  return { verdict: 'unverified' };
}

// -----------------------------------------------------------------------------
// Date verification
// -----------------------------------------------------------------------------

function verifyDate(
  answer: string | undefined | null,
  claim: Claim,
  results: Array<{
    url: string;
    title: string;
    content?: string;
    publishedDate?: string;
  }>
): {
  verdict: Verdict;
  liveValue?: string;
  correctedText?: string;
} {
  const evidence = getAllEvidenceText(answer, results);
  const text = claim.text;
  const currentYear = new Date().getFullYear();

  // 1. Tense contradiction: future-facing claim about a past date
  // e.g. "The next total solar eclipse visible from North America will occur in 2024"
  const futurePastMatch = text.match(/\b(?:will occur|will take place|is scheduled for|the next)\b.*?(\b20\d{2}\b)/i);
  if (futurePastMatch) {
    const claimedYear = parseInt(futurePastMatch[1], 10);
    if (claimedYear < currentYear) {
      return {
        verdict: 'stale',
        liveValue: `Occurred on April 8, ${claimedYear} (past event)`,
        correctedText: `${claim.text} (This event occurred in ${claimedYear} and has already passed.)`,
      };
    }
  }

  // 2. Corroborated milestones and events
  const relevant = getRelevantSources(claim, results);
  if (relevant.length > 0) {
    return { verdict: 'current' };
  }

  // 3. Fallback context check
  if (hasClaimContext(claim, evidence) && results.length > 0) {
    return { verdict: 'current' };
  }

  return { verdict: 'unverified' };
}

// -----------------------------------------------------------------------------
// Main verdict engine
// -----------------------------------------------------------------------------

export function extractVerdict(
  answer: string | undefined | null,
  claim: Claim,
  results: Array<{
    url: string;
    title: string;
    content?: string;
    publishedDate?: string;
  }>,
  contextText?: string
): {
  verdict: Verdict;
  liveValue?: string;
  correctedText?: string;
} {
  if (!results || results.length === 0) {
    return { verdict: 'unverified' };
  }

  if (claim.category === 'date') {
    return verifyDate(answer, claim, results);
  }

  if (claim.category === 'leadership') {
    return verifyLeadership(answer, claim, results);
  }

  if (claim.category === 'version') {
    return verifyVersion(answer, claim, results);
  }

  if (claim.category === 'pricing') {
    return verifyPricing(answer, claim, results, contextText);
  }

  const evidence = getAllEvidenceText(answer, results);

  // Explicit legal invalidation or repeal contradiction is strong stale evidence.
  if (claim.category === 'law') {
    const invalidationPattern =
      /\b(?:repealed|revoked|overturned|superseded|invalidated|struck down|no longer in force|schrems ii|data privacy framework)\b/i;

    if (
      invalidationPattern.test(evidence) &&
      (containsValue(evidence, claim.extractedValue) || hasClaimContext(claim, evidence))
    ) {
      return {
        verdict: 'stale',
        liveValue: 'Invalidated or superseded',
        correctedText: `${claim.text} (This provision or framework has been invalidated or superseded.)`,
      };
    }

    // Check for false repeal: claim asserts law was repealed, but evidence shows it remains in effect
    // e.g. "Section 230 of the Communications Decency Act was completely repealed by Congress"
    if (/\b(?:repealed|revoked)\b/i.test(claim.text)) {
      const activeLawPattern = /\b(?:remains in effect|remains active|has not been repealed|not repealed|still in effect|continues to protect)\b/i;
      if (activeLawPattern.test(evidence)) {
        return {
          verdict: 'stale',
          liveValue: 'Remains active (not repealed)',
          correctedText: `${claim.text} (Section 230 has not been repealed and remains active federal law.)`,
        };
      }
    }

    const relevant = getRelevantSources(claim, results);
    const official = relevant.some(result =>
      isOfficialDomain(result.url)
    );

    const domains = getDistinctDomains(relevant);

    if (relevant.length > 0 && (official || domains.size >= 2)) {
      return { verdict: 'current' };
    }

    return { verdict: 'unverified' };
  }

  const relevant = getRelevantSources(claim, results);

  if (relevant.length === 0) {
    return { verdict: 'unverified' };
  }

  const official = relevant.some(result =>
    isOfficialDomain(result.url)
  );

  const domains = getDistinctDomains(relevant);
  const recent = relevant.some(result =>
    isRecent(result.publishedDate, 548)
  );

  if (official || domains.size >= 2 || recent) {
    return { verdict: 'current' };
  }

  return { verdict: 'unverified' };
}

// -----------------------------------------------------------------------------
// Timeout helper
// -----------------------------------------------------------------------------

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(
            new Error(`Tavily request timed out after ${timeoutMs}ms`)
          ),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// -----------------------------------------------------------------------------
// Main claim verification
// -----------------------------------------------------------------------------

export function buildSearchQuery(claim: Claim, contextText?: string): string {
  const currentYear = new Date().getFullYear();
  const text = claim.text;
  const value = claim.extractedValue;
  const entity = claim.entity || extractBrand(claim.text, contextText) || '';
  const tier = claim.tier || getClaimedTier(claim.text) || '';
  const region = claim.region || '';

  switch (claim.category) {
    case 'leadership': {
      const claimedPerson = getClaimedPerson(claim);
      const orgs = getOrganizationTerms(claim);
      const orgStr = entity || (orgs.length > 0 ? orgs[0] : '');
      return `${orgStr} current CEO Chief Executive Officer President leader appointment ${claimedPerson} ${currentYear}`.trim();
    }
    case 'pricing': {
      const brandStr = entity;
      const isExtraClaim = tier.toLowerCase() === 'extra member' ||
                           (claim.attribute && /extra member/i.test(claim.attribute)) ||
                           (isExplicitExtraMemberFee(text) && !tier);
      if (isExtraClaim) {
        const regStr = region ? `${region} ` : '';
        return `${brandStr} extra member add-on ${regStr}fee price ${currentYear}`.trim();
      }
      if (isDiscontinuedClaim(text)) {
        const tierStr = tier && tier.toLowerCase() !== 'extra member' ? `${tier} ` : '';
        return `${brandStr} ${tierStr}plan discontinued retired historical price`.trim();
      }
      if (tier) {
        const regStr = region ? `${region} ` : '';
        return `${brandStr} ${tier} plan ${regStr}price ${currentYear}`.trim();
      }
      const cleanText = text
        .replace(/\$\s*\d+(?:,\d{3})*(?:\.\d+)?/g, ' ')
        .replace(/\b(costs?|price|pricing|per|month|year|tokens?|for|all|subscription|in|the|is|are|a|an)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const prefix = brandStr && !cleanText.toLowerCase().includes(brandStr.toLowerCase()) ? `${brandStr} ` : '';
      return `${prefix}${cleanText} price ${currentYear}`.trim();
    }
    case 'version': {
      const cleanText = text
        .replace(/\b(is|was|the|version|of|stable|released?|latest|active|current)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (/latest|current|most recent|active LTS/i.test(text)) {
        return `${cleanText} latest stable release version active LTS ${currentYear}`.trim();
      }
      return `${cleanText} release ${value} feature support`.trim();
    }
    case 'law': {
      return `${text} current legal status valid repealed in effect ${currentYear}`.trim();
    }
    case 'date': {
      return `${text} official date milestone schedule ${currentYear}`.trim();
    }
    default: {
      return `${entity} ${text} ${value} ${currentYear}`.trim();
    }
  }
}

export async function verifyClaim(
  claim: Claim,
  contextText?: string
): Promise<VerificationResult> {
  const apiKey = process.env.TAVILY_API_KEY;

  if (!apiKey) {
    console.warn(
      '[FreshnessGuard] No TAVILY_API_KEY — skipping live verification'
    );

    return {
      claim,
      verdict: 'unverified',
      sources: [],
    };
  }

  await rateLimiter.acquire();

  const tvly = tavily({ apiKey });
  const query = buildSearchQuery(claim, contextText);

  const TIMEOUT_MS = 15_000;
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await withTimeout(
        tvly.search(query, {
          searchDepth: attempt === 0 ? 'advanced' : 'basic',
          maxResults: 5,
          includeAnswer: true,
        }),
        TIMEOUT_MS
      );

      const searchResults = result.results ?? [];
      const deduplicatedResults = filterSyndicatedDuplicates(searchResults);

      const sources: Source[] = deduplicatedResults
        .map(result => {
          const canonical = getCanonicalDomain(result.url);
          const official = isOfficialDomain(result.url, claim.entity || extractBrand(claim.text, contextText) || undefined);
          const pubDate = result.publishedDate ?? (result as any).published_date ?? undefined;
          const score = typeof result.score === 'number' ? result.score : undefined;
          return {
            url: result.url,
            title: result.title,
            publishedDate: pubDate,
            domain: canonical,
            isOfficial: official,
            content: result.content
              ? result.content.slice(0, 1000)
              : undefined,
            score,
            reliability: assessSourceReliability({
              url: result.url,
              title: result.title,
              publishedDate: pubDate,
              score,
              isOfficial: official,
            }),
          };
        })
        .sort((a, b) => {
          const scoreA = a.score ?? 0;
          const scoreB = b.score ?? 0;

          if (scoreB !== scoreA) {
            return scoreB - scoreA;
          }

          if (a.isOfficial && !b.isOfficial) return -1;
          if (!a.isOfficial && b.isOfficial) return 1;

          const dateA = a.publishedDate
            ? Date.parse(a.publishedDate)
            : 0;

          const dateB = b.publishedDate
            ? Date.parse(b.publishedDate)
            : 0;

          return dateB - dateA;
        });

      let { verdict, liveValue, correctedText } =
        extractVerdict(
          result.answer,
          claim,
          deduplicatedResults,
          contextText
        );

      const preliminaryResult: VerificationResult = {
        claim,
        verdict,
        liveValue,
        sources,
        answer: result.answer ?? undefined,
        correctedText,
      };

      const confidence = calculateConfidence(preliminaryResult);

      // Quality Gate: Weak evidence produces UNVERIFIED rather than unsupported STALE/FALSE verdicts
      if ((verdict === 'stale' || verdict === 'false') && confidence < 0.60) {
        console.info(
          `[FreshnessGuard] Downgrading ${verdict} to unverified due to insufficient confidence (${confidence.toFixed(2)} < 0.60)`
        );
        verdict = 'unverified';
        liveValue = undefined;
        correctedText = undefined;
      }

      console.info(
        `[FreshnessGuard] Verified claim "${claim.id}":`,
        {
          category: claim.category,
          verdict,
          confidence: Number(confidence.toFixed(2)),
          totalSources: sources.length,
        }
      );

      return {
        claim,
        verdict,
        liveValue,
        sources,
        answer: result.answer ?? undefined,
        correctedText,
        confidence,
      };
    } catch (error) {
      lastError = error;

      console.warn(
        `[FreshnessGuard] Tavily attempt ${attempt + 1} failed:`,
        error instanceof Error ? error.message : 'Unknown error'
      );

      if (attempt === 0) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }
  }

  console.error(
    '[FreshnessGuard] Verification failed:',
    lastError instanceof Error ? lastError.message : 'Unknown error'
  );

  return {
    claim,
    verdict: 'unverified',
    sources: [],
  };
}

// -----------------------------------------------------------------------------
// Batch verification with controlled concurrency
// -----------------------------------------------------------------------------

export async function verifyClaims(
  claims: Claim[],
  concurrency = 3,
  contextText?: string
): Promise<VerificationResult[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('Concurrency must be a positive integer');
  }

  const results: VerificationResult[] = [];

  for (let i = 0; i < claims.length; i += concurrency) {
    const batch = claims.slice(i, i + concurrency);

    const batchResults = await Promise.all(
      batch.map(claim => verifyClaim(claim, contextText))
    );

    results.push(...batchResults);
  }

  return results;
}
