import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { executeScheduledCron } from "../src/app/api/cron/route.ts";
import { CronAuthorizationError } from "../src/lib/runs/cron.ts";

test("execute route processes one checkpoint, sets maxDuration, and releases leases on failure", () => {
  const route = readFileSync(new URL("../src/app/api/runs/[runId]/execute/route.ts", import.meta.url), "utf8");
  const worker = readFileSync(new URL("../src/lib/runs/execute-checkpoint.ts", import.meta.url), "utf8");
  assert.match(route, /export const maxDuration = 60/);
  assert.match(route, /executeCheckpoint\(runId\)/);
  assert.match(worker, /claimNext\(runId\)/);
  assert.match(worker, /completeCheckpoint\(runId, claim\.leaseToken, output\.report, output\.outcome\)/);
  assert.match(worker, /runRegistry\.status\(runId\)/);
  assert.match(worker, /releaseLease\(runId, leaseToken\)/);
  assert.doesNotMatch(route, /for \(let index = 0; index < limit/);
});

test("execution bounds provider work and passes its lease to candidate staging", () => {
  const route = readFileSync(new URL("../src/app/api/runs/[runId]/execute/route.ts", import.meta.url), "utf8");
  const worker = readFileSync(new URL("../src/lib/runs/execute-checkpoint.ts", import.meta.url), "utf8");
  const repository = readFileSync(new URL("../src/lib/repositories/review.ts", import.meta.url), "utf8");
  assert.match(worker, /within\(hostedEvidence\.collect\(resource\), 30_000/);
  assert.match(worker, /within\(hostedEvidence\.score\(resource, observations\), 25_000/);
  assert.match(worker, /leaseToken: claim\.leaseToken/);
  assert.match(worker, /seededResource\(claim\.resourceId, claim\.snapshotId\)/);
  assert.match(repository, /active_checkpoint/);
  assert.match(repository, /checkpoint\.lease_token = \$8::uuid/);
  assert.match(repository, /state\.status = 'running'/);
});

test("cron shares the checkpoint worker, requires a baseline, and processes one checkpoint", async () => {
  const cron = readFileSync(new URL("../src/app/api/cron/route.ts", import.meta.url), "utf8");
  const calls: string[] = [];
  const response = await executeScheduledCron(new Request("https://example.test/api/cron", { headers: { authorization: "Bearer cron-secret" } }), {
    authorize: (token) => { assert.equal(token, "cron-secret"); calls.push("authorize"); },
    assertBaselineReady: async () => { calls.push("baseline"); },
    launchScheduled: async () => { calls.push("launch"); return { id: "run-1" }; },
    executeCheckpoint: async (runId) => ({ recordsChecked: runId === "run-1" ? 1 : 0, budgetUsed: 1, candidatesStaged: 0, conflicts: 0, unableToVerify: 0, providerFailures: 0, done: false })
  });
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["authorize", "baseline", "launch"]);
  assert.equal((await response.json()).recordsChecked, 1);
  assert.match(cron, /export const maxDuration = 60/);
});

test("cron rejects bad authorization before baseline or provider work", async () => {
  const response = await executeScheduledCron(new Request("https://example.test/api/cron"), {
    authorize: () => { throw new CronAuthorizationError(); },
    assertBaselineReady: async () => assert.fail("baseline must not run"),
    launchScheduled: async () => assert.fail("launch must not run"),
    executeCheckpoint: async () => assert.fail("checkpoint must not run")
  });
  assert.equal(response.status, 401);
});

test("production schedule remains one secured checkpoint per cron invocation", () => {
  const config = readFileSync(new URL("../vercel.json", import.meta.url), "utf8");
  const runbook = readFileSync(new URL("../docs/ops/operator-runbook.md", import.meta.url), "utf8");
  assert.match(config, /"path": "\/api\/cron"/);
  assert.match(config, /"schedule": "\*\/5 \* \* \* \*"/);
  assert.match(runbook, /one-resource manual canary/);
  assert.match(runbook, /20%/);
});
