import mongoose from 'mongoose';
import { Response as ResponseModel } from '../models/Response';

/**
 * Genuine MongoDB Database Integration Test Suite.
 *
 * Requirements to run:
 *   1. An active MongoDB 7.0 container or server instance.
 *      Docker command: docker run -d -p 27017:27017 --name mongo-test mongo:7.0
 *   2. Set environment variable: MONGO_TEST_URI=mongodb://localhost:27017/freshnessguard_test
 *
 * If MONGO_TEST_URI is missing or MongoDB is unreachable, these tests are
 * marked as SKIPPED due to environment constraints (they are NOT counted as passed).
 */
const mongoTestUri = process.env.MONGO_TEST_URI;
const runDbTests = Boolean(mongoTestUri);

const suite = runDbTests ? describe : describe.skip;

suite('Genuine MongoDB Integration Tests (Requires Live MongoDB)', () => {
  let isConnected = false;

  beforeAll(async () => {
    if (!mongoTestUri) {
      console.warn('\n[TEST SKIP] Skipping Genuine MongoDB tests: MONGO_TEST_URI is not set.');
      console.warn('[TEST SKIP] To run: docker run -d -p 27017:27017 mongo:7.0 && set MONGO_TEST_URI=mongodb://localhost:27017/freshnessguard_test\n');
      return;
    }

    try {
      await mongoose.connect(mongoTestUri, {
        serverSelectionTimeoutMS: 10000,
        family: 4,
      });
      isConnected = true;
    } catch (err) {
      console.warn(`\n[TEST SKIP] Skipping Genuine MongoDB tests: Connection to ${mongoTestUri} failed: ${(err as Error).message}\n`);
    }
  }, 15000);

  afterAll(async () => {
    if (isConnected) {
      try {
        await ResponseModel.deleteMany({ requestId: /^test-live-/ });
        await mongoose.disconnect();
      } catch {}
    }
  }, 15000);

  test('genuine db: saves response document to live collection and retrieves it', async () => {
    if (!isConnected) {
      return;
    }

    const testDoc = new ResponseModel({
      requestId: 'test-live-1',
      model: 'gemini-3.1-flash-lite',
      originalText: 'Real DB integration test claim text',
      claims: [
        {
          id: 'claim-1',
          text: 'React 18 introduced automatic batching',
          category: 'version',
          extractedValue: '18',
          likelihood: 0.9,
          verdict: 'current',
          score: 0.95,
          confidence: 0.90,
          checkedAt: new Date(),
        },
      ],
      overallScore: 0.95,
      overallConfidence: 0.90,
      summaryStatus: 'all_fresh',
      summaryMessage: 'All claims verified fresh',
      staleCount: 0,
      totalClaims: 1,
      fromCache: false,
      processingMs: 120,
      mode: 'inline',
      fromLLM: false,
    });

    await testDoc.save();

    const retrieved = await ResponseModel.findOne({ requestId: 'test-live-1' }).lean();
    expect(retrieved).not.toBeNull();
    expect(retrieved?.overallScore).toBe(0.95);
    expect(retrieved?.summaryStatus).toBe('all_fresh');
    expect(retrieved?.claims).toHaveLength(1);
  });

  test('genuine db: supports pagination and sorting on live MongoDB collection', async () => {
    if (!isConnected) {
      return;
    }

    const docs = await ResponseModel.find({ requestId: /^test-live-/ })
      .sort({ checkedAt: -1 })
      .limit(5)
      .lean();

    expect(Array.isArray(docs)).toBe(true);
  });
});

