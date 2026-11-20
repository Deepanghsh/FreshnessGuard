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
  it('returns null for zero claims (no claims to evaluate, avoids misleading 100% confidence)', () => {
    expect(calculateOverallConfidence([])).toBeNull();
  });

  it('weights confidence by likelihood for non-empty claim sets', () => {
    const claims: ScoredClaim[] = [
      { ...baseClaim, id: '1', likelihood: 0.9, score: 0.9, verdict: 'current', confidence: 0.9 },
      { ...baseClaim, id: '2', likelihood: 0.3, score: 0.0, verdict: 'unverified', confidence: 0.15, category: 'fact', extractedValue: 'x' },
    ];
    const overall = calculateOverallConfidence(claims);
    expect(overall).not.toBeNull();
    expect(overall!).toBeGreaterThan(0.60);
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

  describe('Safe In-Place Replacement & Consistency Regressions', () => {
    it('replaces target price in a bullet point without affecting identical numbers elsewhere', () => {
      const original = `Netflix Pricing Overview:
- Standard with Ads: $6.99 per month
- Standard: $15.49 per month
- Premium: $22.99 per month

Historical note: In 2015, the old plan cost $15.49 before restructuring.`;

      const claims: ScoredClaim[] = [
        {
          id: 'claim-standard',
          text: 'Standard: $15.49 per month',
          category: 'pricing',
          extractedValue: '$15.49',
          tier: 'Standard',
          entity: 'Netflix',
          verdict: 'stale',
          liveValue: '$17.99',
          score: 0.15,
          likelihood: 0.95,
        },
      ];

      const corrected = buildCorrectedAnswer(original, claims);
      // The current Standard bullet must be updated
      expect(corrected).toContain('- Standard: $17.99 *(updated)* per month');
      // The historical paragraph must remain completely untouched
      expect(corrected).toContain('Historical note: In 2015, the old plan cost $15.49 before restructuring.');
      // Other bullets must remain untouched
      expect(corrected).toContain('- Standard with Ads: $6.99 per month');
      expect(corrected).toContain('- Premium: $22.99 per month');
    });

    it('does not replace values for UNVERIFIED claims', () => {
      const original = 'Netflix Standard in Iceland is $12.99 per month.';
      const claims: ScoredClaim[] = [
        {
          id: 'claim-unverified',
          text: 'Netflix Standard in Iceland is $12.99 per month.',
          category: 'pricing',
          extractedValue: '$12.99',
          tier: 'Standard',
          entity: 'Netflix',
          verdict: 'unverified',
          score: 0.50,
          likelihood: 0.95,
        },
      ];

      const corrected = buildCorrectedAnswer(original, claims);
      expect(corrected).toBe(original);
    });

    it('ensures summaryStatus and correctedAnswer never contradict', () => {
      const unverifiedClaims: ScoredClaim[] = [
        {
          id: 'u1',
          text: 'Some disputed claim',
          category: 'fact',
          extractedValue: 'disputed',
          verdict: 'unverified',
          score: 0.50,
          likelihood: 0.8,
        },
      ];
      const summaryUnverified = getResponseSummary(1, 0, 1, 'inline');
      expect(summaryUnverified.summaryStatus).toBe('unverified');
      const correctedUnverified = buildCorrectedAnswer('Some disputed claim', unverifiedClaims);
      // No corrections applied when unverified
      expect(correctedUnverified).toBe('Some disputed claim');

      const staleClaims: ScoredClaim[] = [
        {
          id: 's1',
          text: 'Twitter CEO is Parag Agrawal',
          category: 'leadership',
          extractedValue: 'Parag Agrawal',
          liveValue: 'Linda Yaccarino',
          verdict: 'stale',
          score: 0.15,
          likelihood: 0.9,
        },
      ];
      const summaryStale = getResponseSummary(1, 1, 0, 'inline');
      expect(summaryStale.summaryStatus).toBe('stale_detected');
      const correctedStale = buildCorrectedAnswer('Twitter CEO is Parag Agrawal', staleClaims);
      expect(correctedStale).toContain('Linda Yaccarino *(updated)*');
    });

    it('preserves valid $7.99 and $9.99 extra-member prices and $11.99 retired basic plan when other tiers are corrected', () => {
      const original = `Netflix Pricing in the US:
* Standard with Ads: $6.99 per month
* Standard: $15.49 per month
  - Option to add one "extra member" for an additional $7.99/month.
  - Option to add an ad-free extra member for $9.99/month.
* Premium: $22.99 per month
* Basic Plan (Discontinued): Netflix has officially retired its $11.99/month Basic plan.`;

      const claims: ScoredClaim[] = [
        {
          id: 'claim-ads',
          text: 'Standard with Ads: $6.99 per month',
          category: 'pricing',
          extractedValue: '$6.99',
          tier: 'Standard with Ads',
          verdict: 'stale',
          liveValue: '$8.99',
          score: 0.28,
          likelihood: 0.95,
        },
        {
          id: 'claim-std',
          text: 'Standard: $15.49 per month',
          category: 'pricing',
          extractedValue: '$15.49',
          tier: 'Standard',
          verdict: 'stale',
          liveValue: '$19.99',
          score: 0.31,
          likelihood: 0.95,
        },
        {
          id: 'claim-extra-799',
          text: 'Option to add one "extra member" for an additional $7.99/month.',
          category: 'pricing',
          extractedValue: '$7.99',
          tier: 'Extra Member',
          attribute: 'Extra member add-on price',
          verdict: 'current',
          score: 0.85,
          likelihood: 0.95,
        },
        {
          id: 'claim-extra-999',
          text: 'Option to add an ad-free extra member for $9.99/month.',
          category: 'pricing',
          extractedValue: '$9.99',
          tier: 'Extra Member',
          attribute: 'Extra member add-on price',
          verdict: 'current',
          score: 0.85,
          likelihood: 0.95,
        },
        {
          id: 'claim-prem',
          text: 'Premium: $22.99 per month',
          category: 'pricing',
          extractedValue: '$22.99',
          tier: 'Premium',
          verdict: 'stale',
          liveValue: '$26.99',
          score: 0.31,
          likelihood: 0.95,
        },
        {
          id: 'claim-basic',
          text: 'Basic Plan (Discontinued): Netflix has officially retired its $11.99/month Basic plan.',
          category: 'pricing',
          extractedValue: '$11.99',
          tier: 'Basic',
          attribute: 'Discontinued plan price',
          timePeriod: 'historical',
          verdict: 'current',
          score: 0.85,
          likelihood: 0.95,
        },
      ];

      const corrected = buildCorrectedAnswer(original, claims);

      // Verified stale subscription tiers should be updated
      expect(corrected).toContain('* Standard with Ads: $8.99 *(updated)* per month');
      expect(corrected).toContain('* Standard: $19.99 *(updated)* per month');
      expect(corrected).toContain('* Premium: $26.99 *(updated)* per month');

      // Valid extra member and retired Basic plan prices MUST remain untouched
      expect(corrected).toContain('- Option to add one "extra member" for an additional $7.99/month.');
      expect(corrected).toContain('- Option to add an ad-free extra member for $9.99/month.');
      expect(corrected).toContain('* Basic Plan (Discontinued): Netflix has officially retired its $11.99/month Basic plan.');

      // Standard price $19.99 must NEVER appear in the extra member or basic lines
      expect(corrected).not.toContain('extra member" for an additional $19.99');
      expect(corrected).not.toContain('retired its $19.99/month Basic plan');
    });

    it('corrects exact occurrences when base plans contain extra-member eligibility sentences', () => {
      const original = `Netflix US subscription plans:
* Standard with Ads ($6.99/month): Ad-supported streaming.
* Standard Plan ($15.49/month): You can add one extra member.
* Premium Plan ($22.99/month): You can add up to two extra members.
* Extra member slot costs $7.99/month.`;

      const claims: ScoredClaim[] = [
        {
          id: 'c1',
          text: '* Standard with Ads ($6.99/month): Ad-supported streaming.',
          category: 'pricing',
          extractedValue: '$6.99',
          tier: 'Standard with Ads',
          verdict: 'stale',
          liveValue: '$8.99',
          score: 0.25,
          likelihood: 0.95,
        },
        {
          id: 'c2',
          text: '* Standard Plan ($15.49/month): You can add one extra member.',
          category: 'pricing',
          extractedValue: '$15.49',
          tier: 'Standard',
          verdict: 'stale',
          liveValue: '$19.99',
          score: 0.25,
          likelihood: 0.95,
        },
        {
          id: 'c3',
          text: '* Premium Plan ($22.99/month): You can add up to two extra members.',
          category: 'pricing',
          extractedValue: '$22.99',
          tier: 'Premium',
          verdict: 'stale',
          liveValue: '$26.99',
          score: 0.25,
          likelihood: 0.95,
        },
        {
          id: 'c4',
          text: '* Extra member slot costs $7.99/month.',
          category: 'pricing',
          extractedValue: '$7.99',
          tier: 'Extra Member',
          verdict: 'current',
          score: 0.85,
          likelihood: 0.95,
        },
      ];

      const corrected = buildCorrectedAnswer(original, claims);
      expect(corrected).toContain('* Standard with Ads ($8.99 *(updated)*/month): Ad-supported streaming.');
      expect(corrected).toContain('* Standard Plan ($19.99 *(updated)*/month): You can add one extra member.');
      expect(corrected).toContain('* Premium Plan ($26.99 *(updated)*/month): You can add up to two extra members.');
      expect(corrected).toContain('* Extra member slot costs $7.99/month.');
      expect(corrected).not.toContain('$7.99 *(updated)*');
    });

    it('safety guard blocks replacing a base plan price with an add-on fee ($7.99 or $9.99)', () => {
      const original = '* Standard Plan ($15.49/month): You can add one extra member.';
      const corruptedClaim: ScoredClaim = {
        id: 'corrupt',
        text: '* Standard Plan ($15.49/month): You can add one extra member.',
        category: 'pricing',
        extractedValue: '$15.49',
        tier: 'Standard',
        verdict: 'stale',
        liveValue: '$7.99', // Malformed liveValue from tier confusion
        score: 0.2,
        likelihood: 0.95,
      };
      const corrected = buildCorrectedAnswer(original, [corruptedClaim]);
      expect(corrected).toBe(original); // Untouched!
    });

    it('safety guard blocks replacing Standard ad-free price with Standard with Ads price ($8.99)', () => {
      const original = '* Standard Plan ($15.49/month): Ad-free HD streaming.';
      const corruptedClaim: ScoredClaim = {
        id: 'corrupt-ads',
        text: '* Standard Plan ($15.49/month): Ad-free HD streaming.',
        category: 'pricing',
        extractedValue: '$15.49',
        tier: 'Standard',
        verdict: 'stale',
        liveValue: '$8.99', // Malformed collision with with-ads price
        score: 0.2,
        likelihood: 0.95,
      };
      const corrected = buildCorrectedAnswer(original, [corruptedClaim]);
      expect(corrected).toBe(original); // Untouched!
    });
  });
});
