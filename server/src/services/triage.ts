import type { Claim } from '../types/index';

// ─── Per-category volatility (staleness risk) ─────────────────────────────────
const VOLATILITY: Record<string, number> = {
  pricing:    0.95,
  version:    0.90,
  leadership: 0.85,
  date:       0.70,
  law:        0.65,
  fact:       0.40,
};

// Minimum likelihood to even enter verification
const MIN_LIKELIHOOD = 0.30;

// Staleness-indicator words that force a 'fact' claim through triage
const STALE_INDICATORS = /\b(latest|current|as of|updated|recent|now supports|currently|today)\b/i;

export interface TriageResult {
  toVerify: Claim[];
  skipped: Claim[];
}

/**
 * triageClaims — decides which claims are worth verifying with Tavily.
 *
 * Rules:
 *  1. Drop claims below MIN_LIKELIHOOD threshold (not worth Tavily cost).
 *  2. Drop 'fact' claims unless they carry staleness-indicator wording.
 *  3. Adjust likelihood by category volatility so the scorer sees a composite risk.
 *  4. De-duplicate by extractedValue (keep highest likelihood).
 */
export function triageClaims(claims: Claim[]): TriageResult {
  // De-duplicate by (category + normalised value)
  const best = new Map<string, Claim>();
  for (const c of claims) {
    const key = `${c.category}:${c.extractedValue.toLowerCase().trim()}`;
    const existing = best.get(key);
    if (!existing || c.likelihood > existing.likelihood) best.set(key, c);
  }

  const toVerify: Claim[] = [];
  const skipped: Claim[] = [];

  for (const claim of best.values()) {
    // Rule 1: likelihood threshold
    if (claim.likelihood < MIN_LIKELIHOOD) {
      skipped.push(claim);
      continue;
    }

    // Rule 2: stable fact without staleness signals
    if (
      claim.category === 'fact' &&
      !STALE_INDICATORS.test(claim.text) &&
      !STALE_INDICATORS.test(claim.extractedValue)
    ) {
      skipped.push(claim);
      continue;
    }

    // Rule 3: apply composite volatility boost
    const vol = VOLATILITY[claim.category] ?? 0.5;
    const adjustedLikelihood = Math.min(1, claim.likelihood * vol + claim.likelihood * (1 - vol) * 0.4);

    toVerify.push({ ...claim, likelihood: adjustedLikelihood });
  }

  return { toVerify, skipped };
}

