import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveDiscoveryQueryCells } from "../src/lib/discovery/query-matrix.ts";

test("launch snapshots reviewed cells and rejects broad discovery", () => {
  const cells=resolveDiscoveryQueryCells({categories:["wic"],counties:["Cook"],maxCells:2});
  assert.equal(cells.length,2);
  assert.ok(cells.every((cell)=>cell.policyVersion==="chicago-seven-county-v1"&&cell.resultCap===5));
  assert.throws(()=>resolveDiscoveryQueryCells({categories:["wic","food_access"],counties:["Cook"],maxCells:2}),/exceed/);
  assert.throws(()=>resolveDiscoveryQueryCells({categories:["wic"],counties:["Indiana"],maxCells:2}),/approved/);
});

test("discovery execution reuses fenced checkpoints, atomic budgets, retries, and known-work priority",()=>{
  const repository=readFileSync(new URL("../src/lib/discovery/repository.ts",import.meta.url),"utf8");
  const worker=readFileSync(new URL("../src/lib/discovery/execute-checkpoint.ts",import.meta.url),"utf8");
  const cron=readFileSync(new URL("../src/app/api/cron/route.ts",import.meta.url),"utf8");
  assert.match(repository,/discovery_daily_budgets/);
  assert.match(repository,/used_calls < reserved_calls/);
  assert.match(repository,/state = 'leased'.*lease_expires_at/s);
  assert.match(repository,/state='retry_wait'/);
  assert.match(repository,/pauseForBudget/);
  assert.match(repository,/provider_call_budget_exhausted/);
  assert.match(repository,/recordQueryAttempt/);
  assert.match(repository,/recordLeadObservations/);
  assert.match(repository,/1 minute/); assert.match(repository,/5 minutes/);
  assert.match(repository,/not exists \(select 1 from review_workspace\.discovery_campaigns where status in \('queued', 'running', 'paused'\)\)/);
  assert.match(repository,/activation\.active/);
  assert.match(repository,/activation_event\.query_policy_version=run\.run_parameters->>'queryPolicyVersion'/);
  assert.match(repository,/not exists\(select 1 from prior where run_id=\$1::uuid\)/);
  assert.match(worker,/matchedLocationIds/);
  assert.match(worker,/approved trusted-directory endpoint/);
  assert.match(worker,/stageDiscoveryCandidate/);
  assert.match(worker,/advisoryUnavailable/);
  assert.ok(cron.indexOf("runRegistry.launchScheduled") < cron.indexOf("oldestClaimableRun"));
});

test("discovery has no Azure insertion, export, schedule, or source-table write path",()=>{
  const files=["../src/lib/discovery/repository.ts","../src/lib/discovery/execute-checkpoint.ts","../src/app/api/discovery/activation/route.ts","../src/app/review/discovery-controls.tsx"].map((file)=>readFileSync(new URL(file,import.meta.url),"utf8")).join("\n");
  assert.doesNotMatch(files,/community_resource_locations|wic_locations|azure_export_artifacts|publish_intents|scheduled discovery/i);
});
