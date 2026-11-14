import {
  scoreClaim,
  scoreResponse,
  buildCorrectedAnswer,
  calculateConfidence,
  calculateOverallConfidence,
  getResponseSummary,
  authorityScore,
} from '../services/scoring';
import type { VerificationResult, ScoredClaim, Claim } from '../types/index';

const baseClaim: Claim = {
  id: '1', text: 'test', category: 'version', extractedValue: 'v1.0', likelihood: 0.9,
};

function makeResult(overrides: Partial<VerificationResult>): VerificationResult {
  return {
    claim: baseClaim,
    verdict: 'current',
    sources: [],
    ...overrides,
  };
}

const recentDate = new Date().toISOString();
const oldDate    = new Date(Date.now() - 200 * 86_400_000).toISOString(); // 200 days ago

// ─── scoreClaim ───────────────────────────────────────────────────────────────
describe('scoreClaim', () => {
  it('gives high score for current + official + recent + 3 sources', () => {
    const result = makeResult({
      verdict: 'current',
      sources: [
        { url: 'https://docs.example.com', title: 'Docs',   isOfficial: true,  publishedDate: recentDate },
        { url: 'https://api.example.com',  title: 'API',    isOfficial: true,  publishedDate: recentDate },
        { url: 'https://dev.example.com',  title: 'Dev',    isOfficial: true,  publishedDate: recentDate },
      ],
    });
    const score = scoreClaim(result);
    expect(score).toBeGreaterThan(0.85);
  });

  it('gives low score for stale + no sources', () => {
    const result = makeResult({ verdict: 'stale', sources: [] });
    expect(scoreClaim(result)).toBeLessThan(0.25);
  });

  it('caps stale claims at 0.35 so they cannot appear fresh', () => {
    // Even with many good sources, stale verdict must stay <= 0.35
    const result = makeResult({
      verdict: 'stale',
      sources: [
        { url: 'https://docs.example.com', title: 'Docs', isOfficial: true, publishedDate: recentDate, score: 0.99 },
        { url: 'https://api.example.com',  title: 'API',  isOfficial: true, publishedDate: recentDate, score: 0.99 },
        { url: 'https://dev.example.com',  title: 'Dev',  isOfficial: true, publishedDate: recentDate, score: 0.99 },
      ],
    });
    expect(scoreClaim(result)).toBeLessThanOrEqual(0.35);
  });

  it('caps unverified claims at 0.50 so they cannot appear fresh', () => {
    // Even with great sources, unverified verdict must stay <= 0.50
    const result = makeResult({
      verdict: 'unverified',
      sources: [
        { url: 'https://docs.example.com', title: 'Docs', isOfficial: true, publishedDate: recentDate, score: 0.99 },
        { url: 'https://api.example.com',  title: 'API',  isOfficial: true, publishedDate: recentDate, score: 0.99 },
      ],
    });
    expect(scoreClaim(result)).toBeLessThanOrEqual(0.50);
  });

  it('gives mid score for unverified + old sources', () => {
    const result = makeResult({
      verdict: 'unverified',
      sources: [{ url: 'https://example.com', title: 'Old Post', isOfficial: false, publishedDate: oldDate }],
    });
    const score = scoreClaim(result);
    expect(score).toBeGreaterThan(0.2);
    expect(score).toBeLessThan(0.5);
  });

  it('scores undated sources conservatively without NaN', () => {
    const result = makeResult({
      verdict: 'current',
      sources: [{ url: 'https://example.com/undated', title: 'Undated Article', isOfficial: false }],
    });
    const score = scoreClaim(result);
    expect(Number.isNaN(score)).toBe(false);
    expect(score).toBeGreaterThan(0.4);
    expect(score).toBeLessThan(0.85);
  });

  it('handles future-dated source anomalies conservatively', () => {
    const futureDate = new Date(Date.now() + 365 * 86_400_000).toISOString();
    const result = makeResult({
      verdict: 'current',
      sources: [{ url: 'https://example.com/future', title: 'Future Anomaly', isOfficial: false, publishedDate: futureDate }],
    });
    const score = scoreClaim(result);
    expect(Number.isNaN(score)).toBe(false);
    expect(score).toBeLessThan(0.85);
  });

  it('scores unverifiable claims with no sources conservatively low', () => {
    const result = makeResult({ verdict: 'unverified', sources: [] });
    const score = scoreClaim(result);
    expect(score).toBeLessThanOrEqual(0.50);
  });

  it('formula components sum to ≤1', () => {
    const result = makeResult({
      verdict: 'current',
      sources: [{ url: 'https://docs.x.com', title: 'X', isOfficial: true, publishedDate: recentDate }],
    });
    expect(scoreClaim(result)).toBeLessThanOrEqual(1.0);
    expect(scoreClaim(result)).toBeGreaterThanOrEqual(0.0);
  });
});

