import assert from "node:assert/strict";
import test from "node:test";
import { summarizeCalibration } from "../src/lib/verification/calibration.ts";

test("calibration groups reviewed advisory outcomes by prompt version without identifiers", () => {
  const summaries = summarizeCalibration([
    { promptVersion: "v1", cboEligibility: "confirmed_cbo", decision: "approved" },
    { promptVersion: "v1", cboEligibility: "not_a_cbo", decision: "rejected" },
    { promptVersion: "v1", cboEligibility: "insufficient_evidence", decision: "rejected" },
    { promptVersion: "v1", cboEligibility: "likely_cbo", decision: "approved", reviewerCboEligibility: true },
    { promptVersion: "v1", cboEligibility: "not_a_cbo", decision: "approved", reviewerCboEligibility: true },
    { promptVersion: "v2", cboEligibility: "likely_cbo", decision: "deferred" }
  ]);
  assert.deepEqual(summaries, [
    { promptVersion: "v1", reviewed: 5, comparable: 2, aligned: 1, disagreed: 1, insufficientEvidence: 1, deferred: 0 },
    { promptVersion: "v2", reviewed: 1, comparable: 0, aligned: 0, disagreed: 0, insufficientEvidence: 0, deferred: 1 }
  ]);
});
