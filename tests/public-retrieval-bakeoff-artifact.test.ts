import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("public retrieval bake-off artifact retains the aggregate decision evidence", () => {
  const artifact = readFileSync(new URL("../docs/ops/public-retrieval-bakeoff-2026-08-31.html", import.meta.url), "utf8");
  for (const expected of ["97/100", "42", "20", "190 ms", "Required before adoption"]) assert.match(artifact, new RegExp(expected.replace(/[/$]/g, "\\$&")));
});
