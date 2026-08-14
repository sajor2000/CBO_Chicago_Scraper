-- Durable recurring verification state. Audit/evidence tables stay append-only.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'resource_snapshots_id_resource_id_key'
      and conrelid = 'review_workspace.resource_snapshots'::regclass
  ) then
    alter table review_workspace.resource_snapshots
      add constraint resource_snapshots_id_resource_id_key unique (id, resource_id);
  end if;
end;
$$;

create table if not exists review_workspace.refresh_manifests (
  id uuid primary key default gen_random_uuid(),
  status text not null check (status in ('running', 'reconciled', 'failed', 'abandoned')),
  expected_source_count integer not null default 2 check (expected_source_count = 2),
  discrepancy_count integer not null default 0 check (discrepancy_count >= 0),
  source_manifest_sha256 text check (source_manifest_sha256 is null or source_manifest_sha256 ~ '^[a-f0-9]{64}$'),
  started_at timestamptz not null default now(),
  promoted_at timestamptz,
  completed_at timestamptz,
  check ((status = 'reconciled') = (promoted_at is not null)),
  check (status <> 'reconciled' or discrepancy_count = 0)
);

create table if not exists review_workspace.refresh_source_receipts (
  id uuid primary key default gen_random_uuid(),
  manifest_id uuid not null references review_workspace.refresh_manifests(id),
  source_relation text not null check (source_relation in ('community_resource_locations', 'wic_locations')),
  outcome text not null check (outcome in ('succeeded', 'failed')),
  source_row_count integer not null check (source_row_count >= 0),
  copied_snapshot_count integer not null check (copied_snapshot_count >= 0),
  discrepancy_count integer not null check (discrepancy_count >= 0),
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[a-f0-9]{64}$'),
  error_code text,
  recorded_at timestamptz not null default now(),
  unique (manifest_id, source_relation)
);

create table if not exists review_workspace.refresh_snapshot_memberships (
  manifest_id uuid not null references review_workspace.refresh_manifests(id),
  resource_id uuid not null references review_workspace.resources(id),
  resource_snapshot_id uuid not null,
  source_relation text not null check (source_relation in ('community_resource_locations', 'wic_locations')),
  recorded_at timestamptz not null default now(),
  primary key (manifest_id, resource_id),
  unique (manifest_id, resource_id, resource_snapshot_id),
  foreign key (resource_snapshot_id, resource_id)
    references review_workspace.resource_snapshots(id, resource_id)
);

create table if not exists review_workspace.verification_cycles (
  id uuid primary key default gen_random_uuid(),
  refresh_manifest_id uuid not null references review_workspace.refresh_manifests(id),
  status text not null check (status in ('queued', 'running', 'paused', 'completed', 'cancelled', 'failed')),
  due_anchor_at timestamptz not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  check ((status = 'cancelled') = (cancelled_at is not null))
);

create unique index if not exists verification_cycles_one_active_full_cycle
  on review_workspace.verification_cycles ((true))
  where status in ('queued', 'running', 'paused');

create table if not exists review_workspace.cycle_memberships (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references review_workspace.verification_cycles(id),
  resource_id uuid not null references review_workspace.resources(id),
  resource_snapshot_id uuid not null,
  refresh_manifest_id uuid not null,
  created_at timestamptz not null default now(),
  unique (cycle_id, resource_id),
  unique (cycle_id, resource_id, resource_snapshot_id),
  foreign key (refresh_manifest_id, resource_id, resource_snapshot_id)
    references review_workspace.refresh_snapshot_memberships(manifest_id, resource_id, resource_snapshot_id),
  foreign key (resource_snapshot_id, resource_id)
    references review_workspace.resource_snapshots(id, resource_id)
);

