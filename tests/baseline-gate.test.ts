import assert from "node:assert/strict";
import test from "node:test";
import { isReconciledBaseline } from "../src/lib/repositories/review.ts";
import { assertHostedVerificationConfigured, verificationReadiness } from "../src/lib/verification/readiness.ts";

test("web verification requires a succeeded, count-reconciled baseline", () => {
  assert.equal(isReconciledBaseline({ outcome: "succeeded", sourceRows: 2, insertedSnapshots: 2, unchanged: 0, skipped: 0, failed: 0 }), true);
  assert.equal(isReconciledBaseline({ outcome: "succeeded", sourceRows: 2, insertedSnapshots: 1, unchanged: 0, skipped: 0, failed: 0 }), false);
  assert.equal(isReconciledBaseline({ outcome: "failed", sourceRows: 2, insertedSnapshots: 2, unchanged: 0, skipped: 0, failed: 0 }), false);
});

test("verification readiness blocks a missing workspace, baseline, or required configuration without exposing values", async () => {
  const readiness = await verificationReadiness({
    checkWorkspace: async () => { throw new Error("Dedicated workspace required."); },
    checkBaseline: async () => undefined,
    env: { FIRECRAWL_API_KEY: "test-secret" }
  });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.checks.find((check) => check.name === "workspace")?.ready, false);
  assert.match(readiness.checks.find((check) => check.name === "configuration")?.message ?? "", /GOOGLE_MAPS_API_KEY/);
  assert.doesNotMatch(JSON.stringify(readiness), /test-secret/);
  assert.throws(() => assertHostedVerificationConfigured({}), /FIRECRAWL_API_KEY/);
});

test("manual verification accepts Exa without requiring scheduler credentials", () => {
  assert.doesNotThrow(() => assertHostedVerificationConfigured({
    FIRECRAWL_API_KEY: "firecrawl", GOOGLE_MAPS_API_KEY: "google", EXA_API_KEY: "exa",
    AZURE_OPENAI_ENDPOINT: "https://example.openai.azure.com", AZURE_OPENAI_API_KEY: "azure",
    AZURE_OPENAI_DEPLOYMENT: "gpt-5.6-sol"
  }));
});
