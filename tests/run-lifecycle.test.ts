import assert from "node:assert/strict";
import test from "node:test";
import { authorizeCron } from "../src/lib/runs/cron.ts";
import { InMemoryRunRegistry, RunLockError, scheduledCohortKey } from "../src/lib/runs/index.ts";

test("idempotent launches dedupe and only one run can claim a checkpoint", () => {
  const runs = new InMemoryRunRegistry();
  const first = runs.launch({ idempotencyKey: "august", selection: ["r1", "r2"], budget: 2 });
  const duplicate = runs.launch({ idempotencyKey: "august", selection: ["r1", "r2"], budget: 2 });
  assert.equal(first.id, duplicate.id);
  assert.equal(runs.claimNext(first.id)?.resourceId, "r1");
  assert.throws(() => runs.claimNext(first.id), RunLockError);
  runs.completeCheckpoint(first.id, { candidatesStaged: 1 });
  assert.equal(runs.claimNext(first.id)?.resourceId, "r2");
});

test("different runs can claim separate checkpoints and selections are bounded", () => {
  const runs = new InMemoryRunRegistry();
  const first = runs.launch({ idempotencyKey: "one", selection: ["r1"], budget: 1 });
  const second = runs.launch({ idempotencyKey: "two", selection: ["r2"], budget: 1 });
  assert.equal(runs.claimNext(first.id)?.resourceId, "r1");
  assert.equal(runs.claimNext(second.id)?.resourceId, "r2");
  assert.throws(() => runs.launch({ idempotencyKey: "large", selection: Array.from({ length: 101 }, (_, index) => `r${index}`), budget: 1 }));
});

test("bad cron secrets are rejected", () => {
  assert.throws(() => authorizeCron("wrong", "expected"));
});

test("cancelled runs stop work and resume from the next checkpoint", () => {
  const runs = new InMemoryRunRegistry();
  const run = runs.launch({ idempotencyKey: "resume", selection: ["r1", "r2"], budget: 2 });
  assert.equal(runs.claimNext(run.id)?.resourceId, "r1");
  runs.completeCheckpoint(run.id, { unableToVerify: 1 });
  runs.cancel(run.id);
  assert.equal(runs.claimNext(run.id), undefined);
  runs.resume(run.id);
  assert.equal(runs.claimNext(run.id)?.resourceId, "r2");
});

test("releasing a lease lets the same checkpoint be claimed again", () => {
  const runs = new InMemoryRunRegistry();
  const run = runs.launch({ idempotencyKey: "release", selection: ["r1", "r2"], budget: 2 });
  assert.equal(runs.claimNext(run.id)?.resourceId, "r1");
  assert.throws(() => runs.claimNext(run.id), RunLockError);
  runs.releaseLease(run.id);
  assert.equal(runs.claimNext(run.id)?.resourceId, "r1");
});

test("scheduled cohorts are idempotent within one UTC month", () => {
  assert.equal(scheduledCohortKey(new Date("2026-08-13T00:00:00Z")), "scheduled:2026-08");
  assert.notEqual(scheduledCohortKey(new Date("2026-09-01T00:00:00Z")), "scheduled:2026-08");
});
