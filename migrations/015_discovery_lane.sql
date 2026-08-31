-- Additive, review-only discovery lane. It never writes copied source tables.
create table if not exists review_workspace.discovery_lineages (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  display_address text,
  display_phone text,
  normalized_name text not null,
  normalized_address text,
  place_id text,
  canonical_domain text,
  normalized_phone text,
  created_at timestamptz not null default now(),
  unique (normalized_name, normalized_address)
);

alter table review_workspace.discovery_lineages
  add column if not exists display_address text,
  add column if not exists display_phone text;

create table if not exists review_workspace.discovery_query_cells (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references review_workspace.verification_runs(id),
  ordinal integer not null check (ordinal >= 0),
  category_code text not null,
  county text not null,
  provider text not null check (provider in ('google_places', 'exa')),
  query_text text not null check (length(query_text) <= 500),
  policy_version text not null,
  result_cap integer not null check (result_cap between 1 and 5),
  created_at timestamptz not null default now(),
  unique (run_id, ordinal)
);

create table if not exists review_workspace.discovery_leads (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references review_workspace.verification_runs(id),
  lineage_id uuid not null references review_workspace.discovery_lineages(id),
  first_query_cell_id uuid not null references review_workspace.discovery_query_cells(id),
  disposition text not null check (disposition in ('pending', 'candidate_staged', 'duplicate', 'possible_duplicate', 'out_of_scope', 'not_a_cbo', 'insufficient_evidence', 'provider_failure', 'not_processed_budget')),
  reasons jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (run_id, lineage_id)
);

