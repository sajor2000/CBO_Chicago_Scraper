import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("benchmark container is non-root and cannot become the Railway cron dispatcher", () => {
  const dockerfile = readFileSync(new URL("../Dockerfile.retrieval-benchmark", import.meta.url), "utf8");
  const guide = readFileSync(new URL("../docs/ops/retrieval-benchmark.md", import.meta.url), "utf8");
  assert.match(dockerfile, /USER pwuser/);
  assert.doesNotMatch(dockerfile, /railway-dispatch|CBO_CRON_URL|CRON_SECRET|REVIEW_DATABASE_URL/);
  assert.match(guide, /must not call the application cron route/);
});
