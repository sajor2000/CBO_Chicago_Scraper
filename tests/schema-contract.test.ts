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
