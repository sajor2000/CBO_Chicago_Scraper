import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = (name: string) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");

test("review workspace persists immutable, traceable review records", () => {
  const schema = migration("001_review_workspace.sql");

  for (const table of [
    "resources",
    "resource_snapshots",
    "verification_runs",
    "source_observations",
    "candidate_revisions",
    "review_decisions",
    "publish_intents",
    "publication_receipts",
    "reviewer_access"
  ]) {
    assert.match(schema, new RegExp(`create table review_workspace\\.${table}`, "i"));
  }

  assert.match(schema, /unique \(resource_id, source_version\)/i);
  assert.match(schema, /unique \(provider, observation_key, observed_at\)/i);
  assert.match(schema, /decision text not null check \(decision in \('approved', 'rejected', 'deferred'\)\)/i);
  assert.match(schema, /before_values jsonb not null/i);
  assert.match(schema, /proposed_values jsonb not null/i);
  assert.match(schema, /provenance jsonb not null/i);

  for (const table of [
    "source_observations",
    "candidate_revisions",
    "review_decisions",
    "publish_intents",
    "publication_receipts"
  ]) {
    assert.match(schema, new RegExp(`before update or delete on review_workspace\\.${table}`, "i"));
  }
  assert.match(schema, /supersedes_observation_id uuid references review_workspace\.source_observations/i);
});

test("category taxonomy supports governed approved and proposed assignments", () => {
  const schema = migration("002_categories.sql");

  for (const table of ["categories", "resource_category_assignments", "candidate_category_proposals"]) {
    assert.match(schema, new RegExp(`create table review_workspace\\.${table}`, "i"));
  }
  assert.match(schema, /synonyms text\[\] not null default '\{\}'/i);
  assert.match(schema, /effective_from date not null/i);
  assert.match(schema, /deprecated_at timestamptz/i);
  assert.match(schema, /approved_by_decision_id uuid references review_workspace\.review_decisions/i);
});

test("Neon persistence keeps immutable records separate from mutable review projections", () => {
  const schema = migration("003_neon_review_persistence.sql");

  for (const table of [
    "workspace_sentinel",
    "schema_migrations",
    "resource_snapshot_receipts",
    "candidate_revision_snapshot_links",
    "candidate_current_state",
    "run_current_state",
    "run_checkpoints",
    "run_reports"
  ]) {
    assert.match(schema, new RegExp(`create table review_workspace\\.${table}`, "i"));
  }

  assert.match(schema, /workspace_kind text not null check \(workspace_kind = 'dedicated_review_workspace'\)/i);
  assert.match(schema, /checksum text not null check \(checksum ~ '\^\[a-f0-9\]\{64\}\$'\)/i);
  assert.match(schema, /candidate_revision_id uuid primary key references review_workspace\.candidate_revisions/i);
  assert.match(schema, /resource_snapshot_id uuid not null references review_workspace\.resource_snapshots/i);
  assert.match(schema, /content_sha256 text not null check \(content_sha256 ~ '\^\[a-f0-9\]\{64\}\$'\)/i);
  assert.match(schema, /add primary key \(subject, role\)/i);
  assert.match(schema, /role in \('reviewer', 'operator'\)/i);
  assert.match(schema, /approved_for_future_export/i);
  assert.match(schema, /lease_token uuid/i);
  assert.match(schema, /lease_expires_at timestamptz/i);
  assert.match(schema, /check \(\(lease_token is null\) = \(lease_expires_at is null\)\)/i);
  assert.match(schema, /candidate_current_state_updated_at_idx/i);
  assert.match(schema, /review_decisions_candidate_revision_id_idx/i);

  for (const table of ["resource_snapshot_receipts", "candidate_revision_snapshot_links"]) {
    assert.match(schema, new RegExp(`before update or delete on review_workspace\\.${table}`, "i"));
  }

  assert.match(schema, /create role review_workspace_app nologin/i);
  assert.match(schema, /grant usage on schema review_workspace to review_workspace_app/i);
});

