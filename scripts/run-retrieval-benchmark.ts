import { readFileSync } from "node:fs";
import { assertNoBenchmarkAuthorityEnvironment, assertReceipt, redactedReceipt, validateBenchmarkManifest, type BenchmarkManifest } from "../src/lib/retrieval/benchmark-contract.ts";
import { runNativeHttp } from "../src/lib/retrieval/benchmark-runners/native-http.ts";
import { runPlaywright } from "../src/lib/retrieval/benchmark-runners/playwright.ts";
import { recommendedRunner, scoreBenchmark } from "../src/lib/retrieval/benchmark-scorecard.ts";

const manifestPath = process.argv[2];
if (!manifestPath) throw new Error("Usage: run-retrieval-benchmark.ts <manifest.json>");
assertNoBenchmarkAuthorityEnvironment();
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as BenchmarkManifest;
validateBenchmarkManifest(manifest);
const receipts = await Promise.all(manifest.targets.flatMap((target) => [runNativeHttp(target, manifest.fixtureOrigin), runPlaywright(target, manifest.fixtureOrigin)]));
for (const receipt of receipts) assertReceipt(manifest, redactedReceipt(receipt));
const scorecard = scoreBenchmark(manifest, receipts);
console.log(JSON.stringify({ receipts, scorecard, recommendedRunner: recommendedRunner(scorecard) }));
