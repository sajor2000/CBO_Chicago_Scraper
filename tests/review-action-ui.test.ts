import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("review detail renders field-level actions through the protected API", () => {
  const page = readFileSync(new URL("../src/app/review/[candidateId]/page.tsx", import.meta.url), "utf8");
  const actions = readFileSync(new URL("../src/app/review/review-actions.tsx", import.meta.url), "utf8");
  assert.match(page, /ReviewActions/);
  assert.match(actions, /candidateId, expectedRevision, action/);
  assert.match(actions, /Approve fields/);
  assert.match(actions, /Defer/);
  assert.match(actions, /Reject/);
  assert.match(actions, /\/api\/review/);
});
