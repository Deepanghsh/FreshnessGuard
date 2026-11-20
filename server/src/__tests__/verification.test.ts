
import {
  extractVerdict,
  verifyClaim,
  verifyClaims,
  getCanonicalDomain,
  isOfficialDomain,
  assessSourceReliability,
  filterSyndicatedDuplicates,
  buildSearchQuery,
} from '../services/verification';
import type { Claim } from '../types/index';

// Mock tavily SDK
const mockSearch = jest.fn();
jest.mock('@tavily/core', () => ({
  tavily: jest.fn(() => ({
    search: mockSearch,
  })),
}));

describe('Verification Service — extractVerdict', () => {
  const versionClaim: Claim = {
    id: 'c1',
    text: 'React 18.2.0 is the latest version.',
    category: 'version',
    extractedValue: '18.2.0',
    likelihood: 0.9,
  };

  const pricingClaim: Claim = {
    id: 'c2',
    text: 'GPT-4 costs $0.03 per 1K tokens.',
    category: 'pricing',
    extractedValue: '$0.03',
    likelihood: 0.95,
  };

  const leadershipClaim: Claim = {
    id: 'c3',
    text: 'Parag Agrawal is the CEO of Twitter.',
    category: 'leadership',
    extractedValue: 'Parag Agrawal',
    likelihood: 0.85,
  };

  it('detects current version when sources corroborate exact version without higher versions', () => {
    const verdict = extractVerdict(
      'The current stable version of React is 18.2.0.',
      versionClaim,
      [{ title: 'React Docs', url: 'https://docs.react.dev', content: 'React 18.2.0 release notes' }]
    );
    expect(verdict.verdict).toBe('current');
    expect(verdict.liveValue).toBeUndefined();
  });

  it('detects stale version when a higher version is affirmed in evidence', () => {
    const verdict = extractVerdict(
      'React 19.0.0 has been released and is now the current stable version.',
      versionClaim,
      [{ title: 'React 19 Release', url: 'https://react.dev/blog', content: 'React 19.0 is now available' }]
    );
    expect(verdict.verdict).toBe('stale');
    expect(verdict.liveValue).toBe('19.0.0');
    expect(verdict.correctedText).toContain('19.0.0');
  });

  it('detects stale pricing when a new price figure is identified', () => {
    const verdict = extractVerdict(
      'GPT-4o costs $2.50 per 1M tokens, reducing costs compared to older models.',
      pricingClaim,
      [{ title: 'OpenAI Pricing', url: 'https://openai.com/pricing', content: 'GPT-4o is $2.50 per 1m tokens' }]
    );
    expect(verdict.verdict).toBe('stale');
    expect(verdict.liveValue).toBeDefined();
    expect(verdict.liveValue).toContain('$2.50');
  });

  // Regression tests for pricing verification
  it('detects stale pricing when historical and current prices appear together in one evidence snippet', () => {
    const netflixClaim: Claim = {
      id: 'eval-05',
      text: 'Netflix Standard plan in the US is $9.99 per month.',
      category: 'pricing',
      extractedValue: '$9.99 per month',
      likelihood: 0.95,
    };
    const verdict = extractVerdict(
      undefined,
      netflixClaim,
      [{
        title: 'Subscription Pricing 2026',
        url: 'https://example.com/netflix',
        content: "Once upon a time, Netflix cost $9.99/month. Netflix's Standard plan is now $19.99 per month, up $2 from last year."
      }]
    );
    expect(verdict.verdict).toBe('stale');
    expect(verdict.liveValue).toBe('$19.99');
    expect(verdict.correctedText).toBe('Netflix Standard plan in the US is $19.99.');
  });

  it('detects stale pricing with explicit price increase wording', () => {
    const amazonClaim: Claim = {
      id: 'eval-07',
      text: 'Amazon Prime costs $99 per year in the US.',
      category: 'pricing',
      extractedValue: '$99',
      likelihood: 0.95,
    };
    const verdict = extractVerdict(
      undefined,
      amazonClaim,
      [{
        title: 'Amazon Prime Updates',
        url: 'https://example.com/prime',
        content: 'Amazon Prime raised the annual subscription from $99 to $139.'
      }]
    );
    expect(verdict.verdict).toBe('stale');
    expect(verdict.liveValue).toBe('$139');
    expect(verdict.correctedText).toBe('Amazon Prime costs $139 per year in the US.');
  });

  it('preserves product relevance and ignores unrelated product prices', () => {
    const spotifyClaim: Claim = {
      id: 'eval-06',
      text: 'Spotify Premium Individual is $11.99 per month in the United States.',
      category: 'pricing',
      extractedValue: '$11.99 per month',
      likelihood: 0.95,
    };
    const verdict = extractVerdict(
      undefined,
      spotifyClaim,
      [
        {
          title: 'Spotify Plans',
          url: 'https://spotify.com/premium',
          content: 'Spotify Premium Individual is $11.99 per month in the United States.'
        },
        {
          title: 'GoodRx and other services',
          url: 'https://example.com/subscriptions',
          content: 'GoodRx is now $14.99 per month and Netflix is now $19.99.'
        }
      ]
    );
    expect(verdict.verdict).toBe('current');
    expect(verdict.liveValue).toBeUndefined();
  });

  it('confirms a genuinely unchanged price as current', () => {
    const chatGptClaim: Claim = {
      id: 'c-chatgpt',
      text: 'ChatGPT Plus costs $20 per month.',
      category: 'pricing',
      extractedValue: '$20 per month',
      likelihood: 0.95,
    };
    const verdict = extractVerdict(
      undefined,
      chatGptClaim,
      [{
        title: 'OpenAI Pricing',
        url: 'https://openai.com/pricing',
        content: 'ChatGPT Plus subscription remains $20 per month with no price changes announced.'
      }]
    );
    expect(verdict.verdict).toBe('current');
    expect(verdict.liveValue).toBeUndefined();
  });

  it('detects stale pricing for exact Netflix reproduction claim using live Tavily evidence sources', () => {
    const netflixClaim: Claim = {
      id: '1905a73c-5643-41f7-8bf2-de2e72688119',
      text: 'Netflix Standard plan in the US is $9.99 per month.',
      category: 'pricing',
      extractedValue: '$9.99 per month',
      likelihood: 0.9215,
    };
    const liveTavilySources = [
      {
        url: 'https://familypro.io/en/blog/netflix-plans-price',
        title: 'Netflix Plans and Prices: Compare the 3 US Plans',
        content:
          'Netflix has three monthly prices in the US: $8.99 for Standard with ads, $19.99 for Standard, and $26.99 for Premium. If you can accept ads and only need one or two devices playing at once, consider the lowest-priced plan.',
      },
      {
        url: 'https://keepingupwithinflation.com/tracker/netflix',
        title:
          'Netflix Price History (2015–2026): Standard Plan From $9.99 to $19.99 | Keeping Up With Inflation',
        content:
          'Historical Data\n| 2015 | $9.99 |\n| 2026 | $19.99 |\nAnalysis: Netflix\'s Standard ad-free plan reached $19.99/month in March 2026 — up $2 from $17.99 after a broad U.S. price increase that also raised the ad-supported tier to $8.99 and Premium to $26.99. From the 2015 U.S. standard price of $9.99, that is roughly a doubling.',
      },
      {
        url: 'https://checkthat.ai/brands/netflix/pricing',
        title: 'Netflix Pricing 2026: Total Cost & Competitors Compared - Netflix',
        content:
          'If two simultaneous streams cover your needs and you don\'t require 4K, Netflix Standard at $19.99/month keeps things simple with no ads and full library access. | Standard | $19.99 | Not offered | 2 |',
      },
      {
        url: 'https://www.businessinsider.com/guides/streaming/netflix-price?r=US&IR=T',
        title:
          'Netflix Prices (2026): Monthly Cost for Every Subscription Plan - Business Insider',
        content:
          'Subscription plan\nMonthly price\nStandard\n$19.99\nExtra member fees: $7.99 with ads / $9.99 without ads (up to 1 member)',
      },
    ];

    const verdict = extractVerdict(undefined, netflixClaim, liveTavilySources);
    expect(verdict.verdict).toBe('stale');
    expect(verdict.liveValue).toBe('$19.99');
    expect(verdict.correctedText).toBe('Netflix Standard plan in the US is $19.99.');
  });

  it('returns unverified when pricing evidence is ambiguous or purely historical', () => {
    const netflixClaim: Claim = {
      id: 'eval-05-hist',
      text: 'Netflix Standard plan in the US is $9.99 per month.',
      category: 'pricing',
      extractedValue: '$9.99 per month',
      likelihood: 0.95,
    };
    const verdict = extractVerdict(
      undefined,
      netflixClaim,
      [{
        title: 'Streaming History and Evolution',
        url: 'https://example.com/streaming-history',
        content: 'In 2015, Netflix Standard cost $9.99 per month. Since then, streaming pricing models have evolved significantly across the industry.'
      }]
    );
    expect(verdict.verdict).toBe('unverified');
    expect(verdict.liveValue).toBeUndefined();
  });

  describe('Tier disambiguation & multi-plan verification regressions', () => {
    const netflixContext = `No, that price is not current. Netflix discontinued the "Basic" plan (which was $9.99/month) for new and returning members in the U.S. in 2023.
As of early 2024, here are the current Netflix pricing options in the United States:
* Standard with ads: $6.99 per month
* Standard: $15.49 per month (allows ad-free viewing and 1080p resolution)
* Premium: $22.99 per month (allows ad-free viewing, 4K UHD + HDR, and spatial audio)`;

    const multiTierSource = {
      title: 'Netflix Prices (2026): Monthly Cost for Every Subscription Plan - Business Insider',
      url: 'https://www.businessinsider.com/guides/streaming/netflix-price',
      content: `Here's a breakdown of Netflix prices for each plan.
Subscription plan Monthly price
Standard with Ads
$8.99
Standard
$19.99
Extra member fees: $7.99 with ads / $9.99 without ads
Extra members with ads: $7.99/month, without ads: $9.99/month
Premium
$26.99
Netflix has officially retired its $11.99/month Basic plan for new subscribers.`,
    };

    it('corrects Standard with ads ($6.99 -> $8.99) and does not confuse with higher tiers', () => {
      const claim: Claim = {
        id: 'claim-ads',
        text: 'Standard with ads: $6.99 per month',
        category: 'pricing',
        extractedValue: '$6.99',
        likelihood: 0.95,
      };
      const verdict = extractVerdict(undefined, claim, [multiTierSource], netflixContext);
      expect(verdict.verdict).toBe('stale');
      expect(verdict.liveValue).toBe('$8.99');
      expect(verdict.correctedText).toBe('Standard with ads: $8.99 per month');
    });

    it('corrects Standard ad-free ($15.49 -> $19.99) and strictly excludes Standard with ads ($8.99)', () => {
      const claim: Claim = {
        id: 'claim-std',
        text: 'Standard: $15.49 per month',
        category: 'pricing',
        extractedValue: '$15.49',
        likelihood: 0.95,
      };
      const verdict = extractVerdict(undefined, claim, [multiTierSource], netflixContext);
      expect(verdict.verdict).toBe('stale');
      expect(verdict.liveValue).toBe('$19.99');
      expect(verdict.correctedText).toBe('Standard: $19.99 per month');
    });

    it('corrects Premium ($22.99 -> $26.99) and strictly excludes YouTube Premium ($13.99) and lower tiers', () => {
      const claim: Claim = {
        id: 'claim-prem',
        text: 'Premium: $22.99 per month',
        category: 'pricing',
        extractedValue: '$22.99',
        likelihood: 0.95,
      };
      const verdict = extractVerdict(undefined, claim, [multiTierSource], netflixContext);
      expect(verdict.verdict).toBe('stale');
      expect(verdict.liveValue).toBe('$26.99');
      expect(verdict.correctedText).toBe('Premium: $26.99 per month');
    });

    it('detects historical price transition (Basic plan raised from $9.99 to $11.99)', () => {
      const claim: Claim = {
        id: 'claim-basic-hist',
        text: 'Netflix discontinued the "Basic" plan (which was $9.99/month) for new and returning members in the U.S. in 2023.',
        category: 'pricing',
        extractedValue: '$9.99',
        likelihood: 0.95,
      };
      const histSource = {
        title: 'The Complete History of Netflix Price Hikes',
        url: 'https://flixed.io/netflix-price-hikes',
        content: 'In October of 2023, Netflix raised the price of its Basic plan by $2, from $9.99 to $11.99 before phasing it out.',
      };
      const verdict = extractVerdict(undefined, claim, [histSource], netflixContext);
      expect(verdict.verdict).toBe('stale');
      expect(verdict.liveValue).toBe('$11.99');
    });

    it('returns unverified when multiple sources yield conflicting prices for the same plan', () => {
      const claim: Claim = {
        id: 'claim-std-conflict',
        text: 'Netflix Standard plan is $15.49 per month',
        category: 'pricing',
        extractedValue: '$15.49',
        likelihood: 0.95,
      };
      const sourceA = {
        title: 'Source A',
        url: 'https://example.com/a',
        content: 'Netflix Standard plan costs $19.99 per month.',
      };
      const sourceB = {
        title: 'Source B',
        url: 'https://example.com/b',
        content: 'Netflix Standard plan costs $24.99 per month.',
      };
      const verdict = extractVerdict(undefined, claim, [sourceA, sourceB], netflixContext);
      expect(verdict.verdict).toBe('unverified');
      expect(verdict.liveValue).toBeUndefined();
    });

    it('rejects cross-product misattribution when evidence mentions unrelated service (e.g. YouTube Premium for Netflix claim)', () => {
      const claim: Claim = {
        id: 'claim-cross-product',
        text: 'Premium: $22.99 per month',
        category: 'pricing',
        extractedValue: '$22.99 per month',
        likelihood: 0.95,
      };
      const youtubeSource = {
        title: 'YouTube Premium Price Increase',
        url: 'https://example.com/youtube',
        content: 'YouTube Premium is now $13.99 per month for individual users.',
      };
      const verdict = extractVerdict(undefined, claim, [youtubeSource], netflixContext);
      expect(verdict.verdict).toBe('unverified');
      expect(verdict.liveValue).toBeUndefined();
    });

    it('verifies valid extra member add-on price ($7.99/mo) as current and does not change to Standard ($19.99)', () => {
      const claim: Claim = {
        id: 'claim-extra-799',
        text: 'Option to add one "extra member" (who doesn\'t live with you) for an additional $7.99/month.',
        category: 'pricing',
        extractedValue: '$7.99',
        tier: 'Extra Member',
        attribute: 'Extra member add-on price',
        likelihood: 0.95,
      };
      const verdict = extractVerdict(undefined, claim, [multiTierSource], netflixContext);
      expect(verdict.verdict).toBe('current');
      expect(verdict.liveValue).toBeUndefined();
    });

    it('verifies valid extra member add-on without ads ($9.99/mo) as current and does not change to Standard ($19.99)', () => {
      const claim: Claim = {
        id: 'claim-extra-999',
        text: 'Option to add an extra member without ads for $9.99 per month.',
        category: 'pricing',
        extractedValue: '$9.99',
        tier: 'Extra Member',
        attribute: 'Extra member add-on price',
        likelihood: 0.95,
      };
      const verdict = extractVerdict(undefined, claim, [multiTierSource], netflixContext);
      expect(verdict.verdict).toBe('current');
      expect(verdict.liveValue).toBeUndefined();
    });

    it('corrects outdated extra member fee ($4.99 -> $7.99) and strictly prevents assigning base Standard ($19.99)', () => {
      const claim: Claim = {
        id: 'claim-extra-stale',
        text: 'Option to add an extra member for an additional $4.99/month.',
        category: 'pricing',
        extractedValue: '$4.99',
        tier: 'Extra Member',
        attribute: 'Extra member add-on price',
        likelihood: 0.95,
      };
      const verdict = extractVerdict(undefined, claim, [multiTierSource], netflixContext);
      expect(verdict.verdict).toBe('stale');
      expect(verdict.liveValue).toBe('$7.99');
      expect(verdict.liveValue).not.toBe('$19.99');
    });

    it('marks $7.99 extra-member claim as unverified when evidence mentions Netflix but no add-on pricing', () => {
      const claim: Claim = {
        id: 'claim-extra-799-unrelated',
        text: 'Option to add an extra member for $7.99 per month.',
        category: 'pricing',
        extractedValue: '$7.99',
        tier: 'Extra Member',
        attribute: 'Extra member add-on price',
        likelihood: 0.95,
      };
      const unrelatedNetflixSource = {
        title: 'Netflix 2026 Earnings and Content Slate',
        url: 'https://example.com/netflix-earnings',
        content: 'Netflix announced new subscriber numbers and a standard plan at $15.49 and premium at $22.99. Some other service charges $7.99.',
      };
      const verdict = extractVerdict(undefined, claim, [unrelatedNetflixSource], netflixContext);
      expect(verdict.verdict).toBe('unverified');
      expect(verdict.liveValue).toBeUndefined();
    });

    it('marks $9.99 extra-member claim as unverified when evidence mentions Netflix but no add-on pricing', () => {
      const claim: Claim = {
        id: 'claim-extra-999-unrelated',
        text: 'Option to add an extra member without ads for $9.99 per month.',
        category: 'pricing',
        extractedValue: '$9.99',
        tier: 'Extra Member',
        attribute: 'Extra member add-on price',
        likelihood: 0.95,
      };
      const unrelatedNetflixSource = {
        title: 'Netflix Historical Overview',
        url: 'https://example.com/netflix-history',
        content: 'Netflix originally cost $9.99 for DVD rentals in 2010. Today Standard is $19.99.',
      };
      const verdict = extractVerdict(undefined, claim, [unrelatedNetflixSource], netflixContext);
      expect(verdict.verdict).toBe('unverified');
      expect(verdict.liveValue).toBeUndefined();
    });

    it('marks historical $7.99 mention without current confirmation as unverified for a current-price claim', () => {
      const claim: Claim = {
        id: 'claim-extra-799-hist',
        text: 'Option to add an extra member for $7.99 per month.',
        category: 'pricing',
        extractedValue: '$7.99',
        tier: 'Extra Member',
        attribute: 'Extra member add-on price',
        likelihood: 0.95,
      };
      const historicalSource = {
        title: 'Netflix Password Sharing Rollout History',
        url: 'https://example.com/netflix-history-addon',
        content: 'Netflix extra members were previously $7.99 per month back in 2023 when the crackdown began.',
      };
      const verdict = extractVerdict(undefined, claim, [historicalSource], netflixContext);
      expect(verdict.verdict).toBe('unverified');
      expect(verdict.liveValue).toBeUndefined();
    });

    it('marks an unsupported $6.99 extra-member claim as unverified', () => {
      const claim: Claim = {
        id: 'claim-extra-699-unsupported',
        text: 'Option to add an extra member for $6.99 per month.',
        category: 'pricing',
        extractedValue: '$6.99',
        tier: 'Extra Member',
        attribute: 'Extra member add-on price',
        likelihood: 0.95,
      };
      const adsOnlySource = {
        title: 'Netflix Standard with Ads',
        url: 'https://example.com/netflix-ads',
        content: 'Netflix Standard with ads costs $6.99 per month. No extra member slots are available on this plan.',
      };
      const verdict = extractVerdict(undefined, claim, [adsOnlySource], netflixContext);
      expect(verdict.verdict).toBe('unverified');
      expect(verdict.liveValue).toBeUndefined();
    });

    it('ensures a valid Standard plan price ($19.99) does not validate an extra-member claim', () => {
      const claim: Claim = {
        id: 'claim-extra-1999',
        text: 'Netflix extra member costs $19.99 per month.',
        category: 'pricing',
        extractedValue: '$19.99',
        tier: 'Extra Member',
        attribute: 'Extra member add-on price',
        likelihood: 0.95,
      };
      const standardSource = {
        title: 'Netflix Plan Pricing Guide',
        url: 'https://example.com/netflix-plans',
        content: 'The Netflix Standard plan is $19.99 per month in the US with 1080p streaming.',
      };
      const verdict = extractVerdict(undefined, claim, [standardSource], netflixContext);
      expect(verdict.verdict).toBe('unverified');
      expect(verdict.liveValue).toBeUndefined();
    });

    it('preserves historically accurate retired Basic plan ($11.99/mo) as current and does not replace with Standard ($19.99)', () => {
      const claim: Claim = {
        id: 'claim-basic-retired',
        text: 'Netflix has officially retired its $11.99/month "Basic" plan for new and rejoining members.',
        category: 'pricing',
        extractedValue: '$11.99',
        tier: 'Basic',
        timePeriod: 'historical',
        attribute: 'Discontinued plan price',
        likelihood: 0.95,
      };
      const verdict = extractVerdict(undefined, claim, [multiTierSource], netflixContext);
      expect(verdict.verdict).toBe('current');
      expect(verdict.liveValue).toBeUndefined();
    });

    it('marks discontinued plan with unknown price as unverified rather than inventing a replacement price', () => {
      const claim: Claim = {
        id: 'claim-legacy-discontinued',
        text: 'Netflix discontinued its legacy plan at $5.00/month.',
        category: 'pricing',
        extractedValue: '$5.00',
        tier: 'Legacy',
        timePeriod: 'historical',
        attribute: 'Discontinued plan price',
        likelihood: 0.95,
      };
      const verdict = extractVerdict(undefined, claim, [multiTierSource], netflixContext);
      expect(verdict.verdict).toBe('unverified');
      expect(verdict.liveValue).toBeUndefined();
    });
  });

  it('ignores unrelated product and unrelated tier prices when evaluating a specific plan tier', () => {
    const netflixClaim: Claim = {
      id: 'eval-05-unrelated',
      text: 'Netflix Standard plan in the US is $9.99 per month.',
      category: 'pricing',
      extractedValue: '$9.99 per month',
      likelihood: 0.95,
    };
    const verdict = extractVerdict(
      undefined,
      netflixClaim,
      [{
        title: 'Streaming News',
        url: 'https://example.com/streaming-news',
        content: 'Netflix Premium is now $26.99 per month, while competitor HBO Max is $15.99 per month. Standard plan details were not disclosed.'
      }]
    );
    expect(verdict.verdict).toBe('unverified');
    expect(verdict.liveValue).toBeUndefined();
  });

  it('detects stale leadership when a different executive is named', () => {
    const verdict = extractVerdict(
      'Linda Yaccarino is the current CEO of X (formerly Twitter).',
      leadershipClaim,
      [{ title: 'X Leadership', url: 'https://x.com/about', content: 'CEO is Linda Yaccarino appointed in 2023' }]
    );
    expect(verdict.verdict).toBe('stale');
    expect(verdict.liveValue).toBe('Linda Yaccarino');
  });

  // Regression test: US President claims must also detect a changed officeholder.
  it('detects stale US President claim when current evidence names a different president', () => {
    const usPresidentClaim: Claim = {
      id: 'c5',
      text: 'The current president of the United States is Joe Biden.',
      category: 'leadership',
      extractedValue: 'The current president of the United States is Joe Biden',
      likelihood: 0.85,
    };

    const verdict = extractVerdict(
      'Donald Trump is the current President of the United States.',
      usPresidentClaim,
      [{
        title: 'The White House - President',
        url: 'https://www.whitehouse.gov/administration/donald-j-trump/',
        content: 'Donald Trump is the 47th President of the United States.',
      }]
    );

    expect(verdict.verdict).toBe('stale');
    expect(verdict.liveValue).toBe('Donald Trump');
  });

  it('detects stale when explicit invalidation / deprecation keywords appear', () => {
    const lawClaim: Claim = {
      id: 'c4',
      text: 'Section 4 is actively enforced.',
      category: 'law',
      extractedValue: 'Section 4',
      likelihood: 0.65,
    };
    const verdict = extractVerdict(
      'Section 4 was repealed and superseded by the 2024 Reform Act.',
      lawClaim,
      [{ title: 'Legal Update', url: 'https://law.gov', content: 'Repealed by 2024 Act' }]
    );
    expect(verdict.verdict).toBe('stale');
  });

  it('returns unverified when evidence is completely empty', () => {
    const verdict = extractVerdict(null, versionClaim, []);
    expect(verdict.verdict).toBe('unverified');
  });

  it('returns unverified when evidence is ambiguous and does not mention the value', () => {
    const verdict = extractVerdict(
      'General programming guide discussing modern JavaScript frameworks.',
      versionClaim,
      [{ title: 'JS Overview', url: 'https://example.com', content: 'Framework comparison' }]
    );
    expect(verdict.verdict).toBe('unverified');
  });
});

