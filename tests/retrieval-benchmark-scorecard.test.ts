import assert from "node:assert/strict";
import test from "node:test";
import { type BenchmarkManifest } from "../src/lib/retrieval/benchmark-contract.ts";
import { recommendedRunner, scoreBenchmark } from "../src/lib/retrieval/benchmark-scorecard.ts";

test("scorecard retains accuracy separately from safety", () => {
  const manifest: BenchmarkManifest = { version: "v1", fixtureOrigin: "http://127.0.0.1:4100", targets: [{ id: "static", url: "http://127.0.0.1:4100/static", requestCeiling: 1, expected: { terminal: "success", values: { name: "Example Pantry" } } }] };
  const scorecard = scoreBenchmark(manifest, [
    { targetId: "static", runner: "native_http", runnerVersion: "test", requestedUrl: manifest.targets[0]!.url, policyDecision: "allowed", elapsedMs: 1, requestCount: 1, terminal: "success", values: { name: "Example Pantry" } },
    { targetId: "static", runner: "playwright", runnerVersion: "test", requestedUrl: manifest.targets[0]!.url, policyDecision: "allowed", elapsedMs: 1, requestCount: 2, terminal: "success", values: { name: "Example Pantry" } }
  ]);
  assert.deepEqual(scorecard.byRunner.native_http, { safe: true, passed: 1, total: 1 });
  assert.deepEqual(scorecard.byRunner.playwright, { safe: false, passed: 1, total: 1 });
  assert.equal(recommendedRunner(scorecard), "native_http");
});
