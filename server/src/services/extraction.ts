import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import type { Claim, ClaimCategory, ExtractionResult } from '../types/index';

// ─── Volatility weights per category ──────────────────────────────────────────
const VOLATILITY: Record<ClaimCategory, number> = {
  pricing: 0.95,
  version: 0.90,
  leadership: 0.85,
  date: 0.70,
  law: 0.65,
  fact: 0.40,
};

// ─── Regex patterns ────────────────────────────────────────────────────────────
const VERSION_RE = /(?<!\$)\b(?:v?\d+\.\d+(?:\.\d+)?(?:-[a-z0-9.]+)?|(?:Next\.js|Angular|React|Vue|Node(?:\.js)?|Python)\s+\d+(?:\.\d+)*)\b/gi;
const PRICE_RE   = /\$\s*\d[\d,]*(?:\.\d{1,2})?(?:\s*(?:per|\/)\s*(?:month|year|mo|yr|user|seat|request|token|k\s*tokens?))?/gi;
const DATE_RE    = /\b(202[0-9]|203[0-9])\b/g;
const STALE_RE   = /\b(latest|current|as of|updated|recent|now supports|currently|at the time of writing|at present|today)\b/gi;
const LAW_RE     = /\b(?:EU-US\s+Privacy\s+Shield|Privacy\s+Shield|Safe\s+Harbor|Data\s+Privacy\s+Framework|Section\s+230|GDPR|CCPA|HIPAA|SOX|Basel\s*(?:I{1,3}|IV)|Dodd.Frank|MiFID|PCI.DSS|regulation|directive|treaty|act)\b/gi;
const CEO_RE     = /\b(?:Chief\s+(?:Executive|Technology|Operating|Financial)\s+Officer|CEO|CTO|COO|CFO|President|Founder|Chairman|Chairwoman|Director)\b.{0,80}/gi;

const KNOWN_ENTITIES = [
  'netflix', 'spotify', 'amazon prime', 'amazon', 'youtube', 'hulu',
  'disney+', 'disney plus', 'apple tv', 'apple', 'chatgpt', 'openai',
  'claude', 'anthropic', 'github', 'twitter', 'x', 'linkedin',
  'google', 'microsoft', 'meta', 'node.js', 'nodejs', 'python',
  'react', 'angular', 'vue', 'typescript', 'next.js', 'nextjs',
];

function getEnclosingContext(text: string, index: number, matchLen: number): { sentence: string; line: string; clause: string } {
  const lastNewlineBefore = text.lastIndexOf('\n', index);
  const lineStart = lastNewlineBefore === -1 ? 0 : lastNewlineBefore + 1;
  const nextNewlineAfter = text.indexOf('\n', index + matchLen);
  const lineEnd = nextNewlineAfter === -1 ? text.length : nextNewlineAfter;
  const line = text.slice(lineStart, lineEnd).trim();

  const before = text.slice(0, index);
  const after = text.slice(index + matchLen);

  const startMatch = before.search(/([.!?]\s+|\n)[^.!?\n]*$/);
  const start = startMatch !== -1 ? startMatch + (before.match(/([.!?]\s+|\n)[^.!?\n]*$/)?.[1].length ?? 0) : 0;

  const endMatch = after.search(/[.!?](\s+|$)|[\n]/);
  const end = endMatch !== -1 ? index + matchLen + endMatch + 1 : text.length;

  const sentence = text.slice(start, end).trim();

  // Local clause / bullet segment bounded by :, ;, -, *, •, |, or sentence boundaries
  const beforeClauseMatch = before.search(/([:;•|]|\s[-*]\s|\n)[^:;•|\n]*$/);
  const clauseStart = beforeClauseMatch !== -1
    ? beforeClauseMatch + (before.match(/([:;•|]|\s[-*]\s|\n)[^:;•|\n]*$/)?.[1].length ?? 0)
    : Math.max(lineStart, start);

  const afterClauseMatch = after.search(/[:;•|]|\s[-*]\s|[\n]/);
  const clauseEnd = afterClauseMatch !== -1
    ? index + matchLen + afterClauseMatch
    : Math.min(lineEnd, end);

  const clause = text.slice(clauseStart, clauseEnd).trim();

  return {
    clause: clause.length > 0 ? clause : sentence,
    sentence: sentence.length > 0 ? sentence : line,
    line: line.length > 0 ? line : (sentence.length > 0 ? sentence : text.slice(index, index + matchLen)),
  };
}