describe('Verification Service — verifyClaim & Tavily API integration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    mockSearch.mockReset();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('skips verification safely when TAVILY_API_KEY is not set', async () => {
    delete process.env.TAVILY_API_KEY;
    const claim: Claim = {
      id: 'c1',
      text: 'Test claim',
      category: 'version',
      extractedValue: '1.0',
      likelihood: 0.8,
    };
    const result = await verifyClaim(claim);
    expect(result.verdict).toBe('unverified');
    expect(result.sources).toEqual([]);
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('calls Tavily API with structured options and parses results with excerpts', async () => {
    process.env.TAVILY_API_KEY = 'tvly-test-key';
    mockSearch.mockResolvedValueOnce({
      answer: 'React 19.0.0 is the latest stable version.',
      results: [
        {
          title: 'React 19 Announcement',
          url: 'https://react.dev/blog/react-19',
          content: 'React 19 is now available on npm with new features.',
          publishedDate: '2024-12-05',
          score: 0.95,
        },
      ],
    });

    const claim: Claim = {
      id: 'c1',
      text: 'React 18.2.0 is latest',
      category: 'version',
      extractedValue: '18.2.0',
      likelihood: 0.9,
    };

    const result = await verifyClaim(claim);
    expect(mockSearch).toHaveBeenCalledWith(
      expect.stringContaining('18.2.0'),
      expect.objectContaining({ maxResults: 5, includeAnswer: true })
    );
    expect(result.verdict).toBe('stale');
    expect(result.liveValue).toBe('19.0.0');
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].url).toBe('https://react.dev/blog/react-19');
    expect(result.sources[0].publishedDate).toBe('2024-12-05');
    expect(result.sources[0].content).toContain('React 19 is now available');
    expect(result.sources[0].score).toBe(0.95);
  });

  it('handles Tavily API failure / rate limit safely by returning unverified without throwing', async () => {
    process.env.TAVILY_API_KEY = 'tvly-test-key';
    mockSearch.mockRejectedValue(new Error('Tavily API rate limit exceeded (HTTP 429)'));

    const claim: Claim = {
      id: 'c1',
      text: 'Rate limited claim',
      category: 'pricing',
      extractedValue: '$100',
      likelihood: 0.9,
    };

    const result = await verifyClaim(claim);
    expect(result.verdict).toBe('unverified');
    expect(result.sources).toEqual([]);
  });

  it('verifies a list of claims with controlled concurrency', async () => {
    process.env.TAVILY_API_KEY = 'tvly-test-key';
    mockSearch.mockResolvedValue({
      answer: 'Affirmed value',
      results: [{ title: 'Doc', url: 'https://docs.example.com', content: 'value affirmed' }],
    });

    const claims: Claim[] = [
      { id: '1', text: 'claim 1', category: 'version', extractedValue: 'v1', likelihood: 0.8 },
      { id: '2', text: 'claim 2', category: 'pricing', extractedValue: '$10', likelihood: 0.7 },
      { id: '3', text: 'claim 3', category: 'leadership', extractedValue: 'John Doe', likelihood: 0.6 },
    ];

    const results = await verifyClaims(claims, 2);
    expect(results).toHaveLength(3);
    expect(mockSearch).toHaveBeenCalledTimes(3);
  });

  describe('Evidence-Grounded Verification & Corroboration Engine', () => {
    it('normalizes canonical domains correctly across subdomains and country TLDs', () => {
      expect(getCanonicalDomain('https://help.netflix.com/en/node/412')).toBe('netflix.com');
      expect(getCanonicalDomain('https://news.yahoo.co.uk/articles/123')).toBe('yahoo.co.uk');
      expect(getCanonicalDomain('https://edition.cnn.com/business')).toBe('cnn.com');
    });

    it('identifies and filters duplicate syndicated wire stories', () => {
      const results = [
        { title: 'Streaming Prices Rise in 2024 Across Major Platforms', url: 'https://news.portal-a.com/article1', content: 'Streaming services are raising prices...' },
        { title: 'Streaming Prices Rise in 2024 Across Major Platforms', url: 'https://syndicate-feed.com/article1', content: 'Streaming services are raising prices...' },
        { title: 'Exclusive: Independent Analysis of Netflix Hikes', url: 'https://analyst-blog.org/analysis', content: 'We looked into the subscription changes...' },
      ];
      const filtered = filterSyndicatedDuplicates(results);
      expect(filtered).toHaveLength(2);
      expect(filtered[0].url).toBe('https://news.portal-a.com/article1');
      expect(filtered[1].url).toBe('https://analyst-blog.org/analysis');
    });

    it('assesses source reliability objectively', () => {
      expect(assessSourceReliability({ url: 'https://netflix.com/pricing', title: 'Plans' })).toBe('high');
      expect(assessSourceReliability({ url: 'https://en.wikipedia.org/wiki/Netflix', title: 'Netflix', score: 0.90 })).toBe('high');
      expect(assessSourceReliability({ url: 'https://random-unverified-blog.xyz/post', title: 'My Thoughts', score: 0.40 })).toBe('low');
    });

    it('constructs context-aware search queries including entity, tier, and region', () => {
      const claim: Claim = {
        id: 'c-test',
        text: 'Netflix Standard plan in the US costs $15.49 per month.',
        category: 'pricing',
        extractedValue: '$15.49',
        likelihood: 0.95,
        entity: 'Netflix',
        tier: 'Standard',
        region: 'US',
      };
      const query = buildSearchQuery(claim);
      expect(query).toContain('Netflix');
      expect(query).toContain('Standard');
      expect(query).toContain('US');
      expect(query).toContain('price');
    });

    it('distinguishes historical from current prices and recognizes natural price-hike phrasing', () => {
      const claim: Claim = {
        id: 'c-netflix',
        text: 'Netflix Standard plan in the US is $9.99 per month.',
        category: 'pricing',
        extractedValue: '$9.99',
        likelihood: 0.95,
        entity: 'Netflix',
        tier: 'Standard',
      };
      const evidence = [
        {
          title: 'Netflix Pricing History and Current Rates',
          url: 'https://techcrunch.com/netflix-plans',
          content: "Once upon a time, Netflix cost $9.99/month. Netflix's Standard plan is now $19.99 per month, up $2 from last year.",
        },
      ];
      const verdict = extractVerdict(undefined, claim, evidence, 'Netflix pricing overview');
      expect(verdict.verdict).toBe('stale');
      expect(verdict.liveValue).toBe('$19.99');
      expect(verdict.correctedText).toBe('Netflix Standard plan in the US is $19.99 per month.');
    });

    it('does not treat historical evidence alone as proof that a price is current', () => {
      const claim: Claim = {
        id: 'c-hist',
        text: 'Netflix Standard plan in the US is $9.99 per month.',
        category: 'pricing',
        extractedValue: '$9.99',
        likelihood: 0.95,
        entity: 'Netflix',
        tier: 'Standard',
      };
      const evidence = [
        {
          title: 'Looking Back at 2015 Streaming Wars',
          url: 'https://archive-news.org/2015',
          content: 'In 2015, Netflix Standard was $9.99 per month, a great value at the time.',
        },
      ];
      const verdict = extractVerdict(undefined, claim, evidence, 'Netflix pricing history');
      // Historical mention alone must NOT verify as 'current'
      expect(verdict.verdict).toBe('unverified');
      expect(verdict.liveValue).toBeUndefined();
    });

    it('does not attribute prices from unrelated products or brands', () => {
      const claim: Claim = {
        id: 'c-standard',
        text: 'Netflix Standard is $15.49 per month.',
        category: 'pricing',
        extractedValue: '$15.49',
        likelihood: 0.95,
        entity: 'Netflix',
        tier: 'Standard',
      };
      const evidence = [
        {
          title: 'Streaming Comparison: YouTube vs Netflix',
          url: 'https://theverge.com/streaming-comparison',
          content: 'YouTube Premium costs $13.99 per month. Netflix Standard costs $15.49 per month.',
        },
      ];
      const verdict = extractVerdict(undefined, claim, evidence, 'Streaming guide');
      // YouTube's $13.99 must not mark Netflix Standard as stale
      expect(verdict.verdict).toBe('current');
      expect(verdict.liveValue).toBeUndefined();
    });

    it('returns unverified when sources report conflicting prices for the same exact plan', () => {
      const claim: Claim = {
        id: 'c-conflict',
        text: 'Netflix Standard is $15.49 per month.',
        category: 'pricing',
        extractedValue: '$15.49',
        likelihood: 0.95,
        entity: 'Netflix',
        tier: 'Standard',
      };
      const evidence = [
        {
          title: 'Article 1',
          url: 'https://news-a.com/netflix',
          content: 'Netflix Standard costs $17.99 per month.',
        },
        {
          title: 'Article 2',
          url: 'https://news-b.com/netflix',
          content: 'Netflix Standard costs $19.99 per month.',
        },
      ];
      const verdict = extractVerdict(undefined, claim, evidence, 'Netflix pricing');
      expect(verdict.verdict).toBe('unverified');
    });

    it('downgrades stale candidate to unverified when evidence confidence is below 0.60', async () => {
      process.env.TAVILY_API_KEY = 'test-key';
      // Low confidence: single unknown blog without publication date and low relevance score
      mockSearch.mockResolvedValueOnce({
        answer: 'I think the price is now $25.',
        results: [
          {
            url: 'https://unknown-random-blog-123.info/post',
            title: 'Some unverified rumors',
            content: 'The price might have reached $25 lately.',
            score: 0.40,
          },
        ],
      });

      const claim: Claim = {
        id: 'c-lowconf',
        text: 'Widget Pro costs $10.',
        category: 'pricing',
        extractedValue: '$10',
        likelihood: 0.9,
      };

      const result = await verifyClaim(claim);
      // Weak evidence must NOT produce an unsupported STALE verdict or invent a replacement value
      expect(result.verdict).toBe('unverified');
      expect(result.liveValue).toBeUndefined();
    });

    describe('Tier Collision & Strict Precedence Regressions', () => {
      const liveEvidence = [
        {
          title: 'CBS News - Netflix Price Hikes',
          url: 'https://cbsnews.com/netflix-pricing',
          content: 'A standard plan with ads is now $8.99 a month, up from $7.99. A standard subscription is now $19.99 a month, up from $17.99. Premium plan is now $26.99 a month. Adding an extra member will now cost $7.99 a month with ads or $9.99 without ads.',
        },
      ];

      it('corrects Standard with Ads $6.99 to $8.99', () => {
        const claim: Claim = {
          id: 'claim-std-ads',
          text: '* Standard with Ads ($6.99/month): Ad-supported streaming.',
          category: 'pricing',
          extractedValue: '$6.99',
          tier: 'Standard with Ads',
          entity: 'Netflix',
          likelihood: 0.95,
        };
        const verdict = extractVerdict(undefined, claim, liveEvidence, 'Netflix US pricing');
        expect(verdict.verdict).toBe('stale');
        expect(verdict.liveValue).toBe('$8.99');
      });

      it('corrects Standard $15.49 to $19.99, never colliding with Standard with Ads ($8.99)', () => {
        const claim: Claim = {
          id: 'claim-std',
          text: '* Standard Plan ($15.49/month): You can add one extra member.',
          category: 'pricing',
          extractedValue: '$15.49',
          tier: 'Standard',
          entity: 'Netflix',
          likelihood: 0.95,
        };
        const verdict = extractVerdict(undefined, claim, liveEvidence, 'Netflix US pricing');
        expect(verdict.verdict).toBe('stale');
        expect(verdict.liveValue).toBe('$19.99');
        expect(verdict.liveValue).not.toBe('$8.99');
        expect(verdict.liveValue).not.toBe('$7.99');
      });

      it('corrects Premium $22.99 to $26.99, never colliding with Extra Member ($7.99)', () => {
        const claim: Claim = {
          id: 'claim-prem',
          text: '* Premium Plan ($22.99/month): You can add up to two extra members.',
          category: 'pricing',
          extractedValue: '$22.99',
          tier: 'Premium',
          entity: 'Netflix',
          likelihood: 0.95,
        };
        const verdict = extractVerdict(undefined, claim, liveEvidence, 'Netflix US pricing');
        expect(verdict.verdict).toBe('stale');
        expect(verdict.liveValue).toBe('$26.99');
        expect(verdict.liveValue).not.toBe('$7.99');
      });

      it('correctly extracts prices when Standard with Ads appears immediately before Standard in search evidence', () => {
        const evidenceBefore = [
          {
            title: 'Variety',
            url: 'https://variety.com/netflix',
            content: 'Netflix Standard with Ads is $8.99, while Standard is $19.99 and Premium is $26.99.',
          },
        ];

        const stdClaim: Claim = {
          id: 'std',
          text: 'Netflix Standard costs $15.49',
          category: 'pricing',
          extractedValue: '$15.49',
          tier: 'Standard',
          entity: 'Netflix',
          likelihood: 0.95,
        };
        const verdict = extractVerdict(undefined, stdClaim, evidenceBefore, 'Netflix pricing');
        expect(verdict.verdict).toBe('stale');
        expect(verdict.liveValue).toBe('$19.99');
      });

      it('correctly handles markdown tables with Increase and New Price columns without capturing the increase', () => {
        const tableEvidence = [
          {
            title: 'TechRadar',
            url: 'https://techradar.com/netflix-plans',
            content: `| Plan Tier | Increase | New Price | No. of Devices |
| Standard With Ads | $1 | $8.99 | 2 |
| Standard (ads-free) | $2 | $19.99 | 2 |
| Premium | $2 | $26.99 | 6 |`,
          },
        ];

        const stdAdsClaim: Claim = {
          id: 'c-ads',
          text: 'Standard with ads: $6.99',
          category: 'pricing',
          extractedValue: '$6.99',
          tier: 'Standard with Ads',
          entity: 'Netflix',
          likelihood: 0.95,
        };
        const stdClaim: Claim = {
          id: 'c-std',
          text: 'Standard: $15.49',
          category: 'pricing',
          extractedValue: '$15.49',
          tier: 'Standard',
          entity: 'Netflix',
          likelihood: 0.95,
        };
        const premClaim: Claim = {
          id: 'c-prem',
          text: 'Premium: $22.99',
          category: 'pricing',
          extractedValue: '$22.99',
          tier: 'Premium',
          entity: 'Netflix',
          likelihood: 0.95,
        };

        expect(extractVerdict(undefined, stdAdsClaim, tableEvidence).liveValue).toBe('$8.99');
        expect(extractVerdict(undefined, stdClaim, tableEvidence).liveValue).toBe('$19.99');
        expect(extractVerdict(undefined, premClaim, tableEvidence).liveValue).toBe('$26.99');
      });

      it('confirms actual extra-member $7.99 with ads as current when supported by evidence', () => {
        const claim: Claim = {
          id: 'extra-ads',
          text: 'Extra member slot with ads costs $7.99/month.',
          category: 'pricing',
          extractedValue: '$7.99',
          tier: 'Extra Member',
          entity: 'Netflix',
          attribute: 'Extra member add-on price',
          likelihood: 0.95,
        };
        const verdict = extractVerdict(undefined, claim, liveEvidence, 'Netflix US pricing');
        expect(verdict.verdict).toBe('current');
      });

      it('confirms actual extra-member $9.99 without ads as current when supported by evidence', () => {
        const claim: Claim = {
          id: 'extra-no-ads',
          text: 'Extra member slot without ads costs $9.99/month.',
          category: 'pricing',
          extractedValue: '$9.99',
          tier: 'Extra Member',
          entity: 'Netflix',
          attribute: 'Extra member add-on price',
          likelihood: 0.95,
        };
        const verdict = extractVerdict(undefined, claim, liveEvidence, 'Netflix US pricing');
        expect(verdict.verdict).toBe('current');
      });

      it('returns unverified for mixed-tier evidence without clear tier attribution', () => {
        const mixedEvidence = [
          {
            title: 'General Streaming Overview',
            url: 'https://streamnews.com/prices',
            content: 'Netflix plans currently range between $8.99 and $26.99 across various streaming packages.',
          },
        ];
        const claim: Claim = {
          id: 'mixed-std',
          text: 'Netflix Standard plan costs $15.49 per month.',
          category: 'pricing',
          extractedValue: '$15.49',
          tier: 'Standard',
          entity: 'Netflix',
          likelihood: 0.95,
        };
        const verdict = extractVerdict(undefined, claim, mixedEvidence, 'Netflix pricing');
        expect(verdict.verdict).toBe('unverified');
      });
    });
  });
});

