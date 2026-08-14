import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { InMemoryRunRegistry } from "../src/lib/runs/index.ts";

test("fixture dry run yields a report without a publisher or production receipt", () => {
  const runs = new InMemoryRunRegistry();
  const run = runs.launch({ idempotencyKey: "fixture-smoke", selection: ["fixture-resource"], budget: 1 });

  assert.deepEqual(run.report, { recordsChecked: 0, candidatesStaged: 0, conflicts: 0, unableToVerify: 0, providerFailures: 0, budgetUsed: 0 });
  assert.equal("publicationReceipt" in run, false);
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  assert.equal(existsSync(resolve(root, "src/lib/publisher")), false);
});

test("the deployment root directs operators to the review workspace", () => {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const page = readFileSync(resolve(root, "src/app/page.tsx"), "utf8");
  assert.match(page, /redirect\("\/review"\)/);
});
