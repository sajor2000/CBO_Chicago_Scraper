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
  assert.match(reviewPage, /hasWorkspaceRole\(userId, "reviewer"\)/);
  assert.match(reviewPage, /!isReviewer && !isOperator/);
});

test("only an operator can download the manual data-team CSV handoff", () => {
  const route = readFileSync(new URL("../src/app/api/exports/data-team/route.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("../src/app/review/exports/page.tsx", import.meta.url), "utf8");
  assert.match(route, /requireWorkspaceRole\(userId, "operator"\)/);
  assert.match(route, /Content-Disposition/);
  assert.match(route, /Cache-Control.*no-store/);
  assert.match(route, /isDataTeamRelation/);
  assert.doesNotMatch(route, /AZURE_EXPORT_MAPPING_JSON/);
  assert.match(page, /requireWorkspaceRole\(userId, "operator"\)/);
  assert.match(page, /new-resource proposals remain out of the files/);
});
