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
  assert.match(schema, /unique \(provider, observation_key\)/i);
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
