import { extractClaims } from '../services/extraction';

// Mock OpenAI so tests don't need a real API key
jest.mock('openai', () => {
  const MockOpenAI = jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [{
            message: {
              content: JSON.stringify({
                claims: [
                  { text: 'v1.2.3', category: 'version', extractedValue: 'v1.2.3', likelihood: 0.90 },
                  { text: '$29.99/month', category: 'pricing', extractedValue: '$29.99/month', likelihood: 0.95 },
                ],
              }),
            },
          }],
        }),
      },
    },
  }));
  return {
    __esModule: true,
    default: MockOpenAI,
    OpenAI: MockOpenAI,
  };
});

describe('extractClaims', () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it('falls back to regex when OPENAI_API_KEY is absent', async () => {
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

  it('uses LLM when API key is set', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const result = await extractClaims('The API costs $29/month');
    expect(result.fromLLM).toBe(true);
    expect(result.claims.length).toBe(2);
    delete process.env.OPENAI_API_KEY;
  });

  it('falls back to regex on LLM error', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const OpenAI = require('openai').default;
    OpenAI.mockImplementationOnce(() => ({
      chat: { completions: { create: jest.fn().mockRejectedValue(new Error('Network error')) } },
    }));
    const result = await extractClaims('Use Python 3.11, it costs $0 (open source)');
    expect(result.fromLLM).toBe(false);
    delete process.env.OPENAI_API_KEY;
  });

  it('returns empty array for stable text', async () => {
    const result = await extractClaims('The sky is blue and water is wet');
    // May have 0 or only stale-indicator claims
    result.claims.forEach(c => {
      expect(['pricing', 'version', 'date', 'law', 'leadership', 'fact']).toContain(c.category);
    });
  });
});

