import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryReviewRepository, RevisionConflictError } from "../src/lib/repositories/review.ts";
import { readFileSync } from "node:fs";

test("approval stores a field subset and stale decisions fail compare-and-swap", () => {
  const reviews = new InMemoryReviewRepository();
  const candidate = reviews.stage({ id: "c1", proposedValues: { address: "2 New St", phone: "555-1212" }, evidence: ["official", "google"] });
  const approved = reviews.decide({ candidateId: candidate.id, expectedRevision: 1, reviewerSubject: "reviewer-1", action: "approved", fields: ["address"], reason: "Both sources agree." });
  assert.deepEqual(approved.approvedValues, { address: "2 New St" });
  assert.throws(() => reviews.decide({ candidateId: candidate.id, expectedRevision: 1, reviewerSubject: "reviewer-2", action: "rejected", reason: "stale" }), RevisionConflictError);
});

test("a superseding edit invalidates prior approval and retains the audit history", () => {
  const reviews = new InMemoryReviewRepository();
  reviews.stage({ id: "c2", proposedValues: { address: "2 New St" } });
  const approved = reviews.decide({ candidateId: "c2", expectedRevision: 1, reviewerSubject: "reviewer-1", action: "approved", fields: ["address"], reason: "confirmed" });
  const edited = reviews.supersede({ candidateId: "c2", expectedRevision: approved.revision, proposedValues: { address: "3 New St" }, actorSubject: "reviewer-1", reason: "New evidence" });
  assert.equal(edited.status, "staged");
  assert.equal(edited.revision, 3);
  assert.equal(edited.approvedValues, undefined);
  assert.equal(reviews.history("c2").length, 3);
});

test("operator controls prevent a second launch while a pilot request is in flight", () => {
  const controls = readFileSync(new URL("../src/app/review/run-controls.tsx", import.meta.url), "utf8");
  assert.match(controls, /const \[busy, setBusy\] = useState\(false\)/);
  assert.match(controls, /disabled=\{!selected\.length \|\| busy\}/);
  assert.match(controls, /body: JSON\.stringify\(\{ limit: 1 \}\)/);
  assert.match(controls, /Cancel run/);
  assert.match(controls, /window\.location\.assign\("\/review"\)/);
});

test("operator controls preserve an unfinished run for recovery instead of relaunching it", () => {
  const controls = readFileSync(new URL("../src/app/review/run-controls.tsx", import.meta.url), "utf8");
  assert.match(controls, /sessionStorage/);
  assert.match(controls, /action: "resume"/);
});

test("review queue mounts operator controls and human-readable candidate rows", () => {
  const page = readFileSync(new URL("../src/app/review/page.tsx", import.meta.url), "utf8");
  assert.match(page, /RunControls/);
  assert.match(page, /listSeededResources/);
  assert.match(page, /resourceName/);
  assert.match(page, /ChicagoHealthMap/);
  assert.match(page, /verificationReadiness/);
  assert.match(page, /readiness-list/);
  assert.match(page, /RunStatus/);
  const status = readFileSync(new URL("../src/app/review/run-status.tsx", import.meta.url), "utf8");
  assert.match(status, /Recent verification runs/);
  assert.match(status, /providerFailures/);
});
