import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertNoBenchmarkAuthorityEnvironment, assertReceipt, matchesExpected, redactedReceipt, validateBenchmarkManifest, type BenchmarkManifest } from "../src/lib/retrieval/benchmark-contract.ts";

const manifest: BenchmarkManifest = {
  version: "v1",
  fixtureOrigin: "http://127.0.0.1:4100",
  targets: [{ id: "static", url: "http://127.0.0.1:4100/static", requestCeiling: 1, expected: { terminal: "success", values: { name: "Example Pantry" } } }]
};

test("benchmark manifest remains fixture-bound and receipts remain redacted", () => {
  validateBenchmarkManifest(manifest);
  assert.throws(() => validateBenchmarkManifest({ ...manifest, targets: [{ ...manifest.targets[0]!, url: "https://example.org" }] }), /outside the fixture origin/);
  const receipt = redactedReceipt({ targetId: "static", runner: "native_http", runnerVersion: "test", requestedUrl: manifest.targets[0]!.url, policyDecision: "allowed", elapsedMs: 1, requestCount: 1, terminal: "success", values: { name: "Example Pantry" }, diagnostic: "authorization: secret" });
  assertReceipt(manifest, receipt);
  assert.equal(receipt.diagnostic, "authorization=[redacted]");
  assert.equal(matchesExpected(manifest.targets[0]!, receipt), true);
  assert.throws(() => assertReceipt(manifest, { ...receipt, requestCount: 2 }), /ceiling/);
  assert.throws(() => assertNoBenchmarkAuthorityEnvironment({ REVIEW_DATABASE_URL: "postgres://not-used" }), /REVIEW_DATABASE_URL/);
  assert.doesNotThrow(() => validateBenchmarkManifest(JSON.parse(readFileSync(new URL("./fixtures/retrieval-benchmark/manifest.json", import.meta.url), "utf8"))));
});
