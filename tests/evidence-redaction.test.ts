import assert from "node:assert/strict";
import test from "node:test";
import { redactEvidence } from "../src/lib/evidence/redaction.ts";

test("evidence redaction removes common secrets before persistence", () => {
  assert.equal(redactEvidence("cookie=abc authorization: Bearer-token api key=xyz"), "cookie=[redacted] authorization=[redacted] api key=[redacted]");
});