create table if not exists review_workspace.discovery_provider_budget_days (
  budget_day date primary key,
  reserved_calls integer not null default 0 check (reserved_calls >= 0),
  used_calls integer not null default 0 check (used_calls >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists review_workspace.discovery_evaluations (
  id uuid primary key default gen_random_uuid(),
  lineage_id uuid not null references review_workspace.discovery_lineages(id),
  identity_policy_version text not null,
  disposition text not null check (disposition in ('candidate_staged', 'duplicate', 'possible_duplicate', 'out_of_scope', 'not_a_cbo', 'insufficient_evidence', 'provider_failure', 'not_processed_budget')),
  reasons jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table review_workspace.discovery_evaluations
  drop constraint if exists discovery_evaluations_disposition_check,
  add constraint discovery_evaluations_disposition_check
    check (disposition in ('candidate_staged', 'duplicate', 'possible_duplicate', 'out_of_scope', 'not_a_cbo', 'insufficient_evidence', 'provider_failure', 'not_processed_budget'));

create table if not exists review_workspace.discovery_observations (
  lineage_id uuid not null references review_workspace.discovery_lineages(id),
  source_observation_id uuid not null references review_workspace.source_observations(id),
  primary key (lineage_id, source_observation_id)
);

create table if not exists review_workspace.discovery_activations (
  id uuid primary key default gen_random_uuid(),
  active boolean not null,
  accepted_cycle_id uuid references review_workspace.verification_cycles(id),
  actor_subject text not null,
  service_owner_subject text,
  policy_version text not null,
  daily_provider_call_ceiling integer not null check (daily_provider_call_ceiling > 0),
  rationale text not null,
  created_at timestamptz not null default now(),
  check (not active or accepted_cycle_id is not null)
);

alter table review_workspace.discovery_activations
  add column if not exists service_owner_subject text;

create table if not exists review_workspace.discovery_activation_current (
  singleton boolean primary key default true check (singleton),
  activation_id uuid not null references review_workspace.discovery_activations(id),
  active boolean not null,
  updated_at timestamptz not null default now()
);

create table if not exists review_workspace.candidate_revision_discovery_lineages (
  candidate_revision_id uuid primary key references review_workspace.candidate_revisions(id),
  lineage_id uuid not null references review_workspace.discovery_lineages(id),
  linked_at timestamptz not null default now()
);

alter table review_workspace.run_checkpoints
  add column if not exists discovery_query_cell_id uuid references review_workspace.discovery_query_cells(id),
  add column if not exists discovery_lead_id uuid references review_workspace.discovery_leads(id),
  add column if not exists next_attempt_at timestamptz;

alter table review_workspace.run_checkpoints
  drop constraint if exists run_checkpoints_state_check,
  add constraint run_checkpoints_state_check
    check (state in ('pending', 'leased', 'retry_wait', 'completed', 'failed')),
  drop constraint if exists run_checkpoints_one_target_check,
  add constraint run_checkpoints_one_target_check
    check (num_nonnulls(resource_id, discovery_query_cell_id, discovery_lead_id) = 1);

alter table review_workspace.run_checkpoint_outcomes
  drop constraint if exists run_checkpoint_outcomes_outcome_check,
  add constraint run_checkpoint_outcomes_outcome_check
    check (outcome in ('verified_no_change', 'candidate_staged', 'conflict', 'unable_to_verify', 'provider_failure', 'cancelled', 'budget_exhausted', 'query_completed', 'duplicate', 'possible_duplicate', 'out_of_scope', 'not_a_cbo', 'insufficient_evidence', 'not_processed_budget'));

create unique index if not exists run_checkpoints_discovery_query_cell_idx
  on review_workspace.run_checkpoints (discovery_query_cell_id)
  where discovery_query_cell_id is not null;
create unique index if not exists run_checkpoints_discovery_lead_idx
  on review_workspace.run_checkpoints (discovery_lead_id)
  where discovery_lead_id is not null;
create or replace function review_workspace.validate_discovery_activation()
returns trigger language plpgsql as $$
begin
  if new.active and (new.service_owner_subject is null or length(trim(new.service_owner_subject)) = 0) then
    raise exception 'Discovery activation requires service-owner approval';
  end if;
  if new.active and not exists (
    select 1 from review_workspace.verification_cycles
    where id = new.accepted_cycle_id and status = 'completed'
  ) then
    raise exception 'Discovery activation requires a completed accepted directory cycle';
  end if;
  return new;
end;
$$;
create trigger discovery_activation_requires_completed_cycle
before insert on review_workspace.discovery_activations
for each row execute function review_workspace.validate_discovery_activation();

create or replace function review_workspace.apply_discovery_activation()
returns trigger language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('discovery_activation_current', 0));
  insert into review_workspace.discovery_activation_current (singleton, activation_id, active)
  values (true, new.id, new.active)
  on conflict (singleton) do update set
    activation_id = excluded.activation_id, active = excluded.active, updated_at = now();
  return new;
end;
$$;
create trigger discovery_activation_updates_current_state
after insert on review_workspace.discovery_activations
for each row execute function review_workspace.apply_discovery_activation();

create trigger discovery_evaluations_append_only before update or delete on review_workspace.discovery_evaluations
  for each row execute function review_workspace.reject_audit_mutation();
create trigger discovery_observations_append_only before update or delete on review_workspace.discovery_observations
  for each row execute function review_workspace.reject_audit_mutation();
create trigger discovery_activations_append_only before update or delete on review_workspace.discovery_activations
  for each row execute function review_workspace.reject_audit_mutation();
create trigger candidate_revision_discovery_lineages_append_only before update or delete on review_workspace.candidate_revision_discovery_lineages
  for each row execute function review_workspace.reject_audit_mutation();

grant select, insert on review_workspace.discovery_lineages, review_workspace.discovery_evaluations,
  review_workspace.discovery_observations, review_workspace.discovery_activations,
  review_workspace.discovery_activation_current,
  review_workspace.candidate_revision_discovery_lineages, review_workspace.discovery_query_cells,
  review_workspace.discovery_leads, review_workspace.discovery_provider_budget_days to review_workspace_app;
grant update (activation_id, active, updated_at) on review_workspace.discovery_activation_current to review_workspace_app;
grant update (disposition, reasons) on review_workspace.discovery_leads to review_workspace_app;
grant update (reserved_calls, used_calls, updated_at) on review_workspace.discovery_provider_budget_days to review_workspace_app;
grant update (state, lease_token, lease_expires_at, attempt, report_delta, completed_at, next_attempt_at)
  on review_workspace.run_checkpoints to review_workspace_app;
