import { scoreClaim, scoreResponse, buildCorrectedAnswer } from '../services/scoring';
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

  it('gives mid score for unverified + old sources', () => {
    const result = makeResult({
      verdict: 'unverified',
      sources: [{ url: 'https://example.com', title: 'Old Post', isOfficial: false, publishedDate: oldDate }],
    });
    const score = scoreClaim(result);
    expect(score).toBeGreaterThan(0.2);
    expect(score).toBeLessThan(0.7);
  });

  it('formula components sum to ≤1', () => {
    const result = makeResult({ verdict: 'current', sources: [{ url: 'https://docs.x.com', title: 'X', isOfficial: true, publishedDate: recentDate }] });
    expect(scoreClaim(result)).toBeLessThanOrEqual(1.0);
    expect(scoreClaim(result)).toBeGreaterThanOrEqual(0.0);
  });
});

describe('scoreResponse', () => {
  it('returns 1.0 for empty claims (fully fresh)', () => {
    expect(scoreResponse([])).toBe(1.0);
  });

  it('weighted average favours high-likelihood claims', () => {
    const claims: ScoredClaim[] = [
      { ...baseClaim, id: '1', likelihood: 0.9, score: 0.9, verdict: 'current' },
      { ...baseClaim, id: '2', likelihood: 0.3, score: 0.0, verdict: 'stale',   category: 'pricing', extractedValue: '$10' },
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
});

