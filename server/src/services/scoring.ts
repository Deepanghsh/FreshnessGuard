import type { Claim, Source, VerificationResult, Verdict, ScoredClaim, SummaryStatus, Mode } from '../types/index';

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * FRESHNESSGUARD SCORING & CONFIDENCE ENGINE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1. FRESHNESS SCORE (claimScore): 0.0 (stale / false) to 1.0 (fresh)
 *    claimScore = (evidenceAgreement × 0.40)
 *               + (sourceAuthority   × 0.30)
 *               + (recency           × 0.20)
 *               + (sourceCount       × 0.10)
 *
 *    Safety Bounds:
 *    - unverified claims are capped at 0.50 (cannot appear fresh)
 *    - stale and false claims are capped at 0.35
 *
 * 2. VERIFICATION CONFIDENCE (confidence): 0.0 (uncertain) to 1.0 (high certainty)
 *    Measures certainty in the verdict independent of whether the claim is fresh or stale:
 *    - High certainty: corroborated by multiple authoritative, recent sources from distinct domains
 *    - Low certainty: unverified, undated, conflicting evidence, or single non-authoritative domain
 *
 * 3. RESPONSE SUMMARY:
 *    Explicitly distinguishes:
 *    - "no_claims": 0 time-sensitive claims extracted
 *    - "all_fresh": All extracted claims verified fresh
 *    - "stale_detected": 1 or more stale/inaccurate claims found
 *    - "unverified": Evidence insufficient or ambiguous
 *    - "bypassed": FreshnessGuard explicitly bypassed
 * ─────────────────────────────────────────────────────────────────────────────
 */

const EVIDENCE_WEIGHT: Record<Verdict, number> = {
  current:    1.0,
  unverified: 0.5,
  stale:      0.0,
  false:      0.0,
};

export function countDistinctDomains(sources: Source[]): number {
  const domains = new Set<string>();
  for (const s of sources) {
    try {
      const host = (s.domain || new URL(s.url).hostname).toLowerCase().replace(/^www\./, '');
      const parts = host.split('.');
      const root = parts.length > 2 && ['co', 'gov', 'org', 'ac', 'com'].includes(parts[parts.length - 2])
        ? parts.slice(-3).join('.')
        : parts.slice(-2).join('.');
      domains.add(root);
    } catch {
      if (s.domain) domains.add(s.domain.toLowerCase());
    }
  }
  return domains.size;
}

