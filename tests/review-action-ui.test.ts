import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("review detail renders field-level actions through the protected API", () => {
  const page = readFileSync(new URL("../src/app/review/[candidateId]/page.tsx", import.meta.url), "utf8");
  const actions = readFileSync(new URL("../src/app/review/review-actions.tsx", import.meta.url), "utf8");
  assert.match(page, /ReviewActions/);
  assert.match(page, /candidateStatus=\{candidate\.status\}/);
  assert.match(page, /conflict-note/);
  assert.match(actions, /candidateId,\s*expectedRevision/);
  assert.match(actions, /Approve fields/);
  assert.match(actions, /Save edited proposal/);
  assert.match(actions, /Defer/);
  assert.match(actions, /Reject/);
  assert.match(actions, /\/api\/review/);
  assert.match(actions, /const \[busy, setBusy\] = useState\(false\)/);
  assert.match(actions, /window\.location\.assign/);
  assert.match(actions, /candidateStatus !== "staged" && candidateStatus !== "deferred"/);
  assert.match(actions, /no longer accepts review actions/);
});

test("a closure conflict requires a separate closed-status proposal and approval", () => {
  const actions = readFileSync(new URL("../src/app/review/review-actions.tsx", import.meta.url), "utf8");
  const detail = readFileSync(new URL("../src/app/review/[candidateId]/page.tsx", import.meta.url), "utf8");
  assert.match(actions, /Propose status: closed/);
  assert.match(actions, /\{ status: "closed" \}/);
  assert.match(actions, /action === "confirm_closed" \? "edit"/);
  assert.match(detail, /closed-status proposal for a separate approval/);
});

test("historical site reports retain their candidate link after a later revision", () => {
  const registry = readFileSync(new URL("../src/lib/runs/index.ts", import.meta.url), "utf8");
  const reportQuery = registry.slice(registry.indexOf("async listRecentSiteReports"), registry.indexOf("async status", registry.indexOf("async listRecentSiteReports")));
  assert.match(reportQuery, /exists \(\s*select 1 from review_workspace\.candidate_revisions run_revision/is);
  assert.doesNotMatch(reportQuery, /state\.candidate_revision_id = revision\.id/);
});
