import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("discovery activation is server-authorized and derives the service owner", () => {
  const route = readFileSync(new URL("../src/app/api/discovery/activation/route.ts", import.meta.url), "utf8");
  assert.match(route, /requireWorkspaceRole\(userId, "operator"\)/);
  assert.match(route, /acceptedCycleId/);
  assert.match(route, /DISCOVERY_SERVICE_OWNER_SUBJECT/);
  assert.match(route, /serviceOwnerSubject !== userId/);
  assert.doesNotMatch(route, /serviceOwnerSubject\?:/);
  assert.match(route, /dailyProviderCallCeiling/);
  assert.match(route, /DISCOVERY_POLICY_VERSION/);
});
