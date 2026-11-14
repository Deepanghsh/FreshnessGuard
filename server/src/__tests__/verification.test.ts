
import { extractVerdict, verifyClaim, verifyClaims } from '../services/verification';
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
});

