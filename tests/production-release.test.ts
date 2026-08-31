import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { REQUIRED_REVIEW_SCHEMA_VERSION } from "../src/lib/review-schema.ts";

test("required review schema version tracks the latest migration", () => {
  const latest = Math.max(...readdirSync(new URL("../migrations/", import.meta.url)).flatMap((file) => {
    const version = file.match(/^(\d{3})_/)?.[1];
    return version ? [Number(version)] : [];
  }));
  assert.equal(REQUIRED_REVIEW_SCHEMA_VERSION, latest);
});

test("production release stages Vercel before migrating and promoting", () => {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/release-production.ts", "--dry-run"], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const pulled = result.stdout.indexOf("vercel pull --yes --environment production");
  const built = result.stdout.indexOf("vercel build --prod");
  const staged = result.stdout.indexOf("vercel deploy --prebuilt --prod --skip-domain --yes");
  const migrated = result.stdout.indexOf("scripts/apply-review-migrations.ts");
  const verified = result.stdout.indexOf("scripts/verify-review-schema.ts");
  const promoted = result.stdout.indexOf("vercel promote <staged-production-url> --yes");
  assert.ok(pulled >= 0 && pulled < built && built < staged && staged < migrated && migrated < verified && verified < promoted);
});

test("the main-branch workflow cannot promote before Neon verification", () => {
  const workflow = readFileSync(new URL("../.github/workflows/production.yml", import.meta.url), "utf8");
  const staged = workflow.indexOf("name: Stage production artifact");
  const migrated = workflow.indexOf("name: Migrate and verify production Neon");
  const promoted = workflow.indexOf("name: Promote the verified artifact");
  assert.ok(staged >= 0 && staged < migrated && migrated < promoted);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /REVIEW_DATABASE_URL: \$\{\{ secrets\.REVIEW_DATABASE_URL \}\}/);
  assert.match(workflow, /workflow_run\.event == 'push'/);
  assert.match(workflow, /workflow_run\.head_repository\.full_name == github\.repository/);
  assert.doesNotMatch(workflow, /uses: actions\/(checkout|setup-node)@v\d/);
});

test("Vercel invokes one guarded checkpoint weekly", () => {
  const vercel = readFileSync(new URL("../vercel.json", import.meta.url), "utf8");
  assert.match(vercel, /"schedule": "0 0 \* \* 0"/);
});