// ─── authorityScore (relevance blending) ─────────────────────────────────────
describe('authorityScore', () => {
  it('blends Tavily relevance score with domain authority', () => {
    // Official domain + high relevance = higher score than official domain alone
    const withRelevance = authorityScore([
      { url: 'https://docs.example.com', title: 'Docs', isOfficial: true, score: 0.95 },
    ]);
    const withoutRelevance = authorityScore([
      { url: 'https://docs.example.com', title: 'Docs', isOfficial: true },
    ]);
    // Both official; relevance should not decrease score for a genuinely authoritative source
    expect(withRelevance).toBeGreaterThan(0.6);
    expect(withoutRelevance).toBeGreaterThan(0.6);
  });

  it('non-official domain with low relevance score gets lower authority', () => {
    const score = authorityScore([
      { url: 'https://random-blog.net', title: 'Blog', isOfficial: false, score: 0.20 },
    ]);
    expect(score).toBeLessThan(0.60);
  });

  it('returns conservative baseline when no sources', () => {
    expect(authorityScore([])).toBe(0.30);
  });
});

// ─── calculateConfidence ─────────────────────────────────────────────────────
describe('calculateConfidence', () => {
  it('returns low confidence for unverified with no sources', () => {
    const result = makeResult({ verdict: 'unverified', sources: [] });
    expect(calculateConfidence(result)).toBeLessThan(0.30);
  });

  it('returns moderate confidence for unverified with some sources', () => {
    const result = makeResult({
      verdict: 'unverified',
      sources: [{ url: 'https://example.com', title: 'Source', isOfficial: false }],
    });
    expect(calculateConfidence(result)).toBeGreaterThanOrEqual(0.30);
    expect(calculateConfidence(result)).toBeLessThan(0.60);
  });

  it('returns higher confidence for current with official + recent sources', () => {
    const result = makeResult({
      verdict: 'current',
      sources: [
        { url: 'https://docs.example.com', title: 'Docs', isOfficial: true,  publishedDate: recentDate },
        { url: 'https://api.example.com',  title: 'API',  isOfficial: true,  publishedDate: recentDate },
        { url: 'https://dev.example.com',  title: 'Dev',  isOfficial: true,  publishedDate: recentDate },
      ],
    });
    expect(calculateConfidence(result)).toBeGreaterThan(0.65);
  });

  it('stays in [0, 1] range', () => {
    const result = makeResult({
      verdict: 'stale',
      sources: [
        { url: 'https://example.com', title: 'Source', isOfficial: true, publishedDate: recentDate },
      ],
    });
    const c = calculateConfidence(result);
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeLessThanOrEqual(1);
  });
});

// ─── calculateOverallConfidence ───────────────────────────────────────────────
describe('calculateOverallConfidence', () => {
  it('returns 1.0 for empty claims (fully confident no verification needed)', () => {
    expect(calculateOverallConfidence([])).toBe(1.0);
  });

  it('weights confidence by likelihood', () => {
    const claims: ScoredClaim[] = [
      { ...baseClaim, id: '1', likelihood: 0.9, score: 0.9, verdict: 'current', confidence: 0.9 },
      { ...baseClaim, id: '2', likelihood: 0.3, score: 0.0, verdict: 'unverified', confidence: 0.15, category: 'fact', extractedValue: 'x' },
    ];
    const overall = calculateOverallConfidence(claims);
    expect(overall).toBeGreaterThan(0.60);
  });
});

