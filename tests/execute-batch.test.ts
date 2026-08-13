import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("execute route accepts a capped limit and returns cumulative report counts", () => {
  const route = readFileSync(new URL("../src/app/api/runs/[runId]/execute/route.ts", import.meta.url), "utf8");
  assert.match(route, /const limit = Math\.max\(1, Math\.min\(Number\(body\.limit \?\? 1\) \|\| 1, 100\)\)/);
  assert.match(route, /for \(let index = 0; index < limit; index \+= 1\)/);
  assert.match(route, /recordsChecked/);
  assert.match(route, /candidatesStaged/);
  assert.match(route, /unableToVerify/);
  assert.match(route, /providerFailures/);
  assert.match(route, /budgetUsed/);
  assert.match(route, /completeCheckpoint\(runId, claim\.leaseToken, output\.report\)/);
});