test("baseline import receipts contain aggregate-only append-only outcomes", () => {
  const schema = migration("004_baseline_imports.sql");
  assert.match(schema, /create table (if not exists )?review_workspace\.baseline_import_receipts/i);
  assert.match(schema, /outcome text not null check \(outcome in \('succeeded', 'failed'\)\)/i);
  assert.match(schema, /inserted_snapshot_count integer not null/i);
  assert.match(schema, /before update or delete on review_workspace\.baseline_import_receipts/i);
  assert.match(schema, /grant select, insert on review_workspace\.baseline_import_receipts/i);
});

test("Azure export artifacts remain append-only and contain no production credential", () => {
  const schema = migration("005_azure_exports.sql");
  assert.match(schema, /create table review_workspace\.azure_export_artifacts/i);
  assert.match(schema, /blob_reference text not null/i);
  assert.match(schema, /before update or delete on review_workspace\.azure_export_artifacts/i);
  assert.doesNotMatch(schema, /production_database_url/i);
});

test("reviewer CBO eligibility migration is additive and separately runnable", () => {
  const schema = migration("008_reviewer_cbo_eligibility.sql");
  const packageJson = readFileSync(new URL("../package.json", import.meta.url), "utf8");
  assert.match(schema, /add column if not exists reviewer_cbo_eligibility boolean/i);
  assert.match(packageJson, /apply:reviewer-cbo-eligibility-migration/);
  assert.doesNotMatch(packageJson, /apply:review-migrations[^\n]*008_reviewer_cbo_eligibility/);
});

test("CBO eligibility review migration adds only the human-review candidate kind", () => {
  const schema = migration("012_cbo_eligibility_review.sql");
  const runner = readFileSync(new URL("../scripts/apply-review-migrations.ts", import.meta.url), "utf8");
  assert.match(schema, /eligibility_review/);
  assert.match(runner, /012_cbo_eligibility_review\.sql/);
  assert.match(runner, /version in \(4, 9, 10, 11, 12\)/);
});

test("candidate staging serializes concurrent revisions for one resource", () => {
  const repository = readFileSync(new URL("../src/lib/repositories/review.ts", import.meta.url), "utf8");
  assert.match(repository, /pg_advisory_xact_lock\(hashtextextended\(\$1::text, 0\)\)/);
  assert.match(repository, /cross join locked/);
  assert.match(repository, /active_checkpoint/);
  assert.match(repository, /checkpoint\.lease_token = \$8::uuid/);
});

test("durable runs reject unseeded selections and record execution failures", () => {
  const runs = readFileSync(new URL("../src/lib/runs/index.ts", import.meta.url), "utf8");
  assert.match(runs, /Selected resources must have seeded public snapshots/);
  assert.match(runs, /async failCheckpoint/);
  assert.match(runs, /set status = 'failed'/);
  assert.match(runs, /failed_cycle/);
});

test("recurring verification freezes promoted refresh membership and fences completion", () => {
  const schema = migration("009_recurring_verification.sql");
  for (const table of [
    "refresh_manifests",
    "refresh_source_receipts",
    "refresh_snapshot_memberships",
    "verification_cycles",
    "cycle_memberships",
    "run_checkpoint_outcomes",
    "resource_verification_due"
  ]) assert.match(schema, new RegExp(`create table (if not exists )?review_workspace\\.${table}`, "i"));

  assert.match(schema, /status in \('running', 'reconciled', 'failed', 'abandoned'\)/i);
  assert.match(schema, /foreign key \(resource_snapshot_id, resource_id\).*resource_snapshots\(id, resource_id\)/is);
  assert.match(schema, /create unique index .*one_active_full_cycle.*where status in \('queued', 'running', 'paused'\)/is);
  assert.match(schema, /outcome in \('verified_no_change', 'candidate_staged', 'conflict', 'unable_to_verify', 'provider_failure', 'cancelled', 'budget_exhausted'\)/i);
  assert.match(schema, /lease_token uuid not null/i);
  assert.match(schema, /interval '60 days'/i);
  assert.match(schema, /outcome in \('verified_no_change', 'candidate_staged', 'conflict'\)/i);
  assert.match(schema, /before update or delete on review_workspace\.run_checkpoint_outcomes/i);
  assert.match(schema, /grant update \(status, promoted_at, completed_at, discrepancy_count\)\s+on review_workspace\.refresh_manifests to review_workspace_app/i);
  assert.match(schema, /grant update \(run_parameters, budget_state\)\s+on review_workspace\.verification_runs to review_workspace_app/i);
});

