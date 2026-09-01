import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the run gateway derives a full due cycle on the server", () => {
  const route = readFileSync(new URL("../src/app/api/runs/route.ts", import.meta.url), "utf8");
  assert.match(route, /mode === "manual_full_cycle"/);
  assert.match(route, /launchCurrentFullCycle/);
  assert.match(route, /mode === "discovery_only"/);
  assert.match(route, /launchDiscovery/);
  assert.match(route, /assertDiscoveryConfigured/);
  assert.match(route, /if \(!\("selection" in body\)\)/);
});

test("the durable worker can continue selected spot checks without a browser loop", () => {
  const registry = readFileSync(new URL("../src/lib/runs/index.ts", import.meta.url), "utf8");
  const scheduled = registry.slice(registry.indexOf("async launchScheduled"), registry.indexOf("async #launch"));
  assert.match(scheduled, /run\.run_mode = 'manual_selected' and state\.status in \('queued', 'running'\)/);
  assert.doesNotMatch(scheduled, /run\.run_mode = 'manual_selected' and state\.status in \('queued', 'running', 'paused'\)/);
  assert.match(scheduled, /run\.run_mode = 'discovery_only' and state\.status in \('queued', 'running'\)/);
});

test("the operator can inspect a durable run dashboard", () => {
  const page = readFileSync(new URL("../src/app/review/runs/[runId]/page.tsx", import.meta.url), "utf8");
  const actions = readFileSync(new URL("../src/app/review/run-actions.tsx", import.meta.url), "utf8");
  assert.match(page, /Audit run/);
  assert.match(page, /Remaining/);
  assert.match(page, /SiteReports/);
  assert.match(page, /RunActions/);
  assert.match(actions, /mutate\("pause"\)/);
  assert.match(actions, /mutate\("resume"\)/);
  assert.match(actions, /mutate\("cancel"\)/);
  assert.match(actions, /resumeHeadroom/);
  assert.match(page, /Math\.trunc/);
  const registry = readFileSync(new URL("../src/lib/runs/index.ts", import.meta.url), "utf8");
  assert.match(registry, /async get\(runId: string\).*if \(!isUuid\(runId\)\) return undefined/s);
});
