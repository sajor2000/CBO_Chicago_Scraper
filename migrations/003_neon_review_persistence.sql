-- Durable operational projections for the writable, non-production review workspace.
-- Existing audit tables remain append-only; these tables hold only mutable CAS/lease state.

create table review_workspace.workspace_sentinel (
  singleton boolean primary key default true check (singleton),
  workspace_kind text not null check (workspace_kind = 'dedicated_review_workspace'),
  created_at timestamptz not null default now()
);

insert into review_workspace.workspace_sentinel (singleton, workspace_kind)
values (true, 'dedicated_review_workspace')
on conflict (singleton) do nothing;

create table review_workspace.schema_migrations (
  version integer primary key check (version > 0),
  checksum text not null check (checksum ~ '^[a-f0-9]{64}$'),
  applied_at timestamptz not null default now()
);

-- The original access table was keyed only by subject. A subject can now hold
-- both reviewer and operator grants; revocation remains an explicit mutation.
alter table review_workspace.reviewer_access
  add column role text not null default 'reviewer'
  check (role in ('reviewer', 'operator'));

alter table review_workspace.reviewer_access
  drop constraint reviewer_access_pkey,
  add primary key (subject, role);

alter table review_workspace.reviewer_access
  alter column role drop default;

create table review_workspace.resource_snapshot_receipts (
  resource_snapshot_id uuid primary key references review_workspace.resource_snapshots(id),
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  redaction_policy_version text not null,
  raw_object_reference text,
  recorded_at timestamptz not null default now()
);

create table review_workspace.candidate_revision_snapshot_links (
  candidate_revision_id uuid primary key references review_workspace.candidate_revisions(id),
  resource_snapshot_id uuid not null references review_workspace.resource_snapshots(id),
  linked_at timestamptz not null default now()
);

create table review_workspace.candidate_current_state (
  candidate_id uuid primary key default gen_random_uuid(),
  candidate_revision_id uuid not null unique references review_workspace.candidate_revisions(id),
  external_id text not null unique,
  revision integer not null check (revision > 0),
  status text not null check (status in ('staged', 'deferred', 'rejected', 'approved_for_future_export')),
  approved_field_paths jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table review_workspace.run_current_state (
  run_id uuid primary key references review_workspace.verification_runs(id),
  status text not null check (status in ('queued', 'running', 'cancelled', 'completed', 'failed')),
  next_checkpoint_ordinal integer not null default 0 check (next_checkpoint_ordinal >= 0),
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);

create table review_workspace.run_checkpoints (
  run_id uuid not null references review_workspace.verification_runs(id),
  ordinal integer not null check (ordinal >= 0),
  resource_id uuid references review_workspace.resources(id),
  state text not null default 'pending' check (state in ('pending', 'leased', 'completed', 'failed')),
  lease_token uuid,
  lease_expires_at timestamptz,
  attempt integer not null default 0 check (attempt >= 0),
  report_delta jsonb not null default '{}'::jsonb,
  completed_at timestamptz,
  primary key (run_id, ordinal),
  check ((lease_token is null) = (lease_expires_at is null))
);

create table review_workspace.run_reports (
  run_id uuid primary key references review_workspace.verification_runs(id),
  report jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists candidate_current_state_updated_at_idx
  on review_workspace.candidate_current_state (updated_at desc);

create index if not exists review_decisions_candidate_revision_id_idx
  on review_workspace.review_decisions (candidate_revision_id, decided_at);

create trigger resource_snapshot_receipts_append_only
before update or delete on review_workspace.resource_snapshot_receipts
for each row execute function review_workspace.reject_audit_mutation();

create trigger candidate_revision_snapshot_links_append_only
before update or delete on review_workspace.candidate_revision_snapshot_links
for each row execute function review_workspace.reject_audit_mutation();

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'review_workspace_app') then
    create role review_workspace_app nologin;
  end if;
end;
$$;

grant usage on schema review_workspace to review_workspace_app;
grant select on review_workspace.workspace_sentinel, review_workspace.reviewer_access to review_workspace_app;
grant select, insert on review_workspace.resources, review_workspace.resource_snapshots,
  review_workspace.source_observations, review_workspace.candidate_revisions,
  review_workspace.review_decisions, review_workspace.resource_snapshot_receipts,
  review_workspace.candidate_revision_snapshot_links, review_workspace.verification_runs to review_workspace_app;
grant select, insert, update on review_workspace.candidate_current_state,
  review_workspace.run_current_state, review_workspace.run_checkpoints,
  review_workspace.run_reports to review_workspace_app;
