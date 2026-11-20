import axios from 'axios';
import { extractClaims } from '../services/extraction';

// Mock axios so tests don't make real network calls to Gemini
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('extractClaims', () => {
  beforeEach(() => {
    delete process.env.GEMINI_API_KEY;
    jest.clearAllMocks();
  });

  it('falls back to regex when GEMINI_API_KEY is absent', async () => {
    const result = await extractClaims('The API costs $20/month and uses SDK v1.2.3');
    expect(result.fromLLM).toBe(false);
    expect(result.claims.length).toBeGreaterThan(0);
  });

  it('regex extracts version claims', async () => {
    const result = await extractClaims('Use SDK v2.0.1 for best results');
    const versions = result.claims.filter(c => c.category === 'version');
    expect(versions.length).toBeGreaterThan(0);
    expect(versions[0].extractedValue).toBe('v2.0.1');
  });

  it('regex extracts price claims', async () => {
    const result = await extractClaims('The plan costs $29.99/month');
    const prices = result.claims.filter(c => c.category === 'pricing');
    expect(prices.length).toBeGreaterThan(0);
    expect(prices[0].likelihood).toBeGreaterThan(0.8);
  });

  it('regex extracts year claims', async () => {
    const result = await extractClaims('This was updated in 2024');
    const dates = result.claims.filter(c => c.category === 'date');
    expect(dates.length).toBeGreaterThan(0);
  });

  it('uses Gemini LLM when GEMINI_API_KEY is set', async () => {
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    claims: [
                      { text: 'v1.2.3', category: 'version', extractedValue: 'v1.2.3', likelihood: 0.90 },
                      { text: '$29.99/month', category: 'pricing', extractedValue: '$29.99/month', likelihood: 0.95 },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      },
    });

    const result = await extractClaims('The API costs $29/month');
    expect(result.fromLLM).toBe(true);
    expect(result.claims.length).toBe(2);
    expect(result.claims[0].category).toBe('version');
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    delete process.env.GEMINI_API_KEY;
  });

  it('falls back to regex on Gemini LLM error', async () => {
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    mockedAxios.post.mockRejectedValueOnce(new Error('Network timeout'));

    const result = await extractClaims('Use Python 3.11, it costs $0 (open source)');
    expect(result.fromLLM).toBe(false);
    expect(result.claims.length).toBeGreaterThan(0);
    delete process.env.GEMINI_API_KEY;
  });

  it('returns empty array or appropriate categories for stable text', async () => {
    const result = await extractClaims('The sky is blue and water is wet');
    result.claims.forEach(c => {
      expect(['pricing', 'version', 'date', 'law', 'leadership', 'fact']).toContain(c.category);
    });
  });

  describe('Structured Claim Extraction & Context Preservation', () => {
    it('preserves structured entity, tier, region, and unit from text', async () => {
      const text = 'Netflix Standard plan in the US costs $15.49 per month.';
      const result = await extractClaims(text);
      expect(result.claims.length).toBeGreaterThan(0);
      const claim = result.claims.find(c => c.category === 'pricing');
      expect(claim).toBeDefined();
      expect(claim?.entity?.toLowerCase()).toBe('netflix');
      expect(claim?.tier?.toLowerCase()).toBe('standard');
      expect(claim?.region).toBe('US');
      expect(claim?.unit).toBe('per month');
      expect(claim?.enclosingSentence).toContain('$15.49');
    });

    it('distinguishes multiple product tiers in the same text without dropping claims', async () => {
      const text = `Netflix Pricing in the US:
- Standard with Ads: $6.99 per month
- Standard: $15.49 per month
- Premium: $22.99 per month`;
      const result = await extractClaims(text);
      const pricingClaims = result.claims.filter(c => c.category === 'pricing');
      expect(pricingClaims.length).toBe(3);

      const tiers = pricingClaims.map(c => c.tier?.toLowerCase());
      expect(tiers).toContain('standard with ads');
      expect(tiers).toContain('standard');
      expect(tiers).toContain('premium');
    });

    it('does not deduplicate claims based on price alone when belonging to different tiers or sentences', async () => {
      const text = `Grandfathered Basic plan is $9.99 per month.
In 2015, Netflix Standard was also $9.99 per month.`;
      const result = await extractClaims(text);
      const pricingClaims = result.claims.filter(c => c.category === 'pricing');
      // Both claims must be preserved because they have different tiers/context
      expect(pricingClaims.length).toBe(2);
    });

    it('detects historical versus current timeframe indicators', async () => {
      const histText = 'In 2015, Netflix Standard was $9.99 per month.';
      const currText = 'Netflix Standard is now $19.99 per month.';

      const histResult = await extractClaims(histText);
      const currResult = await extractClaims(currText);

      expect(histResult.claims[0]?.timePeriod).toBe('historical');
      expect(currResult.claims[0]?.timePeriod).toBe('current');
    });

    it('distinguishes extra member add-on from base subscription tier', async () => {
      const text = 'Option to add one "extra member" (who doesn\'t live with you) for an additional $7.99/month.';
      const result = await extractClaims(text);
      expect(result.claims.length).toBeGreaterThan(0);
      const claim = result.claims[0];
      expect(claim.tier?.toLowerCase()).toBe('extra member');
      expect(claim.attribute).toBe('Extra member add-on price');
    });

    it('identifies retired/discontinued plans and classifies timeframe as historical', async () => {
      const text = 'Netflix has officially retired its $11.99/month "Basic" plan for new and rejoining members.';
      const result = await extractClaims(text);
      expect(result.claims.length).toBeGreaterThan(0);
      const claim = result.claims[0];
      expect(claim.tier?.toLowerCase()).toBe('basic');
      expect(claim.timePeriod).toBe('historical');
      expect(claim.attribute).toBe('Discontinued plan price');
    });

    it('parses structured LLM fields from Gemini API when provided', async () => {
      process.env.GEMINI_API_KEY = 'test-gemini-key';
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      claims: [
                        {
                          text: 'Netflix Standard plan in the US costs $15.49 per month.',
                          category: 'pricing',
                          extractedValue: '$15.49',
                          entity: 'Netflix',
                          product: 'Netflix',
                          tier: 'Standard',
                          attribute: 'Subscription price',
                          unit: 'per month',
                          region: 'US',
                          timePeriod: 'current',
                          likelihood: 0.95,
                        },
                      ],
                    }),
                  },
                ],
              },
            },
          ],
        },
      });

      const result = await extractClaims('Netflix Standard plan in the US costs $15.49 per month.');
      expect(result.fromLLM).toBe(true);
      expect(result.claims).toHaveLength(1);
      const c = result.claims[0];
      expect(c.entity).toBe('Netflix');
      expect(c.tier).toBe('Standard');
      expect(c.region).toBe('US');
      expect(c.unit).toBe('per month');
      expect(c.timePeriod).toBe('current');
      expect(c.attribute).toBe('Subscription price');
      delete process.env.GEMINI_API_KEY;
    });

    describe('Tier Attribution and Eligibility Regressions', () => {
      it('correctly classifies Standard $15.49 in an extra-member eligibility bullet as Standard tier', async () => {
        const text = '* Standard Plan ($15.49/month): You can add one extra member.';
        const result = await extractClaims(text);
        expect(result.fromLLM).toBe(false);
        const claim = result.claims.find(c => c.extractedValue.includes('15.49'));
        expect(claim).toBeDefined();
        expect(claim?.tier).toBe('Standard');
        expect(claim?.attribute).toBe('Subscription price');
      });

      it('correctly classifies Premium $22.99 in an extra-member eligibility bullet as Premium tier', async () => {
        const text = '* Premium Plan ($22.99/month): You can add up to two extra members.';
        const result = await extractClaims(text);
        expect(result.fromLLM).toBe(false);
        const claim = result.claims.find(c => c.extractedValue.includes('22.99'));
        expect(claim).toBeDefined();
        expect(claim?.tier).toBe('Premium');
        expect(claim?.attribute).toBe('Subscription price');
      });

      it('correctly classifies actual extra-member $7.99 with ads as Extra Member add-on fee', async () => {
        const text = 'Extra member slot with ads costs $7.99/month.';
        const result = await extractClaims(text);
        expect(result.fromLLM).toBe(false);
        const claim = result.claims.find(c => c.extractedValue.includes('7.99'));
        expect(claim).toBeDefined();
        expect(claim?.tier).toBe('Extra Member');
        expect(claim?.attribute).toBe('Extra member add-on price');
      });

      it('correctly classifies actual extra-member $9.99 without ads as Extra Member add-on fee', async () => {
        const text = 'Extra member slot without ads costs $9.99/month.';
        const result = await extractClaims(text);
        expect(result.fromLLM).toBe(false);
        const claim = result.claims.find(c => c.extractedValue.includes('9.99'));
        expect(claim).toBeDefined();
        expect(claim?.tier).toBe('Extra Member');
        expect(claim?.attribute).toBe('Extra member add-on price');
      });

      it('extracts all three plans plus extra member slot with accurate tier attribution when appearing together', async () => {
        const text = `Netflix US subscription plans:
* Standard with Ads ($6.99/month): Ad-supported streaming.
* Standard Plan ($15.49/month): You can add one extra member.
* Premium Plan ($22.99/month): You can add up to two extra members.
* Extra member slot costs $7.99/month.`;

        const result = await extractClaims(text);
        expect(result.fromLLM).toBe(false);

        const stdAds = result.claims.find(c => c.extractedValue.includes('6.99'));
        const std = result.claims.find(c => c.extractedValue.includes('15.49'));
        const prem = result.claims.find(c => c.extractedValue.includes('22.99'));
        const extra = result.claims.find(c => c.extractedValue.includes('7.99'));

        expect(stdAds).toBeDefined();
        expect(stdAds?.tier).toBe('Standard with Ads');
        expect(stdAds?.attribute).toBe('Subscription price');

        expect(std).toBeDefined();
        expect(std?.tier).toBe('Standard');
        expect(std?.attribute).toBe('Subscription price');

        expect(prem).toBeDefined();
        expect(prem?.tier).toBe('Premium');
        expect(prem?.attribute).toBe('Subscription price');

        expect(extra).toBeDefined();
        expect(extra?.tier).toBe('Extra Member');
        expect(extra?.attribute).toBe('Extra member add-on price');
      });

      it('falls back to regex and preserves tier attribution when Gemini API returns HTTP 503', async () => {
        process.env.GEMINI_API_KEY = 'test-gemini-key';
        const error503 = new Error('Request failed with status code 503');
        (error503 as any).response = { status: 503, data: { error: { message: 'This model is currently experiencing high demand.' } } };
        mockedAxios.post.mockRejectedValueOnce(error503);

        const text = '* Standard Plan ($15.49/month): You can add one extra member.';
        const result = await extractClaims(text);
        expect(result.fromLLM).toBe(false);
        const claim = result.claims.find(c => c.extractedValue.includes('15.49'));
        expect(claim?.tier).toBe('Standard');
        expect(claim?.attribute).toBe('Subscription price');

        delete process.env.GEMINI_API_KEY;
      });
    });
  });
});
