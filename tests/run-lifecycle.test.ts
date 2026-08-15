import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { authorizeCron } from "../src/lib/runs/cron.ts";
import { InMemoryRunRegistry, RunLockError, scheduledRunKey } from "../src/lib/runs/index.ts";

test("idempotent launches dedupe and only one run can claim a checkpoint", () => {
  const runs = new InMemoryRunRegistry();
  const first = runs.launch({ idempotencyKey: "august", selection: ["r1", "r2"], budget: 2 });
  const duplicate = runs.launch({ idempotencyKey: "august", selection: ["r1", "r2"], budget: 2 });
  assert.equal(first.id, duplicate.id);
  const firstClaim = runs.claimNext(first.id)!;
  assert.equal(firstClaim.resourceId, "r1");
  assert.throws(() => runs.claimNext(first.id), RunLockError);
  runs.completeCheckpoint(first.id, firstClaim.leaseToken, { candidatesStaged: 1 }, "candidate_staged");
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

test("paused runs resume but cancelled runs are terminal", () => {
  const runs = new InMemoryRunRegistry();
  const run = runs.launch({ idempotencyKey: "resume", selection: ["r1", "r2"], budget: 2 });
  const first = runs.claimNext(run.id)!;
  assert.equal(first.resourceId, "r1");
  runs.completeCheckpoint(run.id, first.leaseToken, { unableToVerify: 1 }, "unable_to_verify");
  runs.pause(run.id);
  assert.equal(runs.claimNext(run.id), undefined);
  runs.resume(run.id);
  assert.equal(runs.claimNext(run.id)?.resourceId, "r2");
  runs.cancel(run.id);
  assert.equal(runs.claimNext(run.id), undefined);
  assert.throws(() => runs.resume(run.id), /cancelled/i);
});

test("budget-paused runs require a bounded continuation budget", () => {
  const runs = new InMemoryRunRegistry();
  const run = runs.launch({ idempotencyKey: "budget-resume", selection: ["r1", "r2"], budget: 1 });
  const first = runs.claimNext(run.id)!;
  runs.completeCheckpoint(run.id, first.leaseToken, {}, "verified_no_change");
  assert.equal(runs.get(run.id)?.status, "paused");
  assert.throws(() => runs.resume(run.id), /additional budget/i);
  assert.throws(() => runs.resume(run.id, 2), /remaining frozen scope/i);
  runs.resume(run.id, 1);
  assert.equal(runs.claimNext(run.id)?.resourceId, "r2");
});

test("releasing a lease lets the same checkpoint be claimed again", () => {
  const runs = new InMemoryRunRegistry();
  const run = runs.launch({ idempotencyKey: "release", selection: ["r1", "r2"], budget: 2 });
  assert.equal(runs.claimNext(run.id)?.attempt, 1);
  assert.throws(() => runs.claimNext(run.id), RunLockError);
  runs.releaseLease(run.id);
  assert.equal(runs.claimNext(run.id)?.attempt, 2);
});

test("full cycles reuse the one active cycle and keep frozen snapshot membership", () => {
  const runs = new InMemoryRunRegistry();
  const input = {
    idempotencyKey: "cycle-1",
    mode: "manual_full_cycle" as const,
    manifestId: "manifest-1",
    memberships: [
      { resourceId: "r1", snapshotId: "snapshot-old" },
      { resourceId: "r2", snapshotId: "snapshot-2" }
    ],
    budget: 2
  };
  const first = runs.launch(input);
  const overlapping = runs.launch({ ...input, idempotencyKey: "cycle-2", manifestId: "manifest-2", memberships: [{ resourceId: "r1", snapshotId: "snapshot-new" }] });
  assert.equal(overlapping.id, first.id);
  assert.equal(runs.claimNext(first.id)?.snapshotId, "snapshot-old");
});

test("only fenced full-cycle terminal outcomes advance the 60-day due date", () => {
  const advancing = ["verified_no_change", "candidate_staged", "conflict"] as const;
  const notAdvancing = ["unable_to_verify", "provider_failure", "cancelled", "budget_exhausted"] as const;

  for (const outcome of [...advancing, ...notAdvancing]) {
    const runs = new InMemoryRunRegistry();
    const run = runs.launch({
      idempotencyKey: outcome,
      mode: "manual_full_cycle",
      manifestId: "manifest-1",
      memberships: [{ resourceId: "r1", snapshotId: "snapshot-1" }],
      budget: 1
    });
    const claim = runs.claimNext(run.id)!;
    assert.throws(() => runs.completeCheckpoint(run.id, "stale-token", {}, outcome), RunLockError);
    runs.completeCheckpoint(run.id, claim.leaseToken, {}, outcome, new Date("2026-08-14T00:00:00Z"));
    assert.equal(runs.nextDueAt("r1"), advancing.includes(outcome as never) ? "2026-10-13T00:00:00.000Z" : undefined);
  }

  const spot = new InMemoryRunRegistry();
  const run = spot.launch({ idempotencyKey: "spot", selection: ["r1"], budget: 1 });
  const claim = spot.claimNext(run.id)!;
  spot.completeCheckpoint(run.id, claim.leaseToken, {}, "verified_no_change", new Date("2026-08-14T00:00:00Z"));
  assert.equal(spot.nextDueAt("r1"), undefined);
});

test("each completed scheduled cycle can receive a new durable run key", () => {
  assert.notEqual(scheduledRunKey(), scheduledRunKey());
});

test("run history is bounded and ordered by most recent start", () => {
  const registry = readFileSync(new URL("../src/lib/runs/index.ts", import.meta.url), "utf8");
  assert.match(registry, /async listRecent\(limit = 10\)/);
  assert.match(registry, /order by run\.started_at desc limit \$1/);
  assert.match(registry, /Math\.min\(limit, 25\)/);
});
