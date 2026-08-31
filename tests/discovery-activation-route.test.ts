import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("activation is operator-authorized, cycle-gated, versioned, and auditable",()=>{
  const route=readFileSync(new URL("../src/app/api/discovery/activation/route.ts",import.meta.url),"utf8");
  const migration=readFileSync(new URL("../migrations/015_discovery_lane.sql",import.meta.url),"utf8");
  assert.match(route,/requireWorkspaceRole\(userId, "operator"\)/);
  assert.match(route,/DISCOVERY_QUERY_POLICY_VERSION/);
  assert.match(route,/actorSubject: userId/);
  assert.match(migration,/status = 'completed'/);
  assert.match(migration,/service_owner_approval text not null/);
  assert.match(migration,/action in \('activated', 'deactivated'\)/);
});
