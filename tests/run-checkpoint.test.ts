import assert from "node:assert/strict";
import test from "node:test";
import { processVerificationCheckpoint } from "../src/lib/verification/run-checkpoint.ts";

const resource = { id: "r1", name: "Example Pantry", address: "1 Old St" };
const observedAt = "2026-08-13T00:00:00Z";

test("a corroborated update stages its exact before value", async () => {
  let staged: unknown;
  const output = await processVerificationCheckpoint({
    resource,
    observations: [
      { provider: "firecrawl", state: "success", observedAt, values: { address: "2 New St" } },
      { provider: "google_places", state: "success", observedAt, values: { address: "2 New St" } }
    ],
    advisory: { promptVersion: "cbo-audit-v1", cboEligibility: "confirmed_cbo", operationalAssessment: "open", evidenceQuality: "high", citations: ["firecrawl", "google_places"], rationale: "Corroborated." },
    stage: async (input) => { staged = input; }
  });
  assert.equal(output.result.state, "candidate_update");
  assert.equal(output.outcome, "candidate_staged");
  assert.deepEqual(staged, { kind: "update", beforeValues: { address: "1 Old St" }, proposedValues: { address: "2 New St" }, observations: output.result.observations, advisory: output.result.advisory });
});

test("a Google-only closure is staged for review without a closed field", async () => {
  let staged: { kind: string; proposedValues: Record<string, string> } | undefined;
  const output = await processVerificationCheckpoint({
    resource,
    observations: [{ provider: "google_places", state: "success", observedAt, values: { businessStatus: "closed" } }],
    stage: async (input) => { staged = input; }
  });
  assert.equal(output.result.state, "conflict");
  assert.equal(output.outcome, "conflict");
  assert.equal(staged?.kind, "closure_review");
  assert.deepEqual(staged?.proposedValues, {});
});

test("a not-CBO advisory stages a human eligibility review without a field change", async () => {
  let staged: { kind: string; beforeValues: Record<string, string>; proposedValues: Record<string, string> } | undefined;
  const output = await processVerificationCheckpoint({
    resource,
    observations: [{ provider: "google_places", state: "success", observedAt }],
    advisory: { cboEligibility: "not_a_cbo", operationalAssessment: "open", evidenceQuality: "high", citations: ["google_places"], rationale: "This is a public beach." },
    stage: async (input) => { staged = input; }
  });
  assert.equal(output.result.state, "no_change");
  assert.equal(output.outcome, "candidate_staged");
  assert.equal(output.report.candidatesStaged, 1);
  assert.deepEqual(staged && { kind: staged.kind, beforeValues: staged.beforeValues, proposedValues: staged.proposedValues }, { kind: "eligibility_review", beforeValues: { cbo_eligibility: "not assessed" }, proposedValues: { cbo_eligibility: "not a CBO" } });
});

test("blocked sources are counted as unable to verify without staging a candidate", async () => {
  let staged = false;
  const output = await processVerificationCheckpoint({
    resource,
    observations: [{ provider: "firecrawl", state: "rate_limited", observedAt }],
    stage: async () => { staged = true; }
  });
  assert.equal(output.result.state, "unable_to_verify");
  assert.equal(output.outcome, "unable_to_verify");
  assert.equal(output.report.candidatesStaged, 0);
  assert.equal(output.report.unableToVerify, 1);
  assert.equal(staged, false);
});
