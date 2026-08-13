import assert from "node:assert/strict";
import test from "node:test";
import { isReconciledBaseline } from "../src/lib/repositories/review.ts";

test("web verification requires a succeeded, count-reconciled baseline", () => {
  assert.equal(isReconciledBaseline({ outcome: "succeeded", sourceRows: 2, insertedSnapshots: 2, unchanged: 0, skipped: 0, failed: 0 }), true);
  assert.equal(isReconciledBaseline({ outcome: "succeeded", sourceRows: 2, insertedSnapshots: 1, unchanged: 0, skipped: 0, failed: 0 }), false);
  assert.equal(isReconciledBaseline({ outcome: "failed", sourceRows: 2, insertedSnapshots: 2, unchanged: 0, skipped: 0, failed: 0 }), false);
});
