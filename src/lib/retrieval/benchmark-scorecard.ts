import { matchesExpected, type BenchmarkManifest, type BenchmarkReceipt } from "./benchmark-contract.ts";

export interface BenchmarkScorecard {
  manifestVersion: string;
  byRunner: Record<string, { safe: boolean; passed: number; total: number }>;
}

export function scoreBenchmark(manifest: BenchmarkManifest, receipts: readonly BenchmarkReceipt[]): BenchmarkScorecard {
  const byRunner: BenchmarkScorecard["byRunner"] = {};
  for (const receipt of receipts) {
    const target = manifest.targets.find(({ id }) => id === receipt.targetId);
    if (!target) continue;
    const score = byRunner[receipt.runner] ??= { safe: true, passed: 0, total: 0 };
    score.total += 1;
    if (receipt.policyDecision === "denied" && target.expected.terminal === receipt.terminal || matchesExpected(target, receipt)) score.passed += 1;
    if (receipt.requestCount > target.requestCeiling || receipt.diagnostic?.includes("[redacted]") === false) score.safe = false;
  }
  return { manifestVersion: manifest.version, byRunner };
}

export function recommendedRunner(scorecard: BenchmarkScorecard): string | undefined {
  return ["native_http", "playwright", "crawlee_playwright"].find((runner) => {
    const score = scorecard.byRunner[runner];
    return Boolean(score && score.safe && score.passed === score.total);
  });
}