export function isExtraMemberClaim(text: string): boolean {
  return /\b(?:extra\s+members?|additional\s+members?|extra\s+member\s+slots?|add-on\s+members?)\b/i.test(text);
}

export function isExplicitExtraMemberFee(text: string): boolean {
  return (
    /\b(?:extra\s+members?|additional\s+members?|extra\s+member\s+slots?|add-on\s+members?)[^\$\n.]{0,100}?\b(?:at|is\s+now|is|now\s+costs?|now|costs?|reached|:|\||for|fee\s+of|priced\s+at|\()\s*(?:an?\s+additional\s+)?\$\s*\d+/i.test(text) ||
    /\$\s*\d+(?:,\d{3})*(?:\.\d+)?\s*(?:(?:(?:\/|per\s+)(?:month|mo|year|yr))?\s+)?(?:for|on|per)\s+(?:an?\s+|each\s+)?(?:extra\s+member|additional\s+member|add-on\s+member)/i.test(text) ||
    /(?:extra\s+members?|additional\s+members?|add-on\s+members?)\s+(?:fees?|cost|pricing|slots?)[^\$\n.]{0,60}?\$\s*\d+/i.test(text) ||
    /\badditional\s+\$\s*\d+(?:,\d{3})*(?:\.\d+)?(?:\/|\s*(?:per\s+)?)(?:month|mo)\b[^\n.]{0,60}?\b(?:extra|additional|add-on)\s+member/i.test(text) ||
    /\b(?:extra\s+members?|additional\s+members?)\s+(?:with\s+ads|without\s+ads)[^\$\n.]{0,60}?\$\s*\d+/i.test(text) ||
    /\$\s*\d+(?:,\d{3})*(?:\.\d+)?\s*(?:(?:(?:\/|per\s+)(?:month|mo))?\s+)?(?:with\s+ads|without\s+ads)[^\n.]{0,60}?\b(?:for|per)\s+(?:an?\s+)?(?:extra\s+member|additional\s+member)/i.test(text) ||
    /\b(?:add|adding)\s+(?:an?\s+|one\s+|two\s+)?["']?(?:extra|additional)\s+member[^\$\n.]{0,100}?\bfor\s+(?:an?\s+additional\s+)?\$\s*\d+/i.test(text)
  );
}

export function isExtraMemberEligibility(text: string): boolean {
  return (
    /\b(?:you\s+can\s+add|can\s+add|allows?(?:\s+you\s+to)?\s+add|option\s+to\s+add|eligible\s+(?:to\s+add|for))\s+(?:one|two|up\s+to\s+\w+|\d+)?\s*(?:extra|additional)\s+members?\b/i.test(text) ||
    /\b(?:one|two|\d+)\s+extra\s+members?\s+(?:allowed|can\s+be\s+added|slots?)\b/i.test(text)
  );
}

export function isDiscontinuedClaim(text: string): boolean {
  return /\b(?:discontinued|retired|sunset(?:ted)?|no\s+longer\s+offered|phased\s+out|cancelled|withdrawn|grandfathered)\b/i.test(text);
}

function detectTierSingle(text: string): string | undefined {
  const lower = text.toLowerCase();

  // Explicit Precedence:
  // 1. Standard with Ads
  if (/\b(?:standard\s+(?:with\s+ads?|ad-supported|\(with\s+ads?\))|ad-supported\s+standard|standard\s+plan\s+with\s+ads?|standard\s+tier\s+with\s+ads?)\b/i.test(lower)) {
    return 'Standard with Ads';
  }

  // 2. Standard (ad-free) - must not match Standard with Ads
  if (/\bstandard\b/i.test(lower) && !/\b(?:with\s+ads?|ad-supported|\(with\s+ads?\))\b/i.test(lower)) {
    // Only yield to Extra Member if this specific clause/text is an explicit extra-member add-on fee (and NOT a Standard plan price)
    if (!isExplicitExtraMemberFee(lower) || /\bstandard\s+(?:plan|tier|subscription)?\s*\(?\s*\$/i.test(lower) || /\bstandard\s+(?:plan|tier|subscription)?\s*:\s*\$/i.test(lower)) {
      return 'Standard';
    }
  }

  // 3. Premium
  if (/\bpremium\b/i.test(lower)) {
    if (!isExplicitExtraMemberFee(lower) || /\bpremium\s+(?:plan|tier|subscription)?\s*\(?\s*\$/i.test(lower) || /\bpremium\s+(?:plan|tier|subscription)?\s*:\s*\$/i.test(lower)) {
      return 'Premium';
    }
  }

  // 4. Basic
  if (/\bbasic\s+(?:with\s+ads?|ad-supported)\b/i.test(lower)) {
    return 'Basic with Ads';
  }
  if (/\bbasic\b/i.test(lower)) {
    return 'Basic';
  }

  // Other named tiers
  if (/\bpro\b/i.test(lower)) return 'Pro';
  if (/\bplus\b/i.test(lower)) return 'Plus';
  if (/\bultra\b/i.test(lower)) return 'Ultra';
  if (/\benterprise\b/i.test(lower)) return 'Enterprise';
  if (/\bindividual\b/i.test(lower)) return 'Individual';
  if (/\bfamily\b/i.test(lower)) return 'Family';
  if (/\bstudent\b/i.test(lower)) return 'Student';
  if (/\bfree\b/i.test(lower)) return 'Free';

  // 5. Extra Member - evaluated AFTER base plans. Only explicit add-on fee or non-eligibility mention.
  if (isExplicitExtraMemberFee(lower) || isExtraMemberClaim(lower)) {
    // Eligibility statements alone without fee must not produce Extra Member tier
    if (isExtraMemberEligibility(lower) && !isExplicitExtraMemberFee(lower)) {
      return undefined;
    }
    return 'Extra Member';
  }

  return undefined;
}

export function detectTier(text: string, clauseText?: string): string | undefined {
  if (clauseText && clauseText !== text) {
    const tierFromClause = detectTierSingle(clauseText);
    if (tierFromClause) {
      return tierFromClause;
    }
  }
  return detectTierSingle(text);
}

export function detectEntity(sentence: string, fullText: string): { entity?: string; product?: string } {
  const sentenceLower = sentence.toLowerCase();
  for (const ent of KNOWN_ENTITIES) {
    if (sentenceLower.includes(ent)) {
      const proper = ent.charAt(0).toUpperCase() + ent.slice(1);
      return { entity: proper, product: proper };
    }
  }

  const fullLower = fullText.toLowerCase();
  for (const ent of KNOWN_ENTITIES) {
    if (fullLower.includes(ent)) {
      const proper = ent.charAt(0).toUpperCase() + ent.slice(1);
      return { entity: proper, product: proper };
    }
  }

  // Capitalized brand before keywords like pricing/plan/costs
  const match = sentence.match(/\b([A-Z][a-zA-Z0-9+]+(?:\s+[A-Z][a-zA-Z0-9+]+)?)\s+(?:pricing|plan|plans|costs?|subscription|tier)/i)
    || fullText.match(/\b([A-Z][a-zA-Z0-9+]+(?:\s+[A-Z][a-zA-Z0-9+]+)?)\s+(?:pricing|plan|plans|costs?|subscription|tier)/i);
  if (match && !/^(?:here|these|the|all|current|our|each|as|in|for|this)\b/i.test(match[1])) {
    return { entity: match[1], product: match[1] };
  }

  return {};
}

export function detectRegion(sentence: string): string | undefined {
  if (/\b(?:in\s+the\s+US|in\s+the\s+USA|in\s+the\s+United\s+States|US\s+market|US\s+pricing|US\s+plan)\b/i.test(sentence) || /\bUS\b/.test(sentence)) {
    return 'US';
  }
  if (/\b(?:UK|United Kingdom|Britain)\b/i.test(sentence) || /£/.test(sentence)) {
    return 'UK';
  }
  if (/\b(?:EU|Europe|European Union)\b/i.test(sentence) || /€/.test(sentence)) {
    return 'EU';
  }
  if (/\bCanada\b/i.test(sentence) || /C\$/.test(sentence)) {
    return 'Canada';
  }
  if (/\bAustralia\b/i.test(sentence) || /A\$/.test(sentence)) {
    return 'Australia';
  }
  if (/\bIndia\b/i.test(sentence) || /₹/.test(sentence)) {
    return 'India';
  }
  // Default to US if dollar sign is present without explicit other region
  if (/\$/.test(sentence)) {
    return 'US';
  }
  return undefined;
}

export function detectUnit(sentence: string): string | undefined {
  if (/\b(?:per\s+month|\/month|\/mo|monthly)\b/i.test(sentence)) {
    return 'per month';
  }
  if (/\b(?:per\s+year|\/year|\/yr|annual|annually)\b/i.test(sentence)) {
    return 'per year';
  }
  if (/\b(?:per\s+user|\/user|per\s+seat|\/seat)\b/i.test(sentence)) {
    return 'per user';
  }
  if (/\b(?:per\s+1[kK]\s+tokens?|\/1[kK]\s+tokens?|per\s+token)\b/i.test(sentence)) {
    return 'per 1K tokens';
  }
  return undefined;
}

export function detectTimePeriod(sentence: string): string | undefined {
  if (/\b(?:in\s+20[0-2][0-9]|previously|formerly|used\s+to\s+cost|historical(?:ly)?|was|once|back\s+in|originally|rose\s+from|increased\s+from|retired|discontinued|sunset(?:ted)?|phased\s+out|no\s+longer\s+offered|grandfathered)\b/i.test(sentence)) {
    return 'historical';
  }
  if (/\b(?:now|currently|latest|as\s+of|today|is\s+now)\b/i.test(sentence)) {
    return 'current';
  }
  return undefined;
}

export function detectAttribute(category: ClaimCategory, contextText?: string, tier?: string): string {
  if (category === 'pricing') {
    if (tier?.toLowerCase() === 'extra member' || (contextText && isExplicitExtraMemberFee(contextText))) {
      const hasBasePlanPrice = /\b(?:standard|premium|basic)\s+(?:plan|tier)?\s*\(?\s*\$/i.test(contextText || '');
      if (!hasBasePlanPrice || tier?.toLowerCase() === 'extra member') {
        return 'Extra member add-on price';
      }
    }
    if (contextText && isDiscontinuedClaim(contextText)) {
      return 'Discontinued plan price';
    }
    return 'Subscription price';
  }
  switch (category) {
    case 'version': return 'Software version';
    case 'leadership': return 'Executive leadership role';
    case 'law': return 'Legal framework status';
    case 'date': return 'Event date / milestone';
    default: return 'Fact';
  }
}

export function extractWithRegex(text: string): Claim[] {
  const claims: Claim[] = [];
  const seen = new Set<string>();

  function add(matchContext: { sentence: string; line: string; clause: string }, category: ClaimCategory, value: string) {
    const contextText = matchContext.sentence;
    const clauseText = matchContext.clause;
    const tier = detectTier(contextText, clauseText);
    const { entity, product } = detectEntity(contextText, text);
    const region = detectRegion(contextText);
    const unit = detectUnit(contextText);
    const timePeriod = detectTimePeriod(contextText);
    const attribute = detectAttribute(category, clauseText && clauseText.includes(value) ? clauseText : contextText, tier);

    // Context-rich deduplication: prevents dropping distinct tiers with identical prices or historical vs current
    const key = `${category}:${value.toLowerCase().trim()}:${(tier || '').toLowerCase()}:${contextText.slice(0, 40).toLowerCase().trim()}`;
    if (!seen.has(key)) {
      seen.add(key);
      claims.push({
        id: uuidv4(),
        text: contextText.trim(),
        category,
        extractedValue: value.trim(),
        likelihood: VOLATILITY[category],
        entity,
        product,
        tier,
        region,
        unit,
        timePeriod,
        attribute,
        enclosingSentence: matchContext.sentence.trim(),
      });
    }
  }

  for (const m of text.matchAll(VERSION_RE)) {
    const idx = m.index ?? 0;
    add(getEnclosingContext(text, idx, m[0].length), 'version', m[0]);
  }
  for (const m of text.matchAll(PRICE_RE)) {
    const idx = m.index ?? 0;
    add(getEnclosingContext(text, idx, m[0].length), 'pricing', m[0]);
  }
  for (const m of text.matchAll(DATE_RE)) {
    const idx = m.index ?? 0;
    add(getEnclosingContext(text, idx, m[0].length), 'date', m[0]);
  }
  for (const m of text.matchAll(LAW_RE)) {
    const idx = m.index ?? 0;
    add(getEnclosingContext(text, idx, m[0].length), 'law', m[0]);
  }
  for (const m of text.matchAll(CEO_RE)) {
    const idx = m.index ?? 0;
    add(getEnclosingContext(text, idx, m[0].length), 'leadership', m[0]);
  }
  const staleMatches = [...text.matchAll(STALE_RE)];
  if (staleMatches.length > 0) {
    const idx = staleMatches[0].index ?? 0;
    add(getEnclosingContext(text, idx, staleMatches[0][0].length), 'fact', staleMatches[0][0].toLowerCase());
  }
  return claims;
}

const SYSTEM_PROMPT = `You are a factual claim extraction specialist. Extract ONLY time-sensitive factual claims that could become stale or outdated.
Focus on: subscription prices/costs, software versions, laws/regulations, company leadership roles, specific years/dates, and claims asserting "latest", "current", or "as of".

For every extracted claim, output a structured JSON object with:
- text: exact quote or enclosing sentence/bullet from the text
- category: one of "pricing", "version", "date", "law", "leadership", "fact"
- extractedValue: specific value (e.g., "$15.49", "v18.2", "Linda Yaccarino")
- entity: brand, company, or organization (e.g., "Netflix", "OpenAI", "Twitter")
- product: specific product or service if applicable (e.g., "Netflix", "React", "GPT-4")
- tier: plan or tier if applicable (e.g., "Standard", "Premium", "Standard with Ads", "Pro", "Basic", "Extra Member")
- attribute: what is being measured (e.g., "Subscription price", "Extra member add-on price", "Discontinued plan price", "Stable version", "CEO")
- unit: unit or frequency if applicable (e.g., "per month", "monthly", "per year")
- region: geographic market if mentioned (e.g., "US", "UK", "EU")
- timePeriod: timeframe if mentioned (e.g., "current", "historical", "2024")
- likelihood: staleness risk from 0.0 to 1.0

CRITICAL RULES:
- Distinguish base subscription plans (e.g. Standard, Premium) from extra-member add-ons. If a price is for an extra member / additional member slot, set attribute to "Extra member add-on price" and tier to "Extra Member".
- If a plan is stated as retired, discontinued, or historical, set timePeriod to "historical" and attribute to "Discontinued plan price".

Return ONLY valid JSON matching this schema:
{"claims": [{"text": "...", "category": "...", "extractedValue": "...", "entity": "...", "product": "...", "tier": "...", "attribute": "...", "unit": "...", "region": "...", "timePeriod": "...", "likelihood": 0.9}]}
If no time-sensitive claims exist, return: {"claims": []}`;

function parseJsonFromText(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {}
  const match = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (match) {
    try {
      return JSON.parse(match[1]);
    } catch {}
  }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    return JSON.parse(raw.slice(start, end + 1));
  }
  throw new Error('No valid JSON object found in response');
}

export async function extractClaims(text: string): Promise<ExtractionResult> {
  const geminiKey = process.env.GEMINI_API_KEY?.trim();

  // 1. Try Google Gemini API with 12s timeout and structured schema
  if (geminiKey) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${geminiKey}`;
      const res = await axios.post(
        endpoint,
        {
          contents: [
            {
              parts: [
                {
                  text: `${SYSTEM_PROMPT}\n\nExtract time-sensitive claims from:\n\n${text.slice(0, 8000)}`,
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.1,
            maxOutputTokens: 1024,
          },
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 12000,
        }
      );

      const raw = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (raw) {
        const parsed = parseJsonFromText(raw) as {
          claims: Array<{
            text: string;
            category: string;
            extractedValue: string;
            likelihood?: number;
            entity?: string;
            product?: string;
            tier?: string;
            attribute?: string;
            unit?: string;
            region?: string;
            timePeriod?: string;
          }>;
        };
        if (parsed && Array.isArray(parsed.claims)) {
          const claims: Claim[] = parsed.claims.map(c => {
            const rawCat = (c.category || 'fact') as ClaimCategory;
            const validCat: ClaimCategory = ['pricing', 'version', 'date', 'law', 'leadership', 'fact'].includes(rawCat) ? rawCat : 'fact';
            const claimText = String(c.text || '').trim();
            const extractedVal = String(c.extractedValue || '').trim();
            const isExplicitExtra = isExplicitExtraMemberFee(claimText);
            const isDiscontinued = isDiscontinuedClaim(claimText);

            let tier = c.tier?.trim();
            if (!tier) {
              tier = detectTier(claimText);
            } else if (tier.toLowerCase() === 'extra member' && !isExplicitExtra) {
              const detected = detectTier(claimText);
              if (detected && detected !== 'Extra Member') {
                tier = detected;
              }
            }

            const { entity, product } = detectEntity(claimText, text);
            const region = c.region?.trim() || detectRegion(claimText);
            const unit = c.unit?.trim() || detectUnit(claimText);

            let timePeriod = c.timePeriod?.trim() || detectTimePeriod(claimText);
            if (isDiscontinued && timePeriod !== 'historical') {
              timePeriod = 'historical';
            }

            let attribute = c.attribute?.trim();
            if (isDiscontinued) {
              attribute = 'Discontinued plan price';
            } else if (tier === 'Extra Member' || isExplicitExtra) {
              attribute = 'Extra member add-on price';
            } else if (!attribute || attribute === 'Extra member add-on price') {
              attribute = detectAttribute(validCat, claimText);
            }

            return {
              id: uuidv4(),
              text: claimText,
              category: validCat,
              extractedValue: extractedVal,
              likelihood: Math.min(1, Math.max(0, Number(c.likelihood) || VOLATILITY[validCat] || 0.5)),
              entity: c.entity?.trim() || entity,
              product: c.product?.trim() || product,
              tier,
              attribute,
              unit,
              region,
              timePeriod,
              enclosingSentence: claimText,
            };
          });
          return { claims, fromLLM: true };
        }
      }
    } catch (err: any) {
      console.warn('[FreshnessGuard] Gemini extraction failed — checking fallback:', err.message);
    }
  }

  // 2. Deterministic regex fallback
  return { claims: extractWithRegex(text), fromLLM: false };
}
