import { readFileSync } from "node:fs";
import { assertNoBenchmarkAuthorityEnvironment, assertReceipt, redactedReceipt, validateBenchmarkManifest, type BenchmarkManifest } from "../src/lib/retrieval/benchmark-contract.ts";
import { runNativeHttp } from "../src/lib/retrieval/benchmark-runners/native-http.ts";
import { runPlaywright } from "../src/lib/retrieval/benchmark-runners/playwright.ts";
import { runCrawleePlaywright } from "../src/lib/retrieval/benchmark-runners/crawlee-playwright.ts";
import { recommendedRunner, scoreBenchmark } from "../src/lib/retrieval/benchmark-scorecard.ts";

const manifestPath = process.argv[2];
if (!manifestPath) throw new Error("Usage: run-retrieval-benchmark.ts <manifest.json>");
assertNoBenchmarkAuthorityEnvironment();
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as BenchmarkManifest;
validateBenchmarkManifest(manifest);
const receipts = [];
for (const target of manifest.targets) {
  receipts.push(await runNativeHttp(target, manifest.fixtureOrigin));
  receipts.push(await runPlaywright(target, manifest.fixtureOrigin));
  receipts.push(await runCrawleePlaywright(target));
}
for (const receipt of receipts) assertReceipt(manifest, redactedReceipt(receipt));
const scorecard = scoreBenchmark(manifest, receipts);
console.log(JSON.stringify({ receipts, scorecard, recommendedRunner: recommendedRunner(scorecard) }));
