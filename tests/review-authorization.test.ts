import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Clerk protects review and API routes before handlers run", () => {
  const proxy = readFileSync(new URL("../src/proxy.ts", import.meta.url), "utf8");
  assert.match(proxy, /@clerk\/nextjs\/server/);
  assert.match(proxy, /pathname === "\/review"/);
  assert.match(proxy, /pathname === "\/api"/);
});