export function authorityScore(sources: Source[]): number {
  if (sources.length === 0) return 0.30;
  const scores = sources.map(s => {
    let baseAuthority = 0.45;
    if (s.isOfficial) {
      baseAuthority = 0.90;
    } else if (s.reliability === 'high') {
      baseAuthority = 0.80;
    } else if (s.reliability === 'medium') {
      baseAuthority = 0.60;
    }
    // Blend with Tavily relevance score (0.0 to 1.0) so domain heuristics alone don't dictate authority
    const relevance = typeof s.score === 'number' ? Math.max(0, Math.min(1, s.score)) : 0.60;
    return baseAuthority * 0.65 + relevance * 0.35;
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
    if (ageDays < 0) {
      validScores.push(0.30); // Future anomaly: conservative baseline
    } else if (ageDays < 7) {
      validScores.push(1.00);
    } else if (ageDays < 30) {
      validScores.push(0.75);
    } else if (ageDays < 90) {
      validScores.push(0.50);
    } else if (ageDays < 180) {
      validScores.push(0.35);
    } else if (ageDays < 365) {
      validScores.push(0.25);
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
  // Stale and false claims must remain in the stale range
  if (result.verdict === 'stale' || result.verdict === 'false') {
    return Math.min(rawScore, 0.35);
  }

  return Math.min(1.0, Math.max(0.0, rawScore));
}

/**
 * calculateConfidence — calculates confidence in the verification verdict [0.0, 1.0].
 * Distinguishes verdict (current/stale/unverified) from freshness score and certainty.
 * Incorporates canonical domain independence to avoid syndication echo-chambers.
 */
export function calculateConfidence(result: VerificationResult): number {
  if (result.verdict === 'unverified') {
    // Unverified claims have low certainty by definition
    return result.sources.length > 0 ? 0.35 : 0.15;
  }

  const auth = authorityScore(result.sources);
  const rec = recencyScore(result.sources);
  const distinctDomains = countDistinctDomains(result.sources);
  const hasAuthoritative = result.sources.some(s => s.isOfficial || s.reliability === 'high');

  // Domain independence: multiple distinct canonical domains or authoritative source
  const domainIndependence = hasAuthoritative ? 1.0 : Math.min(distinctDomains / 2, 1.0);
  const sourceCount = Math.min(result.sources.length / 3, 1.0);

  // High confidence when sources are multiple, authoritative, independent, and recent
  const baseConfidence = (domainIndependence * 0.35) + (sourceCount * 0.15) + (auth * 0.35) + (rec * 0.15);
  return Math.max(0.25, Math.min(0.98, baseConfidence));
}

export function scoreResponse(claims: ScoredClaim[]): number {
  if (claims.length === 0) return 1.0;
  const totalWeight   = claims.reduce((s, c) => s + c.likelihood, 0);
  if (totalWeight === 0) return 1.0;
  const weightedScore = claims.reduce((s, c) => s + c.score * c.likelihood, 0);
  return Math.max(0, Math.min(1, weightedScore / totalWeight));
}

export function calculateOverallConfidence(claims: ScoredClaim[]): number | null {
  if (claims.length === 0) return null; // No claims to evaluate (avoids misleading 100% confidence)
  const totalWeight = claims.reduce((s, c) => s + c.likelihood, 0);
  if (totalWeight === 0) return null;
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
 * buildCorrectedAnswer — contextually replaces stale or false claim text in the original
 * answer with the live value discovered by Tavily, preserving exact enclosing sentence,
 * bullet point, markdown formatting, and unrelated occurrences.
 */
export function buildCorrectedAnswer(original: string, claims: ScoredClaim[]): string {
  let corrected = original;

  // Filter to claims that are stale or false, have a liveValue, and have an extractedValue
  const actionableClaims = claims.filter(
    c => (c.verdict === 'stale' || c.verdict === 'false') && c.liveValue && c.extractedValue
  );

  if (actionableClaims.length === 0) {
    return original;
  }

  for (const claim of actionableClaims) {
    const searchVal = claim.extractedValue.trim();
    if (!searchVal || !corrected.includes(searchVal)) {
      continue;
    }

    // Safety guard 1: Never replace a base subscription plan price with an add-on price ($7.99 / $9.99)
    const isBasePlan = claim.tier && ['standard', 'premium', 'basic'].includes(claim.tier.toLowerCase());
    const isAddOnPrice = claim.liveValue === '$7.99' || claim.liveValue === '$9.99';
    if (isBasePlan && isAddOnPrice && claim.attribute !== 'Extra member add-on price') {
      console.warn(`[FreshnessGuard] Safety guard prevented replacing base plan ${claim.tier} price with add-on fee ${claim.liveValue}`);
      continue;
    }

    // Safety guard 2: Never replace Standard ad-free price with Standard with Ads price ($8.99)
    if (claim.tier?.toLowerCase() === 'standard' && claim.liveValue === '$8.99') {
      console.warn(`[FreshnessGuard] Safety guard prevented replacing Standard price with Standard with Ads price ${claim.liveValue}`);
      continue;
    }

    // Find all candidate indices of searchVal in corrected text
    const indices: number[] = [];
    let idx = 0;
    while ((idx = corrected.indexOf(searchVal, idx)) !== -1) {
      indices.push(idx);
      idx += searchVal.length;
    }

    if (indices.length === 0) continue;

    // Disambiguate by context: find the enclosing sentence or bullet for each occurrence
    let chosenIndex = indices[0];

    if (indices.length > 1) {
      let bestScore = -1;
      let bestIdx = indices[0];

      for (const candIdx of indices) {
        // Enclosing line or window around candIdx
        const lineStart = Math.max(0, corrected.lastIndexOf('\n', candIdx) + 1);
        const nextNewline = corrected.indexOf('\n', candIdx + searchVal.length);
        const lineEnd = nextNewline === -1 ? corrected.length : nextNewline;
        const enclosingLine = corrected.slice(lineStart, lineEnd).toLowerCase();

        let score = 0;
        // Match claim tier
        if (claim.tier && enclosingLine.includes(claim.tier.toLowerCase())) {
          score += 10;
        }
        // Match claim entity / product
        if (claim.entity && enclosingLine.includes(claim.entity.toLowerCase())) {
          score += 5;
        }
        // Match words from claim text
        const words = claim.text.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        for (const w of words) {
          if (enclosingLine.includes(w)) {
            score += 1;
          }
        }
        // Avoid historical lines if claim is not historical
        if (claim.timePeriod !== 'historical' && /\b(?:was|in 20\d\d|once|previously|used to)\b/i.test(enclosingLine)) {
          score -= 5;
        }

        if (score > bestScore) {
          bestScore = score;
          bestIdx = candIdx;
        }
      }
      chosenIndex = bestIdx;
    }

    // Safe in-place replacement at chosenIndex
    const replacement = `${claim.liveValue} *(updated)*`;
    corrected = corrected.slice(0, chosenIndex) + replacement + corrected.slice(chosenIndex + searchVal.length);
  }

  return corrected;
}
