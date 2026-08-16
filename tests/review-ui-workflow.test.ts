import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryReviewRepository, RevisionConflictError, reviewProvenance } from "../src/lib/repositories/review.ts";
import { readFileSync } from "node:fs";
import { postReview } from "../src/lib/review/post-review.ts";

test("approval stores a field subset and stale decisions fail compare-and-swap", () => {
  const reviews = new InMemoryReviewRepository();
  const candidate = reviews.stage({ id: "c1", proposedValues: { address: "2 New St", phone: "555-1212" }, evidence: ["official", "google"] });
  const approved = reviews.decide({ candidateId: candidate.id, expectedRevision: 1, reviewerSubject: "reviewer-1", action: "approved", fields: ["address"], reason: "Both sources agree." });
  assert.deepEqual(approved.approvedValues, { address: "2 New St" });
  assert.throws(() => reviews.decide({ candidateId: candidate.id, expectedRevision: 1, reviewerSubject: "reviewer-2", action: "rejected", reason: "stale" }), RevisionConflictError);
});

test("CBO eligibility is an explicit terminal review label", () => {
  const reviews = new InMemoryReviewRepository();
  reviews.stage({ id: "cbo", proposedValues: { address: "2 New St" } });
  const rejected = reviews.decide({ candidateId: "cbo", expectedRevision: 1, reviewerSubject: "reviewer-1", action: "rejected", reason: "Address is wrong, but the organization qualifies.", reviewerCboEligibility: true });
  assert.equal(rejected.decisions[0]?.cboEligibility, true);
  const deferred = new InMemoryReviewRepository();
  deferred.stage({ id: "defer", proposedValues: { address: "2 New St" } });
  assert.throws(() => deferred.decide({ candidateId: "defer", expectedRevision: 1, reviewerSubject: "reviewer-1", action: "deferred", reason: "Need more evidence.", reviewerCboEligibility: true }));
});

test("route rejects nonterminal eligibility labels before review mutation", async () => {
  const request = (action: "edit" | "deferred") => new Request("https://example.test/api/review", { method: "POST", body: JSON.stringify({ candidateId: "candidate", expectedRevision: 1, action, proposedValues: { address: "2 New St" }, reason: "test", reviewerCboEligibility: true }) });
  const dependencies = {
    auth: async () => ({ userId: "reviewer-1" }),
    requireWorkspaceRole: async () => undefined,
    supersede: async () => assert.fail("supersede must not run"),
    decide: async () => assert.fail("decide must not run"),
    errorStatus: () => 400
  };
  for (const action of ["edit", "deferred"] as const) {
    const response = await postReview(request(action), dependencies);
    assert.equal(response.status, 400);
    assert.match((await response.json() as { error: string }).error, /only accompany approval or rejection/i);
  }
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

test("operator controls make all-due audit server-owned and prevent a second launch while it is in flight", () => {
  const controls = readFileSync(new URL("../src/app/review/run-controls.tsx", import.meta.url), "utf8");
  assert.match(controls, /const \[busy, setBusy\] = useState\(false\)/);
  assert.match(controls, /Audit all due listings/);
  assert.match(controls, /mode: "manual_full_cycle"/);
  assert.match(controls, /useState\(dueCount \|\| 1\)/);
  assert.doesNotMatch(controls, /for \(let index = 0; index < selected\.length/);
  assert.match(controls, /window\.location\.assign\(`\/review\/runs\/\$\{run\.id\}`\)/);
});

test("operator controls send selected and all-due work to the durable run dashboard", () => {
  const controls = readFileSync(new URL("../src/app/review/run-controls.tsx", import.meta.url), "utf8");
  assert.match(controls, /Run a selected spot check instead/);
  assert.match(controls, /Audit selected/);
  assert.match(controls, /Approved checkpoint budget/);
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
  assert.match(page, /SiteReports/);
  assert.match(page, /listRecentSiteReports/);
  const status = readFileSync(new URL("../src/app/review/run-status.tsx", import.meta.url), "utf8");
  assert.match(status, /Run history/);
  assert.match(status, /providerFailures/);
  assert.match(page, /CalibrationSummary/);
});

test("seeded-resource picker is scoped to the current reconciled baseline", () => {
  const repository = readFileSync(new URL("../src/lib/repositories/review.ts", import.meta.url), "utf8");
  assert.match(repository, /async listSeededResources[\s\S]*refresh_snapshot_memberships[\s\S]*status = 'reconciled'[\s\S]*order by promoted_at desc/);
});

test("every completed resource has a durable, evidence-linked report surface", () => {
  const reports = readFileSync(new URL("../src/app/review/site-reports.tsx", import.meta.url), "utf8");
  const registry = readFileSync(new URL("../src/lib/runs/index.ts", import.meta.url), "utf8");
  assert.match(reports, /Resource reports/);
  assert.match(reports, /Keep — no supported change/);
  assert.match(reports, /Review possible closure/);
  assert.match(reports, /Verification incomplete/);
  assert.match(reports, /View evidence and reasoning/);
  assert.match(registry, /report_delta->'siteReport'/);
  assert.match(registry, /run_checkpoint_outcomes/);
});

test("operator workflow separates current audits from planned new-resource discovery", () => {
  const page = readFileSync(new URL("../src/app/review/page.tsx", import.meta.url), "utf8");
  assert.match(page, /Check current listings/);
  assert.match(page, /Find new resources/);
  assert.match(page, /Backend lane next/);
});

test("review provenance exposes only redacted, structured advisory evidence", () => {
  const provenance = reviewProvenance({ observations: [{ provider: "official", state: "found", observedAt: "2026-08-13T00:00:00Z", excerpt: "api_key=secret", values: { phone: "555-1212", ignored: 3 } }], advisory: { cboEligibility: "likely_cbo", citations: ["official"] } });
  assert.equal(provenance.observations[0]?.excerpt, "api_key=[redacted]");
  assert.deepEqual(provenance.observations[0]?.values, { phone: "555-1212" });
  assert.equal(provenance.advisory?.cboEligibility, "likely_cbo");
  assert.deepEqual(provenance.advisory?.citations, ["official"]);
  const detail = readFileSync(new URL("../src/app/review/[candidateId]/page.tsx", import.meta.url), "utf8");
  assert.match(detail, /ReviewProvenanceCard/);
});

test("review queue accepts bounded filters and detail includes human decision history", () => {
  const reviews = new InMemoryReviewRepository();
  reviews.stage({ id: "c3", proposedValues: { address: "2 New St" }, provenance: { observations: [], advisory: { evidenceQuality: "high" } } });
  reviews.stage({ id: "c4", proposedValues: { address: "3 New St" }, provenance: { observations: [], advisory: { evidenceQuality: "low" } } });
  assert.deepEqual(reviews.list({ evidenceQuality: "high" }).map((candidate) => candidate.id), ["c3"]);
  const api = readFileSync(new URL("../src/app/api/review/route.ts", import.meta.url), "utf8");
  assert.match(api, /evidenceQuality/);
  const detail = readFileSync(new URL("../src/app/review/[candidateId]/page.tsx", import.meta.url), "utf8");
  assert.match(detail, /ReviewHistory/);
  const repository = readFileSync(new URL("../src/lib/repositories/review.ts", import.meta.url), "utf8");
  assert.match(repository, /with recursive lineage/);
  assert.match(repository, /'superseded'::text/);
  assert.match(repository, /provenance->'reviewerEdit'/);
  assert.match(repository, /reviewer_cbo_eligibility/);
});
