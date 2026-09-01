import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("discovery checkpoints are query cells followed by capped, durable leads", () => {
  const registry = readFileSync(new URL("../src/lib/runs/index.ts", import.meta.url), "utf8");
  assert.match(registry, /discovery_query_cell_id/);
  assert.match(registry, /discovery_lead_id/);
  assert.match(registry, /ranked_leads/);
  assert.match(registry, /not_processed_budget/);
  assert.match(registry, /async completeDiscoveryQueryCell/);
  assert.match(registry, /async completeDiscoveryLead/);
});

test("transient discovery failures wait before retrying and consume bounded calls", () => {
  const registry = readFileSync(new URL("../src/lib/runs/index.ts", import.meta.url), "utf8");
  const worker = readFileSync(new URL("../src/lib/runs/execute-checkpoint.ts", import.meta.url), "utf8");
  assert.match(registry, /state = 'retry_wait'/);
  assert.match(registry, /interval '1 minute'/);
  assert.match(registry, /interval '5 minutes'/);
  assert.match(registry, /async consumeDiscoveryProviderCall/);
  assert.match(worker, /retryDiscoveryCheckpoint/);
  assert.match(worker, /consumeDiscoveryProviderCall/);
});

test("deactivation pauses queued discovery work before a further claim", () => {
  const registry = readFileSync(new URL("../src/lib/runs/index.ts", import.meta.url), "utf8");
  assert.match(registry, /deactivated_discovery/);
  assert.match(registry, /run\.run_mode = 'discovery_only'/);
  assert.match(registry, /state\.status in \('queued', 'running'\)/);
  assert.match(registry, /where activation\.singleton and activation\.active/);
  assert.match(registry, /not exists \(select 1 from deactivated_discovery\)/);
});

test("discovery UI remains manually activated and new resources await handoff", () => {
  const controls = readFileSync(new URL("../src/app/review/discovery-controls.tsx", import.meta.url), "utf8");
  const detail = readFileSync(new URL("../src/app/review/[candidateId]/page.tsx", import.meta.url), "utf8");
  assert.match(controls, /Activate manual discovery/);
  assert.match(controls, /Start capped discovery/);
  assert.match(controls, /DISCOVERY_MAX_QUERY_CELLS/);
  assert.match(detail, /Awaiting map handoff/);
});
