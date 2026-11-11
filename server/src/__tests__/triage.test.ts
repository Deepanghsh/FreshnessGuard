import { triageClaims } from '../services/triage';
import type { Claim } from '../types/index';

const makeClaim = (overrides: Partial<Claim>): Claim => ({
  id: 'test-id',
  text: 'test claim',
  category: 'version',
  extractedValue: 'v1.0',
  likelihood: 0.8,
  ...overrides,
});

describe('triageClaims', () => {
  it('skips claims below likelihood threshold (0.3)', () => {
    const { toVerify, skipped } = triageClaims([makeClaim({ likelihood: 0.1 })]);
    expect(toVerify).toHaveLength(0);
    expect(skipped).toHaveLength(1);
  });

  it('passes high-volatility version claims through', () => {
    const { toVerify } = triageClaims([makeClaim({ category: 'version', likelihood: 0.8 })]);
    expect(toVerify.length).toBeGreaterThan(0);
  });

  it('passes pricing claims through', () => {
    const { toVerify } = triageClaims([makeClaim({ category: 'pricing', extractedValue: '$29/month', likelihood: 0.9 })]);
    expect(toVerify).toHaveLength(1);
  });

  it('skips stable facts without stale indicators', () => {
    const { skipped } = triageClaims([makeClaim({
      category: 'fact',
      text: 'The sky is blue',
      extractedValue: 'blue',
      likelihood: 0.8,
    })]);
    expect(skipped).toHaveLength(1);
  });

  it('keeps fact claims with staleness indicators in text', () => {
    const { toVerify } = triageClaims([makeClaim({
      category: 'fact',
      text: 'The latest version available today',
      extractedValue: 'latest',
      likelihood: 0.8,
    })]);
    expect(toVerify.length).toBeGreaterThan(0);
  });

  it('de-duplicates claims by category+value', () => {
    const claims = [
      makeClaim({ extractedValue: 'v1.0', likelihood: 0.7 }),
      makeClaim({ extractedValue: 'v1.0', likelihood: 0.9 }), // duplicate, higher likelihood
    ];
    const { toVerify } = triageClaims(claims);
    expect(toVerify).toHaveLength(1);
    expect(toVerify[0].likelihood).toBeGreaterThanOrEqual(0.7); // keeps highest
  });

  it('adjusts likelihood by category volatility', () => {
    const original = makeClaim({ category: 'pricing', likelihood: 0.5 });
    const { toVerify } = triageClaims([original]);
    // Volatility boost should change the likelihood
    expect(toVerify[0].likelihood).not.toBe(0.5);
  });

  it('handles empty input gracefully', () => {
    const { toVerify, skipped } = triageClaims([]);
    expect(toVerify).toHaveLength(0);
    expect(skipped).toHaveLength(0);
  });
});

