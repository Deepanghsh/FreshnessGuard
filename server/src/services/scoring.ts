import type { Claim, Source, VerificationResult, Verdict, ScoredClaim } from '../types/index';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * FRESHNESSGUARD SCORING FORMULA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * claimScore = (evidenceAgreement × 0.40)
 *            + (sourceAuthority   × 0.30)
 *            + (recency           × 0.20)
 *            + (sourceCount       × 0.10)
 *
 * evidenceAgreement:
 *   current    → 1.0
 *   unverified → 0.5
 *   stale      → 0.0
 *
 * sourceAuthority  (averaged over all sources):
 *   isOfficial = true  → 0.90
 *   otherwise          → 0.40
 *
 * recency  (best source's age):
 *   < 7  days → 1.00
 *   < 30 days → 0.75
 *   < 90 days → 0.50
 *   otherwise → 0.15
 *
 * sourceCount:
 *   min(n / 3, 1.0)   — saturates at 3 sources
 *
 * overallScore = Σ(claimScore × likelihood) / Σ(likelihood)
 *   — weighted average, so high-confidence claims dominate
 *   — returns 1.0 when there are no claims (fully fresh)
 * ─────────────────────────────────────────────────────────────────────────────
 */

const EVIDENCE_WEIGHT: Record<Verdict, number> = {
  current:    1.0,
  unverified: 0.5,
  stale:      0.0,
};

function authorityScore(sources: Source[]): number {
  if (sources.length === 0) return 0.3;
  const scores = sources.map(s => s.isOfficial ? 0.9 : 0.4);
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

function recencyScore(sources: Source[]): number {
  if (sources.length === 0) return 0.20;
  const now = Date.now();
  const validScores: number[] = [];

  for (const s of sources) {
    if (!s.publishedDate) continue;
    const ts = new Date(s.publishedDate).getTime();
    if (isNaN(ts)) continue;
    const ageDays = (now - ts) / 86_400_000;
    // Safely handle future timestamps, missing dates, and recency tiers
    if (ageDays < 0) {
      validScores.push(0.30); // Future anomaly: neutral score
    } else if (ageDays < 7) {
      validScores.push(1.00);
    } else if (ageDays < 30) {
      validScores.push(0.75);
    } else if (ageDays < 90) {
      validScores.push(0.50);
    } else {
      validScores.push(0.15);
    }
  }

  return validScores.length > 0 ? Math.max(...validScores) : 0.20;
}

export function scoreClaim(result: VerificationResult): number {
  const evidence  = EVIDENCE_WEIGHT[result.verdict];
  const authority = authorityScore(result.sources);
  const recency   = recencyScore(result.sources);
  const count     = Math.min(result.sources.length / 3, 1.0);

  return (
    evidence  * 0.40 +
    authority * 0.30 +
    recency   * 0.20 +
    count     * 0.10
  );
}

export function scoreResponse(claims: ScoredClaim[]): number {
  if (claims.length === 0) return 1.0;
  const totalWeight   = claims.reduce((s, c) => s + c.likelihood, 0);
  if (totalWeight === 0) return 1.0;
  const weightedScore = claims.reduce((s, c) => s + c.score * c.likelihood, 0);
  return Math.max(0, Math.min(1, weightedScore / totalWeight));
}

/**
 * buildCorrectedAnswer — replaces stale claim text in the original
 * answer with the live value discovered by Tavily.
 */
export function buildCorrectedAnswer(original: string, claims: ScoredClaim[]): string {
  let corrected = original;
  for (const claim of claims) {
    if (claim.verdict === 'stale' && claim.liveValue && claim.extractedValue) {
      if (corrected.includes(claim.extractedValue)) {
        corrected = corrected.replace(claim.extractedValue, `${claim.liveValue} [Updated from ${claim.extractedValue}]`);
      }
    }
  }
  return corrected;
}

