-- Writable review workspace only. Never run this against the read-only source mirror.
create schema if not exists review_workspace;
create extension if not exists pgcrypto;

create table review_workspace.resources (
  id uuid primary key default gen_random_uuid(),
  reference_source text not null,
  reference_source_id text not null,
  created_at timestamptz not null default now(),
  unique (reference_source, reference_source_id)
);

create table review_workspace.resource_snapshots (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references review_workspace.resources(id),
  source_version text not null,
  source_payload jsonb not null,
  imported_at timestamptz not null default now(),
  imported_by text not null,
  unique (resource_id, source_version)
);

create table review_workspace.verification_runs (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  trigger_kind text not null check (trigger_kind in ('manual', 'scheduled')),
  started_at timestamptz not null default now(),
  requested_by text,
  run_parameters jsonb not null default '{}'::jsonb
);

create table review_workspace.source_observations (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid references review_workspace.resources(id),
  run_id uuid references review_workspace.verification_runs(id),
  provider text not null,
  observation_key text not null,
  observed_at timestamptz not null,
  retrieved_at timestamptz not null default now(),
  extracted_values jsonb not null,
  retrieval_metadata jsonb not null default '{}'::jsonb,
  supersedes_observation_id uuid references review_workspace.source_observations(id),
  check (supersedes_observation_id is null or supersedes_observation_id <> id),
  unique (provider, observation_key, observed_at)
);

create table review_workspace.candidate_revisions (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid references review_workspace.resources(id),
  run_id uuid references review_workspace.verification_runs(id),
  kind text not null check (kind in ('update', 'new_resource', 'closure_review')),
  before_values jsonb not null,
  proposed_values jsonb not null,
  provenance jsonb not null,
  created_at timestamptz not null default now(),
  supersedes_candidate_revision_id uuid references review_workspace.candidate_revisions(id),
  check (supersedes_candidate_revision_id is null or supersedes_candidate_revision_id <> id)
);

create table review_workspace.review_decisions (
  id uuid primary key default gen_random_uuid(),
  candidate_revision_id uuid not null references review_workspace.candidate_revisions(id),
  reviewer_subject text not null,
  decision text not null check (decision in ('approved', 'rejected', 'deferred')),
  approved_field_paths jsonb not null default '[]'::jsonb,
  rationale text,
  decided_at timestamptz not null default now(),
  supersedes_decision_id uuid references review_workspace.review_decisions(id),
  check (supersedes_decision_id is null or supersedes_decision_id <> id)
);

create table review_workspace.publish_intents (
  id uuid primary key default gen_random_uuid(),
  candidate_revision_id uuid not null references review_workspace.candidate_revisions(id),
  review_decision_id uuid not null references review_workspace.review_decisions(id),
  approved_payload jsonb not null,
  requested_at timestamptz not null default now(),
  requested_by text not null
);

create table review_workspace.publication_receipts (
  id uuid primary key default gen_random_uuid(),
  publish_intent_id uuid not null references review_workspace.publish_intents(id),
  outcome text not null check (outcome in ('published', 'failed', 'rolled_back')),
  target_reference text,
  receipt_payload jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now()
);

create table review_workspace.reviewer_access (
  subject text primary key,
  granted_by text not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (revoked_at is null or revoked_at >= granted_at)
);

create function review_workspace.reject_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception '% rows are append-only; create a superseding event instead', tg_table_name;
end;
$$;

create trigger resource_snapshots_append_only
before update or delete on review_workspace.resource_snapshots
for each row execute function review_workspace.reject_audit_mutation();

create trigger source_observations_append_only
before update or delete on review_workspace.source_observations
for each row execute function review_workspace.reject_audit_mutation();

create trigger candidate_revisions_append_only
before update or delete on review_workspace.candidate_revisions
for each row execute function review_workspace.reject_audit_mutation();

create trigger review_decisions_append_only
before update or delete on review_workspace.review_decisions
for each row execute function review_workspace.reject_audit_mutation();

create trigger publish_intents_append_only
before update or delete on review_workspace.publish_intents
for each row execute function review_workspace.reject_audit_mutation();

create trigger publication_receipts_append_only
before update or delete on review_workspace.publication_receipts
for each row execute function review_workspace.reject_audit_mutation();
