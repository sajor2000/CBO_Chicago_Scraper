import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Clerk middleware runs globally while review pages require authentication", () => {
  const proxy = readFileSync(new URL("../src/proxy.ts", import.meta.url), "utf8");
  const reviewPage = readFileSync(new URL("../src/app/review/page.tsx", import.meta.url), "utf8");
  assert.match(proxy, /@clerk\/nextjs\/server/);
  assert.match(proxy, /clerkMiddleware/);
  assert.match(reviewPage, /Sign in required/);
  assert.match(reviewPage, /RunControls/);
  assert.match(reviewPage, /hasWorkspaceRole\(userId, "operator"\)/);
});
