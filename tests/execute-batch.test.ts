import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("execute route processes one checkpoint, sets maxDuration, and releases leases on failure", () => {
  const route = readFileSync(new URL("../src/app/api/runs/[runId]/execute/route.ts", import.meta.url), "utf8");
  assert.match(route, /export const maxDuration = 60/);
  assert.match(route, /claimNext\(runId\)/);
  assert.match(route, /completeCheckpoint\(runId, claim\.leaseToken, output\.report\)/);
  assert.match(route, /releaseLease\(runId, leaseToken\)/);
  assert.doesNotMatch(route, /for \(let index = 0; index < limit/);
});
