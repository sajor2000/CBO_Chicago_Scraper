import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("execute route processes one checkpoint, sets maxDuration, and releases leases on failure", () => {
  const route = readFileSync(new URL("../src/app/api/runs/[runId]/execute/route.ts", import.meta.url), "utf8");
  const worker = readFileSync(new URL("../src/lib/runs/execute-checkpoint.ts", import.meta.url), "utf8");
  assert.match(route, /export const maxDuration = 60/);
  assert.match(route, /executeCheckpoint\(runId\)/);
  assert.match(worker, /claimNext\(runId\)/);
  assert.match(worker, /completeCheckpoint\(runId, claim\.leaseToken, output\.report\)/);
  assert.match(worker, /releaseLease\(runId, leaseToken\)/);
  assert.doesNotMatch(route, /for \(let index = 0; index < limit/);
});

test("execution bounds provider work and passes its lease to candidate staging", () => {
  const route = readFileSync(new URL("../src/app/api/runs/[runId]/execute/route.ts", import.meta.url), "utf8");
  const worker = readFileSync(new URL("../src/lib/runs/execute-checkpoint.ts", import.meta.url), "utf8");
  const repository = readFileSync(new URL("../src/lib/repositories/review.ts", import.meta.url), "utf8");
  assert.match(worker, /within\(hostedEvidence\.collect\(resource\), 30_000/);
  assert.match(worker, /within\(hostedEvidence\.score\(resource, observations\), 15_000/);
  assert.match(worker, /leaseToken: claim\.leaseToken/);
  assert.match(repository, /active_checkpoint/);
  assert.match(repository, /checkpoint\.lease_token = \$8::uuid/);
  assert.match(repository, /state\.status = 'running'/);
});

test("cron shares the checkpoint worker and starts the scheduled cohort", () => {
  const cron = readFileSync(new URL("../src/app/api/cron/route.ts", import.meta.url), "utf8");
  assert.match(cron, /authorizeCron/);
  assert.match(cron, /launchScheduled\(\)/);
  assert.match(cron, /executeCheckpoint\(run\.id\)/);
});
