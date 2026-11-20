import * as fs from 'fs';
import * as path from 'path';

interface EvalItem {
  id: string;
  category: string;
  text: string;
  expectedVerdict: 'current' | 'stale';
  notes: string;
}

interface EvalResult {
  id: string;
  category: string;
  expected: string;
  actual: string;
  score: number;
  latencyMs: number;
  correct: boolean;
}

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';

async function runEvaluation() {
  const evalSetPath = path.join(__dirname, 'eval_set.json');
  const items: EvalItem[] = JSON.parse(fs.readFileSync(evalSetPath, 'utf8'));

  console.log(`\n======================================================`);
  console.log(` FreshnessGuard Ground-Truth Evaluation Harness`);
  console.log(` Target Server: ${SERVER_URL}`);
  console.log(` Evaluation Set: ${items.length} labeled test cases`);
  console.log(`======================================================\n`);

  const results: EvalResult[] = [];
  const latencies: number[] = [];

  let truePositives = 0;  // Expected stale, predicted stale
  let falsePositives = 0; // Expected current, predicted stale
  let trueNegatives = 0;  // Expected current, predicted current
  let falseNegatives = 0; // Expected stale, predicted current

  for (const item of items) {
    const start = Date.now();
    try {
      const response = await fetch(`${SERVER_URL}/api/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-No-Cache': 'true' },
        body: JSON.stringify({ text: item.text, model: 'gemini-3.1-flash-lite', noCache: true }),
      });

      const elapsed = Date.now() - start;
      latencies.push(elapsed);

      if (!response.ok) {
        throw new Error(`Server returned status ${response.status}`);
      }

      const data = await response.json() as any;
      const actualVerdict = (data.hasStale || (typeof data.staleCount === 'number' && data.staleCount > 0) || (Array.isArray(data.claims) && data.claims.some((c: any) => c.verdict === 'stale'))) ? 'stale' : 'current';
      const isCorrect = actualVerdict === item.expectedVerdict;

      if (item.expectedVerdict === 'stale') {
        if (actualVerdict === 'stale') truePositives++;
        else falseNegatives++;
      } else {
        if (actualVerdict === 'current') trueNegatives++;
        else falsePositives++;
      }

      results.push({
        id: item.id,
        category: item.category,
        expected: item.expectedVerdict,
        actual: actualVerdict,
        score: data.overallScore,
        latencyMs: elapsed,
        correct: isCorrect,
      });

      const mark = isCorrect ? '✅' : '❌';
      console.log(`[${mark}] ${item.id.padEnd(8)} [${item.category.padEnd(10)}] Expected: ${item.expectedVerdict.padEnd(7)} Actual: ${actualVerdict.padEnd(7)} (${elapsed}ms) Score: ${data.overallScore}`);
    } catch (err: any) {
      console.error(`[⚠️] ${item.id} Failed to evaluate:`, err.message);
    }
  }

  // Summary Metrics
  const total = results.length;
  const totalCorrect = results.filter(r => r.correct).length;
  const precision = (truePositives + falsePositives) > 0 ? truePositives / (truePositives + falsePositives) : 0;
  const recall = (truePositives + falseNegatives) > 0 ? truePositives / (truePositives + falseNegatives) : 0;
  const f1 = (precision + recall) > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const accuracy = total > 0 ? totalCorrect / total : 0;

  latencies.sort((a, b) => a - b);
  const avgLatency = latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;

  console.log(`\n======================================================`);
  console.log(` EVALUATION SUMMARY`);
  console.log(`======================================================`);
  console.log(`Total Samples:     ${total}`);
  console.log(`Accuracy:          ${(accuracy * 100).toFixed(1)}% (${totalCorrect}/${total})`);
  console.log(`Precision (Stale): ${(precision * 100).toFixed(1)}%`);
  console.log(`Recall (Stale):    ${(recall * 100).toFixed(1)}%`);
  console.log(`F1 Score:          ${f1.toFixed(3)}`);
  console.log(`Avg Latency:       ${avgLatency.toFixed(1)} ms`);
  console.log(`p50 Latency:       ${p50} ms`);
  console.log(`p95 Latency:       ${p95} ms`);
  console.log(`======================================================\n`);

  const summary = {
    evaluatedAt: new Date().toISOString(),
    metrics: { accuracy, precision, recall, f1, avgLatency, p50, p95 },
    counts: { total, truePositives, falsePositives, trueNegatives, falseNegatives },
    results,
  };

  const outputPath = path.join(__dirname, 'results.json');
  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2));
  console.log(`Detailed results saved to: ${outputPath}\n`);
}

runEvaluation().catch(console.error);

