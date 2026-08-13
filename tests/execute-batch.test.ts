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

test("execution bounds provider work and passes its lease to candidate staging", () => {
  const route = readFileSync(new URL("../src/app/api/runs/[runId]/execute/route.ts", import.meta.url), "utf8");
  const repository = readFileSync(new URL("../src/lib/repositories/review.ts", import.meta.url), "utf8");
  assert.match(route, /within\(hostedEvidence\.collect\(resource\), 30_000/);
  assert.match(route, /within\(hostedEvidence\.score\(resource, observations\), 15_000/);
  assert.match(route, /leaseToken: claim\.leaseToken/);
  assert.match(repository, /active_checkpoint/);
  assert.match(repository, /checkpoint\.lease_token = \$8::uuid/);
  assert.match(repository, /state\.status = 'running'/);
});
