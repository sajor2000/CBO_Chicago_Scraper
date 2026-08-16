import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { executeScheduledCron } from "../src/app/api/cron/route.ts";
import { providerIssuesFor, recoverCheckpointFailure } from "../src/lib/runs/execute-checkpoint.ts";
import { CronAuthorizationError } from "../src/lib/runs/cron.ts";

test("execute route processes one checkpoint, sets maxDuration, and records failures", () => {
  const route = readFileSync(new URL("../src/app/api/runs/[runId]/execute/route.ts", import.meta.url), "utf8");
  const worker = readFileSync(new URL("../src/lib/runs/execute-checkpoint.ts", import.meta.url), "utf8");
  assert.match(route, /export const maxDuration = 60/);
  assert.match(route, /executeCheckpoint\(runId\)/);
  assert.match(worker, /claimNext\(runId\)/);
  assert.match(worker, /completeCheckpoint\(runId, claim\.leaseToken, output\.report, output\.outcome, \{/);
  assert.match(worker, /resourceName: resource\.name/);
  assert.match(worker, /evidence: reviewProvenance/);
  assert.match(worker, /runRegistry\.status\(runId\)/);
  assert.match(worker, /recoverCheckpointFailure\(runRegistry, runId, leaseToken, attempt\)/);
  assert.doesNotMatch(route, /for \(let index = 0; index < limit/);
});

test("checkpoint failures release twice before failing the run", async () => {
  const calls: string[] = [];
  const registry = {
    releaseLease: async (_runId: string, leaseToken: string) => { calls.push(`release:${leaseToken}`); },
    failCheckpoint: async (_runId: string, leaseToken: string) => { calls.push(`fail:${leaseToken}`); }
  };
  await recoverCheckpointFailure(registry, "run-1", "lease-1", 1);
  await recoverCheckpointFailure(registry, "run-1", "lease-2", 2);
  await recoverCheckpointFailure(registry, "run-1", "lease-3", 3);
  assert.deepEqual(calls, ["release:lease-1", "release:lease-2", "fail:lease-3"]);
});

test("execution bounds provider work and passes its lease to candidate staging", () => {
  const route = readFileSync(new URL("../src/app/api/runs/[runId]/execute/route.ts", import.meta.url), "utf8");
  const worker = readFileSync(new URL("../src/lib/runs/execute-checkpoint.ts", import.meta.url), "utf8");
  const runs = readFileSync(new URL("../src/lib/runs/index.ts", import.meta.url), "utf8");
  const repository = readFileSync(new URL("../src/lib/repositories/review.ts", import.meta.url), "utf8");
  assert.match(worker, /within\(hostedEvidence\.collect\(resource\), 30_000/);
  assert.match(worker, /within\(hostedEvidence\.score\(resource, observations\), 25_000/);
  assert.match(worker, /if \(!advisory\)/);
  assert.match(worker, /verificationState: "provider_failure"/);
  assert.match(worker, /AI advisory output was unavailable or invalid/);
  assert.match(worker, /leaseToken: claim\.leaseToken/);
  assert.match(worker, /seededResource\(claim\.resourceId, claim\.snapshotId\)/);
  assert.match(runs, /select claimed\.resource_id, membership\.resource_snapshot_id, claimed\.ordinal, claimed\.lease_token, claimed\.attempt/);
  assert.match(repository, /active_checkpoint/);
  assert.match(repository, /checkpoint\.lease_token = \$8::uuid/);
  assert.match(repository, /state\.status in \('queued', 'running', 'paused'\)/);
});

test("provider diagnostics preserve retrieval and Azure failure states", () => {
  const observations = [
    { provider: "firecrawl" as const, state: "blocked" as const, observedAt: "2026-08-14T00:00:00Z" },
    { provider: "google_places" as const, state: "success" as const, observedAt: "2026-08-14T00:00:00Z" }
  ];
  assert.deepEqual(providerIssuesFor(observations, new Error("Evidence scoring timed out.")), ["firecrawl:blocked", "azure_openai:timeout"]);
  assert.deepEqual(providerIssuesFor(observations, new Error("Azure OpenAI response contains an invalid score.")), ["firecrawl:blocked", "azure_openai:malformed"]);
  assert.deepEqual(providerIssuesFor([], new Error("Azure OpenAI request failed (429).")), ["azure_openai:http_429"]);
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
  assert.match(runbook, /ten-resource manual canary/);
  assert.match(runbook, /budget one/);
  assert.match(runbook, /20%/);
});
