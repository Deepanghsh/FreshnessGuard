import type { Claim, Source, VerificationResult, Verdict, ScoredClaim, SummaryStatus, Mode } from '../types/index';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * FRESHNESSGUARD SCORING & CONFIDENCE ENGINE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1. FRESHNESS SCORE (claimScore): 0.0 (stale) to 1.0 (fresh)
 *    claimScore = (evidenceAgreement × 0.40)
 *               + (sourceAuthority   × 0.30)
 *               + (recency           × 0.20)
 *               + (sourceCount       × 0.10)
 *
 *    Safety Bounds:
 *    - unverified claims are capped at 0.50 (cannot appear fresh)
 *    - stale claims are capped at 0.35
 *
 * 2. VERIFICATION CONFIDENCE (confidence): 0.0 (uncertain) to 1.0 (high certainty)
 *    Measures certainty in the verdict independent of whether the claim is fresh or stale:
 *    - High certainty: corroborated by multiple authoritative, recent sources
 *    - Low certainty: unverified, undated, or conflicting evidence
 *
 * 3. RESPONSE SUMMARY:
 *    Explicitly distinguishes:
 *    - "no_claims": 0 time-sensitive claims extracted
 *    - "all_fresh": All extracted claims verified fresh
 *    - "stale_detected": 1 or more stale claims found
 *    - "unverified": Evidence insufficient or ambiguous
 *    - "bypassed": FreshnessGuard explicitly bypassed
 * ─────────────────────────────────────────────────────────────────────────────
 */

const EVIDENCE_WEIGHT: Record<Verdict, number> = {
  current:    1.0,
  unverified: 0.5,
  stale:      0.0,
};

export function authorityScore(sources: Source[]): number {
  if (sources.length === 0) return 0.30;
  const scores = sources.map(s => {
    const baseAuthority = s.isOfficial ? 0.85 : 0.45;
    // Blend with Tavily relevance score (0.0 to 1.0) so domain heuristics alone don't dictate authority
    const relevance = typeof s.score === 'number' ? Math.max(0, Math.min(1, s.score)) : 0.60;
    return baseAuthority * 0.70 + relevance * 0.30;
  });
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

export function recencyScore(sources: Source[]): number {
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
      validScores.push(0.30); // Future anomaly: conservative baseline
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

  const rawScore = (
    evidence  * 0.40 +
    authority * 0.30 +
    recency   * 0.20 +
    count     * 0.10
  );

  // Unverified claims must never appear fresh simply because of third-party search noise
  if (result.verdict === 'unverified') {
    return Math.min(rawScore, 0.50);
  }
  // Stale claims must remain in the stale range
  if (result.verdict === 'stale') {
    return Math.min(rawScore, 0.35);
  }

  return Math.min(1.0, Math.max(0.0, rawScore));
}

/**
 * calculateConfidence — calculates confidence in the verification verdict [0.0, 1.0].
 * Distinguishes verdict (current/stale/unverified) from freshness score and certainty.
 */
export function calculateConfidence(result: VerificationResult): number {
  if (result.verdict === 'unverified') {
    // Unverified claims have low certainty by definition
    return result.sources.length > 0 ? 0.35 : 0.15;
  }

  const sourceCount = Math.min(result.sources.length / 3, 1.0);
  const auth = authorityScore(result.sources);
  const rec = recencyScore(result.sources);

  // High confidence when sources are multiple, authoritative, and recent
  const baseConfidence = (sourceCount * 0.35) + (auth * 0.40) + (rec * 0.25);
  return Math.max(0.25, Math.min(0.98, baseConfidence));
}

export function scoreResponse(claims: ScoredClaim[]): number {
  if (claims.length === 0) return 1.0;
  const totalWeight   = claims.reduce((s, c) => s + c.likelihood, 0);
  if (totalWeight === 0) return 1.0;
  const weightedScore = claims.reduce((s, c) => s + c.score * c.likelihood, 0);
  return Math.max(0, Math.min(1, weightedScore / totalWeight));
}

export function calculateOverallConfidence(claims: ScoredClaim[]): number {
  if (claims.length === 0) return 1.0; // Confident that no verification was needed
  const totalWeight = claims.reduce((s, c) => s + c.likelihood, 0);
  if (totalWeight === 0) return 1.0;
  const weightedConf = claims.reduce((s, c) => s + (c.confidence ?? 0.5) * c.likelihood, 0);
  return Math.max(0, Math.min(1, weightedConf / totalWeight));
}

/**
 * getResponseSummary — explicitly distinguishes:
 * - "No claims requiring verification" (0 time-sensitive claims detected)
 * - "All claims verified fresh" (claims detected and all confirmed fresh)
 * - "Stale claim(s) detected"
 * - "Claim(s) unverified"
 * - "Bypassed FreshnessGuard verification"
 */
export function getResponseSummary(
  totalClaims: number,
  staleCount: number,
  unverifiedCount: number,
  mode: Mode
): { summaryStatus: SummaryStatus; summaryMessage: string } {
  if (mode === 'bypass') {
    return {
      summaryStatus: 'bypassed',
      summaryMessage: 'Bypassed FreshnessGuard verification',
    };
  }
  if (totalClaims === 0) {
    return {
      summaryStatus: 'no_claims',
      summaryMessage: 'No claims requiring verification',
    };
  }
  if (staleCount > 0) {
    return {
      summaryStatus: 'stale_detected',
      summaryMessage: `${staleCount} stale claim${staleCount > 1 ? 's' : ''} detected`,
    };
  }
  if (unverifiedCount > 0) {
    return {
      summaryStatus: 'unverified',
      summaryMessage: `${unverifiedCount} claim${unverifiedCount > 1 ? 's' : ''} unverified`,
    };
  }
  return {
    summaryStatus: 'all_fresh',
    summaryMessage: 'All claims verified fresh',
  };
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
        corrected = corrected.replace(claim.extractedValue, `${claim.liveValue} *(updated)*`);
      }
    }
  }
  return corrected;
}