create table if not exists review_workspace.resource_verification_due (
  resource_id uuid primary key references review_workspace.resources(id),
  last_cycle_id uuid references review_workspace.verification_cycles(id),
  last_outcome text check (last_outcome in ('verified_no_change', 'candidate_staged', 'conflict')),
  last_completed_at timestamptz,
  next_due_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table review_workspace.verification_runs
  add column if not exists run_mode text not null default 'manual_selected',
  add column if not exists cycle_id uuid references review_workspace.verification_cycles(id),
  add column if not exists budget_state text not null default 'available';

alter table review_workspace.verification_runs
  drop constraint if exists verification_runs_run_mode_check,
  add constraint verification_runs_run_mode_check
    check (run_mode in ('manual_selected', 'manual_full_cycle', 'discovery_only', 'scheduled_cycle')),
  drop constraint if exists verification_runs_budget_state_check,
  add constraint verification_runs_budget_state_check
    check (budget_state in ('available', 'exhausted', 'approved_continuation'));

alter table review_workspace.run_current_state
  drop constraint if exists run_current_state_status_check;
alter table review_workspace.run_current_state
  add constraint run_current_state_status_check
  check (status in ('queued', 'running', 'paused', 'cancelled', 'completed', 'failed'));

alter table review_workspace.run_checkpoints
  add column if not exists cycle_membership_id uuid references review_workspace.cycle_memberships(id);

create table if not exists review_workspace.run_checkpoint_outcomes (
  run_id uuid not null,
  ordinal integer not null,
  cycle_membership_id uuid references review_workspace.cycle_memberships(id),
  lease_token uuid not null,
  outcome text not null check (outcome in ('verified_no_change', 'candidate_staged', 'conflict', 'unable_to_verify', 'provider_failure', 'cancelled', 'budget_exhausted')),
  report_delta jsonb not null default '{}'::jsonb,
  completed_at timestamptz not null default now(),
  primary key (run_id, ordinal),
  foreign key (run_id, ordinal) references review_workspace.run_checkpoints(run_id, ordinal)
);

create table if not exists review_workspace.candidate_revision_cycle_memberships (
  candidate_revision_id uuid primary key references review_workspace.candidate_revisions(id),
  cycle_membership_id uuid not null references review_workspace.cycle_memberships(id),
  linked_at timestamptz not null default now()
);

create or replace function review_workspace.promote_refresh_manifest(target_manifest_id uuid)
returns boolean
language plpgsql
as $$
declare
  promoted boolean;
begin
  update review_workspace.refresh_manifests manifest
  set status = 'reconciled', promoted_at = now(), completed_at = now()
  where manifest.id = target_manifest_id and manifest.status = 'running'
    and manifest.discrepancy_count = 0
    and (
      select count(*) = 2
        and bool_and(receipt.outcome = 'succeeded')
        and bool_and(receipt.discrepancy_count = 0)
        and sum(receipt.copied_snapshot_count) = (
          select count(*) from review_workspace.refresh_snapshot_memberships membership
          where membership.manifest_id = manifest.id
        )
      from review_workspace.refresh_source_receipts receipt
      where receipt.manifest_id = manifest.id
    )
    and not exists (
      select 1 from review_workspace.refresh_source_receipts receipt
      where receipt.manifest_id = manifest.id and receipt.copied_snapshot_count <> (
        select count(*) from review_workspace.refresh_snapshot_memberships membership
        where membership.manifest_id = manifest.id and membership.source_relation = receipt.source_relation
      )
    )
  returning true into promoted;
  return coalesce(promoted, false);
end;
$$;

create trigger refresh_source_receipts_append_only
before update or delete on review_workspace.refresh_source_receipts
for each row execute function review_workspace.reject_audit_mutation();
create trigger refresh_snapshot_memberships_append_only
before update or delete on review_workspace.refresh_snapshot_memberships
for each row execute function review_workspace.reject_audit_mutation();
create trigger cycle_memberships_append_only
before update or delete on review_workspace.cycle_memberships
for each row execute function review_workspace.reject_audit_mutation();
create trigger run_checkpoint_outcomes_append_only
before update or delete on review_workspace.run_checkpoint_outcomes
for each row execute function review_workspace.reject_audit_mutation();
create trigger candidate_revision_cycle_memberships_append_only
before update or delete on review_workspace.candidate_revision_cycle_memberships
for each row execute function review_workspace.reject_audit_mutation();

create or replace function review_workspace.complete_run_checkpoint(
  target_run_id uuid,
  target_lease_token uuid,
  terminal_outcome text,
  delta jsonb
) returns boolean
language plpgsql
as $$
declare
  claimed review_workspace.run_checkpoints%rowtype;
  mode text;
  used integer;
  budget integer;
begin
  select checkpoint.* into claimed
  from review_workspace.run_checkpoints checkpoint
  join review_workspace.run_current_state state on state.run_id = checkpoint.run_id
  where checkpoint.run_id = target_run_id
    and checkpoint.lease_token = target_lease_token
    and checkpoint.state = 'leased'
    and checkpoint.lease_expires_at > now()
    and state.status = 'running'
  for update of checkpoint;
  if not found then return false; end if;

  select run_mode, (run_parameters->>'budget')::integer
  into mode, budget from review_workspace.verification_runs where id = target_run_id;

  insert into review_workspace.run_checkpoint_outcomes
    (run_id, ordinal, cycle_membership_id, lease_token, outcome, report_delta)
  values (claimed.run_id, claimed.ordinal, claimed.cycle_membership_id, target_lease_token, terminal_outcome, delta);

  update review_workspace.run_checkpoints
  set state = case when terminal_outcome in ('provider_failure') then 'failed' else 'completed' end,
      lease_token = null, lease_expires_at = null, report_delta = delta, completed_at = now()
  where run_id = claimed.run_id and ordinal = claimed.ordinal;

  update review_workspace.run_reports current
  set report = jsonb_build_object(
    'recordsChecked', coalesce((current.report->>'recordsChecked')::integer, 0) + coalesce((delta->>'recordsChecked')::integer, 0),
    'candidatesStaged', coalesce((current.report->>'candidatesStaged')::integer, 0) + coalesce((delta->>'candidatesStaged')::integer, 0),
    'conflicts', coalesce((current.report->>'conflicts')::integer, 0) + coalesce((delta->>'conflicts')::integer, 0),
    'unableToVerify', coalesce((current.report->>'unableToVerify')::integer, 0) + coalesce((delta->>'unableToVerify')::integer, 0),
    'providerFailures', coalesce((current.report->>'providerFailures')::integer, 0) + coalesce((delta->>'providerFailures')::integer, 0),
    'budgetUsed', coalesce((current.report->>'budgetUsed')::integer, 0) + coalesce((delta->>'budgetUsed')::integer, 0)
  ), updated_at = now()
  where current.run_id = target_run_id;
  select coalesce((report->>'budgetUsed')::integer, 0) into used
  from review_workspace.run_reports where run_id = target_run_id;

  update review_workspace.verification_runs run
  set budget_state = case
    when used >= budget and claimed.ordinal + 1 < (select count(*) from review_workspace.run_checkpoints where run_id = target_run_id)
      then 'exhausted'
    else run.budget_state
  end
  where run.id = target_run_id;

  if mode in ('manual_full_cycle', 'scheduled_cycle')
     and terminal_outcome in ('verified_no_change', 'candidate_staged', 'conflict') then
    insert into review_workspace.resource_verification_due
      (resource_id, last_cycle_id, last_outcome, last_completed_at, next_due_at)
    select membership.resource_id, membership.cycle_id, terminal_outcome, now(), now() + interval '60 days'
    from review_workspace.cycle_memberships membership where membership.id = claimed.cycle_membership_id
    on conflict (resource_id) do update set
      last_cycle_id = excluded.last_cycle_id, last_outcome = excluded.last_outcome,
      last_completed_at = excluded.last_completed_at, next_due_at = excluded.next_due_at, updated_at = now();
  end if;

  update review_workspace.run_current_state state
  set next_checkpoint_ordinal = next_checkpoint_ordinal + 1,
      status = case
        when terminal_outcome = 'budget_exhausted' then 'paused'
        when next_checkpoint_ordinal + 1 >= (select count(*) from review_workspace.run_checkpoints where run_id = target_run_id) then 'completed'
        when used >= budget then 'paused'
        else 'queued'
      end,
      updated_at = now(), revision = revision + 1
  where state.run_id = target_run_id;

  update review_workspace.verification_cycles cycle
  set status = state.status,
      completed_at = case when state.status = 'completed' then now() else cycle.completed_at end
  from review_workspace.verification_runs run
  join review_workspace.run_current_state state on state.run_id = run.id
  where run.id = target_run_id and cycle.id = run.cycle_id;
  return true;
end;
$$;

grant select, insert on review_workspace.refresh_manifests to review_workspace_app;
grant update (status, promoted_at, completed_at, discrepancy_count)
  on review_workspace.refresh_manifests to review_workspace_app;
grant select, insert on review_workspace.refresh_source_receipts, review_workspace.refresh_snapshot_memberships,
  review_workspace.verification_cycles, review_workspace.cycle_memberships,
  review_workspace.run_checkpoint_outcomes, review_workspace.candidate_revision_cycle_memberships
  to review_workspace_app;
grant select, insert, update on review_workspace.resource_verification_due,
  review_workspace.verification_cycles to review_workspace_app;
grant update (run_parameters, budget_state)
  on review_workspace.verification_runs to review_workspace_app;
grant execute on function review_workspace.complete_run_checkpoint(uuid, uuid, text, jsonb)
  to review_workspace_app;
grant execute on function review_workspace.promote_refresh_manifest(uuid)
  to review_workspace_app;
