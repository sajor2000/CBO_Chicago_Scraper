import assert from "node:assert/strict";
import test from "node:test";
import { authorizeReviewer, fixtureUserFromHeader, FixtureModeError, ReviewerAuthorizationError } from "../src/lib/auth.ts";

test("only allowlisted reviewers are authorized", () => {
  assert.equal(authorizeReviewer({ email: "reviewer@rush.edu" }, "reviewer@rush.edu").email, "reviewer@rush.edu");
  assert.throws(() => authorizeReviewer({ email: "visitor@example.org" }, "reviewer@rush.edu"), ReviewerAuthorizationError);
});

test("header identity is disabled outside local fixture mode", () => {
  const original = process.env.FIXTURE_MODE;
  delete process.env.FIXTURE_MODE;
  assert.throws(() => fixtureUserFromHeader(new Request("https://example.test", { headers: { "x-reviewer-email": "reviewer@rush.edu" } })), FixtureModeError);
  if (original === undefined) delete process.env.FIXTURE_MODE;
  else process.env.FIXTURE_MODE = original;
});
