
import { tavily } from '@tavily/core';
import axios from 'axios';
import { Agent as HttpsAgent } from 'node:https';
import type {
  Claim,
  Source,
  Verdict,
  VerificationResult,
} from '../types/index';

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
]);

export function isOfficialDomain(url: string): boolean {
  try {
    const host = new URL(url).hostname
      .toLowerCase()
      .replace(/^www\./, '');

    if (OFFICIAL_TLD_PATTERN.test(host)) return true;

    return [...KNOWN_OFFICIAL_DOMAINS].some(
      domain => host === domain || host.endsWith(`.${domain}`)
    );
  } catch {
    return false;
  }
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return url;
  }
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
    results.map(result => extractDomain(result.url)).filter(Boolean)
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
}): string {
  return `${result.title} ${result.content ?? ''}`;
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
    .filter(Boolean);

  return normalize(claim.text)
    .split(' ')
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
  const pa = a.replace(/^v/i, '').split('.').map(Number);
  const pb = b.replace(/^v/i, '').split('.').map(Number);

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
  const claimVersion = claim.extractedValue
    .replace(/^v/i, '')
    .trim();

  const versions = evidence.match(/\bv?\d+\.\d+(?:\.\d+)?\b/g) ?? [];

  const distinctVersions = [
    ...new Set(
      versions.map(version => version.replace(/^v/i, ''))
    ),
  ].filter(version => version !== claimVersion);

  const newerVersions = distinctVersions
    .filter(version => compareVersions(version, claimVersion) > 0)
    .sort((a, b) => compareVersions(b, a));

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

function verifyPricing(
  answer: string | undefined | null,
  claim: Claim,
  results: Array<{ url: string; title: string; content?: string }>
): {
  verdict: Verdict;
  liveValue?: string;
  correctedText?: string;
} {
  const evidence = getAllEvidenceText(answer, results);
  const context = normalize(claim.text);

  // Do not compare prices from unrelated products.
  const productTerms = getContextTerms(claim).filter(
    term => !/^\d+(?:\.\d+)?$/.test(term)
  );

  if (
    productTerms.length > 0 &&
    !productTerms.some(term => normalize(evidence).includes(term))
  ) {
    return { verdict: 'unverified' };
  }

  const prices = evidence.match(/\$\s*\d+(?:,\d{3})*(?:\.\d+)?/g) ?? [];

  const normalizedClaimPrice = claim.extractedValue
    .replace(/\s+/g, '')
    .replace(/,/g, '');

  const distinctPrices = [
    ...new Set(prices.map(price =>
      price.replace(/\s+/g, '').replace(/,/g, '')
    )),
  ];

  const differentPrice = distinctPrices.find(
    price => price !== normalizedClaimPrice
  );

  if (differentPrice) {
    // Only accept a changed price when the evidence also discusses
    // the claimed product or service.
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
        correctedText: claim.text.replace(
          claim.extractedValue,
          differentPrice
        ),
      };
    }
  }

  const relevant = getRelevantSources(claim, results);

  if (relevant.length > 0) {
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

  // Prefer the person named immediately after the role assertion.
  const afterRole = text.match(
    /(?:is|was|remains|named)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/
  );

  if (afterRole) return afterRole[1];

  // Fallback: extract the final proper-name sequence.
  const names = text.match(
    /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}\b/g
  );

  if (names?.length) return names[names.length - 1];

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

  // First look for direct evidence that another person now holds the role.
  for (const text of evidence) {
    if (!rolePattern.test(text)) continue;

    const normalizedText = normalize(text);
    const normalizedClaimedPerson = normalize(claimedPerson);

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
  }>
): {
  verdict: Verdict;
  liveValue?: string;
  correctedText?: string;
} {
  if (!results || results.length === 0) {
    return { verdict: 'unverified' };
  }

  if (claim.category === 'date') {
    return { verdict: 'unverified' };
  }

  if (claim.category === 'leadership') {
    return verifyLeadership(answer, claim, results);
  }

  if (claim.category === 'version') {
    return verifyVersion(answer, claim, results);
  }

  if (claim.category === 'pricing') {
    return verifyPricing(answer, claim, results);
  }

  const evidence = getAllEvidenceText(answer, results);

  // Explicit legal invalidation is strong stale evidence.
  if (claim.category === 'law') {
    const invalidationPattern =
      /\b(?:repealed|revoked|overturned|superseded|invalidated|struck down|no longer in force)\b/i;

    if (
      invalidationPattern.test(evidence) &&
      containsValue(evidence, claim.extractedValue)
    ) {
      return {
        verdict: 'stale',
        liveValue: 'Repealed or superseded',
        correctedText: `${claim.text} (This provision may have been repealed or superseded.)`,
      };
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

export async function verifyClaim(
  claim: Claim
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
  const currentYear = new Date().getFullYear();

  const categoryContext: Record<string, string> = {
    pricing: `official current price cost subscription ${currentYear}`,
    version: `official latest stable release version ${currentYear}`,
    leadership: `current office holder role appointment ${currentYear}`,
    law: `official current law regulation status ${currentYear}`,
    date: `date context ${currentYear}`,
    fact: `current factual evidence ${currentYear}`,
  };

  const context =
    categoryContext[claim.category] ??
    `current factual evidence ${currentYear}`;

  const query = [
    `"${claim.text}"`,
    claim.extractedValue,
    context,
  ].join(' ');

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

      const sources: Source[] = searchResults
        .map(result => ({
          url: result.url,
          title: result.title,
          publishedDate:
            result.publishedDate ??
            (result as any).published_date ??
            undefined,
          domain: extractDomain(result.url),
          isOfficial: isOfficialDomain(result.url),
          content: result.content
            ? result.content.slice(0, 1000)
            : undefined,
          score:
            typeof result.score === 'number'
              ? result.score
              : undefined,
        }))
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

      const { verdict, liveValue, correctedText } =
        extractVerdict(
          result.answer,
          claim,
          searchResults
        );

      console.info(
        `[FreshnessGuard] Verified claim "${claim.id}":`,
        {
          category: claim.category,
          verdict,
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
  concurrency = 3
): Promise<VerificationResult[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('Concurrency must be a positive integer');
  }

  const results: VerificationResult[] = [];

  for (let i = 0; i < claims.length; i += concurrency) {
    const batch = claims.slice(i, i + concurrency);

    const batchResults = await Promise.all(
      batch.map(claim => verifyClaim(claim))
    );

    results.push(...batchResults);
  }

  return results;
}