// ─── getResponseSummary ───────────────────────────────────────────────────────
describe('getResponseSummary', () => {
  it('returns no_claims when totalClaims is 0 (not "all verified")', () => {
    const { summaryStatus, summaryMessage } = getResponseSummary(0, 0, 0, 'inline');
    expect(summaryStatus).toBe('no_claims');
    expect(summaryMessage).toContain('No claims');
  });

  it('returns bypassed when mode is bypass', () => {
    const { summaryStatus } = getResponseSummary(0, 0, 0, 'bypass');
    expect(summaryStatus).toBe('bypassed');
  });

  it('returns stale_detected when staleCount > 0', () => {
    const { summaryStatus, summaryMessage } = getResponseSummary(3, 2, 0, 'inline');
    expect(summaryStatus).toBe('stale_detected');
    expect(summaryMessage).toContain('stale');
  });

  it('returns unverified when no stale but some unverified', () => {
    const { summaryStatus } = getResponseSummary(3, 0, 2, 'inline');
    expect(summaryStatus).toBe('unverified');
  });

  it('returns all_fresh when all claims verified and none stale or unverified', () => {
    const { summaryStatus, summaryMessage } = getResponseSummary(3, 0, 0, 'inline');
    expect(summaryStatus).toBe('all_fresh');
    expect(summaryMessage).toContain('fresh');
  });

  it('distinguishes no_claims from all_fresh', () => {
    const noClaimsResult = getResponseSummary(0, 0, 0, 'inline');
    const allFreshResult = getResponseSummary(2, 0, 0, 'inline');
    expect(noClaimsResult.summaryStatus).toBe('no_claims');
    expect(allFreshResult.summaryStatus).toBe('all_fresh');
    expect(noClaimsResult.summaryStatus).not.toBe(allFreshResult.summaryStatus);
  });
});

// ─── scoreResponse ────────────────────────────────────────────────────────────
describe('scoreResponse', () => {
  it('returns 1.0 for empty claims (fully fresh)', () => {
    expect(scoreResponse([])).toBe(1.0);
  });

  it('weighted average favours high-likelihood claims', () => {
    const claims: ScoredClaim[] = [
      { ...baseClaim, id: '1', likelihood: 0.9, score: 0.9, verdict: 'current' },
      { ...baseClaim, id: '2', likelihood: 0.3, score: 0.0, verdict: 'stale', category: 'pricing', extractedValue: '$10' },
    ];
    const overall = scoreResponse(claims);
    // High-likelihood current claim should dominate
    expect(overall).toBeGreaterThan(0.6);
  });

  it('stays in [0, 1] range', () => {
    const claims: ScoredClaim[] = [
      { ...baseClaim, id: '1', likelihood: 1.0, score: 1.0, verdict: 'current' },
      { ...baseClaim, id: '2', likelihood: 1.0, score: 0.0, verdict: 'stale', category: 'pricing', extractedValue: '$5' },
    ];
    const s = scoreResponse(claims);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });
});

// ─── buildCorrectedAnswer ─────────────────────────────────────────────────────
describe('buildCorrectedAnswer', () => {
  it('replaces stale extractedValue with liveValue', () => {
    const claims: ScoredClaim[] = [{
      ...baseClaim,
      extractedValue: 'v1.0',
      liveValue: 'v3.0',
      verdict: 'stale',
      score: 0.1,
      likelihood: 0.9,
    }];
    const corrected = buildCorrectedAnswer('Use SDK v1.0 today.', claims);
    expect(corrected).toContain('v3.0');
    expect(corrected).toContain('*(updated)*');
  });

  it('leaves current claims unchanged', () => {
    const claims: ScoredClaim[] = [{ ...baseClaim, verdict: 'current', score: 0.9, likelihood: 0.9 }];
    const original = 'React v18 is great.';
    expect(buildCorrectedAnswer(original, claims)).toBe(original);
  });

  it('handles multiple stale replacements', () => {
    const claims: ScoredClaim[] = [
      { ...baseClaim, id: '1', extractedValue: 'v1.0',  liveValue: 'v3.0',   verdict: 'stale', score: 0.1, likelihood: 0.9 },
      { ...baseClaim, id: '2', extractedValue: '$9.99', liveValue: '$14.99', verdict: 'stale', score: 0.1, likelihood: 0.9, category: 'pricing' },
    ];
    const corrected = buildCorrectedAnswer('Use SDK v1.0 at $9.99/mo.', claims);
    expect(corrected).toContain('v3.0');
    expect(corrected).toContain('$14.99');
  });
});