test("recurring migration runner blocks ambiguous 004 ledger history without repairing it", () => {
  const runner = readFileSync(new URL("../scripts/apply-review-migrations.ts", import.meta.url), "utf8");
  const packageJson = readFileSync(new URL("../package.json", import.meta.url), "utf8");
  assert.match(runner, /004_baseline_imports\.sql/);
  assert.match(runner, /schema_migrations/);
  assert.match(runner, /preflight/i);
  assert.match(runner, /migrations\.flatMap\(\(path\) => \["-f", fileURLToPath\(path\)\]\)/);
  assert.doesNotMatch(runner, /delete from review_workspace\.schema_migrations/i);
  assert.doesNotMatch(runner, /update review_workspace\.schema_migrations/i);
  assert.match(packageJson, /apply:recurring-verification-migration/);
});

test("mirror-copy groundwork fences idempotent refresh requests before table-copy DDL", () => {
  const schema = migration("010_cbo_mirror_copy.sql");
  const runner = readFileSync(new URL("../scripts/apply-review-migrations.ts", import.meta.url), "utf8");
  assert.match(schema, /create extension if not exists postgis/i);
  assert.match(schema, /create table if not exists review_workspace\.refresh_requests/i);
  assert.match(schema, /idempotency_key text not null unique/i);
  assert.match(schema, /manifest_id uuid unique references review_workspace\.refresh_manifests/i);
  assert.match(schema, /before delete on review_workspace\.refresh_requests/i);
  assert.match(runner, /010_cbo_mirror_copy\.sql/);
  assert.match(runner, /version in \(4, 9, 10, 11, 12\)/);
});

test("pause preserves an active lease until its fenced completion", () => {
  const schema = migration("011_pause_preserves_checkpoint_lease.sql");
  const registry = readFileSync(new URL("../src/lib/runs/index.ts", import.meta.url), "utf8");
  assert.match(schema, /state\.status in \('queued', 'running', 'paused'\)/i);
  assert.match(schema, /when state\.status = 'paused' then 'paused'/i);
  const staging = readFileSync(new URL("../src/lib/repositories/review.ts", import.meta.url), "utf8");
  assert.match(staging, /state\.status in \('queued', 'running', 'paused'\)/i);
  const release = registry.slice(registry.indexOf("async releaseLease(runId"), registry.indexOf("async failCheckpoint(runId"));
  assert.match(release, /status in \('cancelled', 'completed', 'paused'\)/i);
  const pause = registry.slice(registry.indexOf("async pause(runId"), registry.indexOf("async resume(runId"));
  assert.doesNotMatch(pause, /run_checkpoints/);
});

test("candidate staging binds the checkpoint membership snapshot instead of latest", () => {
  const repository = readFileSync(new URL("../src/lib/repositories/review.ts", import.meta.url), "utf8");
  const method = repository.slice(repository.indexOf("async stageVerification"));
  assert.match(method, /checkpoint\.cycle_membership_id/i);
  assert.match(method, /cycle_memberships/i);
  assert.match(method, /select linked\.id\s+from review_workspace\.resource_snapshot_receipts/i);
  assert.doesNotMatch(method, /select linked\.resource_snapshot_id/i);
  assert.doesNotMatch(method, /order by snapshots\.imported_at desc limit 1/i);
});

test("full-cycle checkpoints use memberships inserted by the same launch statement", () => {
  const registry = readFileSync(new URL("../src/lib/runs/index.ts", import.meta.url), "utf8");
  assert.match(registry, /left join frozen_memberships membership\s+on membership\.resource_id = requested\.resource_id::uuid/i);
});
