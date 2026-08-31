-- Additive manual discovery lane. It writes only to review_workspace and never to copied/source CBO or WIC tables.

create table if not exists review_workspace.discovery_activation_events (
  id uuid primary key default gen_random_uuid(),
  action text not null check (action in ('activated', 'deactivated')),
  accepted_cycle_id uuid not null references review_workspace.verification_cycles(id),
  query_policy_version text not null check (length(query_policy_version) between 1 and 100),
  daily_provider_call_ceiling integer not null check (daily_provider_call_ceiling between 1 and 10000),
  rationale text not null check (length(trim(rationale)) between 1 and 1000),
  service_owner_approval text not null check (length(trim(service_owner_approval)) between 1 and 300),
  actor_subject text not null,
  recorded_at timestamptz not null default now()
);

create table if not exists review_workspace.discovery_activation_state (
  singleton boolean primary key default true check (singleton),
  activation_event_id uuid not null references review_workspace.discovery_activation_events(id),
  active boolean not null,
  updated_at timestamptz not null default now()
);

create table if not exists review_workspace.discovery_query_cells (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references review_workspace.verification_runs(id),
  cell_key text not null,
  category text not null references review_workspace.categories(code),
  county text not null check (county in ('Cook', 'DuPage', 'Kane', 'Kendall', 'Lake', 'McHenry', 'Will')),
  provider text not null check (provider in ('google_places', 'search_fallback')),
  query_text text not null check (length(query_text) between 1 and 300),
  query_policy_version text not null,
  result_cap integer not null check (result_cap between 1 and 5),
  execution_outcome text check (execution_outcome in ('succeeded', 'zero_yield', 'provider_failure', 'cancelled')),
  provider_request_id text,
  result_provenance jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (run_id, cell_key)
);

create table if not exists review_workspace.discovery_query_executions (
  id uuid primary key default gen_random_uuid(),
  query_cell_id uuid not null references review_workspace.discovery_query_cells(id),
  run_id uuid not null references review_workspace.verification_runs(id),
  checkpoint_ordinal integer not null,
  attempt integer not null check (attempt between 1 and 3),
  outcome text not null check (outcome in ('succeeded','zero_yield','provider_failure','cancelled')),
  provider_request_id text,
  result_provenance jsonb not null default '[]'::jsonb,
  actor_identity text not null,
  recorded_at timestamptz not null default now(),
  foreign key (run_id, checkpoint_ordinal) references review_workspace.run_checkpoints(run_id, ordinal),
  unique (run_id, checkpoint_ordinal, attempt)
);

create table if not exists review_workspace.discovery_lineages (
  id uuid primary key default gen_random_uuid(),
  display_identity text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists review_workspace.discovery_evaluations (
  id uuid primary key default gen_random_uuid(),
  lineage_id uuid not null references review_workspace.discovery_lineages(id),
  run_id uuid not null references review_workspace.verification_runs(id),
  identity_policy_version text not null,
  original_values jsonb not null,
  normalized_name text not null default '',
  normalized_address text not null default '',
  google_place_id text,
  canonical_domain text not null default '',
  normalized_phone text not null default '',
  material_fingerprint_sha256 text not null check (material_fingerprint_sha256 ~ '^[a-f0-9]{64}$'),
  reopened_from_evaluation_id uuid references review_workspace.discovery_evaluations(id),
  evaluated_at timestamptz not null default now()
);

create index if not exists discovery_evaluations_fingerprint_idx on review_workspace.discovery_evaluations (material_fingerprint_sha256,evaluated_at desc);

create index if not exists discovery_evaluations_place_id_idx on review_workspace.discovery_evaluations (google_place_id) where google_place_id is not null;
create index if not exists discovery_evaluations_address_idx on review_workspace.discovery_evaluations (normalized_address) where normalized_address <> '';

create table if not exists review_workspace.discovery_disposition_events (
  id uuid primary key default gen_random_uuid(),
  evaluation_id uuid not null references review_workspace.discovery_evaluations(id),
  run_id uuid not null references review_workspace.verification_runs(id),
  disposition text not null check (disposition in ('candidate_staged', 'duplicate', 'possible_duplicate', 'out_of_scope', 'not_a_cbo', 'insufficient_evidence', 'provider_failure', 'not_processed_budget')),
  reasons jsonb not null,
  evidence_summary jsonb not null default '{}'::jsonb,
  advisory_state text not null default 'not_requested' check (advisory_state in ('not_requested', 'available', 'advisory_unavailable')),
  actor_identity text not null,
  recorded_at timestamptz not null default now()
);

create table if not exists review_workspace.discovery_current_state (
  lineage_id uuid primary key references review_workspace.discovery_lineages(id),
  evaluation_id uuid not null references review_workspace.discovery_evaluations(id),
  disposition_event_id uuid not null references review_workspace.discovery_disposition_events(id),
  updated_at timestamptz not null default now()
);

create table if not exists review_workspace.discovery_lead_observations (
  evaluation_id uuid not null references review_workspace.discovery_evaluations(id),
  source_observation_id uuid not null references review_workspace.source_observations(id),
  query_cell_id uuid references review_workspace.discovery_query_cells(id),
  linked_at timestamptz not null default now(),
  primary key (evaluation_id, source_observation_id)
);

create table if not exists review_workspace.discovery_daily_budgets (
  budget_date date primary key,
  ceiling_calls integer not null check (ceiling_calls > 0),
  reserved_calls integer not null default 0 check (reserved_calls >= 0),
  used_calls integer not null default 0 check (used_calls >= 0),
  updated_at timestamptz not null default now(),
  check (reserved_calls <= ceiling_calls),
  check (used_calls <= reserved_calls)
);

create table if not exists review_workspace.discovery_campaigns (
  run_id uuid primary key references review_workspace.verification_runs(id),
  status text not null check (status in ('queued', 'running', 'paused', 'cancelled', 'completed', 'failed')),
  reserved_calls integer not null check (reserved_calls > 0),
  used_calls integer not null default 0 check (used_calls between 0 and reserved_calls),
  budget_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists review_workspace.discovery_run_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references review_workspace.verification_runs(id),
  action text not null check (action in ('launched', 'checkpoint_claimed', 'paused', 'resumed', 'cancelled')),
  actor_identity text not null,
  details jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now()
);

create unique index if not exists one_active_discovery_campaign
  on review_workspace.discovery_campaigns ((true))
  where status in ('queued', 'running', 'paused');

alter table review_workspace.run_checkpoints
  add column if not exists query_cell_id uuid references review_workspace.discovery_query_cells(id),
  add column if not exists discovery_evaluation_id uuid references review_workspace.discovery_evaluations(id),
  add column if not exists next_attempt_at timestamptz;

alter table review_workspace.run_checkpoints drop constraint if exists run_checkpoints_state_check;
alter table review_workspace.run_checkpoints add constraint run_checkpoints_state_check
  check (state in ('pending', 'retry_wait', 'leased', 'completed', 'failed'));

alter table review_workspace.run_checkpoints drop constraint if exists exactly_one_discovery_checkpoint_target;
alter table review_workspace.run_checkpoints add constraint exactly_one_discovery_checkpoint_target
  check (num_nonnulls(resource_id, query_cell_id, discovery_evaluation_id) = 1) not valid;
alter table review_workspace.run_checkpoints validate constraint exactly_one_discovery_checkpoint_target;

alter table review_workspace.run_checkpoint_outcomes drop constraint if exists run_checkpoint_outcomes_outcome_check;
alter table review_workspace.run_checkpoint_outcomes add constraint run_checkpoint_outcomes_outcome_check check (outcome in (
  'verified_no_change', 'candidate_staged', 'conflict', 'unable_to_verify', 'provider_failure', 'cancelled', 'budget_exhausted',
  'duplicate', 'possible_duplicate', 'out_of_scope', 'not_a_cbo', 'insufficient_evidence', 'not_processed_budget', 'query_expanded'
));

create table if not exists review_workspace.candidate_revision_discovery_links (
  candidate_revision_id uuid primary key references review_workspace.candidate_revisions(id),
  evaluation_id uuid not null references review_workspace.discovery_evaluations(id),
  linked_at timestamptz not null default now()
);
create index if not exists candidate_revision_discovery_links_evaluation_idx on review_workspace.candidate_revision_discovery_links(evaluation_id);
create index if not exists discovery_disposition_events_run_idx on review_workspace.discovery_disposition_events(run_id,recorded_at desc);

create or replace function review_workspace.validate_discovery_activation()
returns trigger language plpgsql as $$
begin
  if not exists (select 1 from review_workspace.verification_cycles where id = new.accepted_cycle_id and status = 'completed') then
    raise exception 'Discovery activation requires a completed accepted known-directory cycle';
  end if;
  return new;
end;
$$;

drop trigger if exists discovery_activation_requires_completed_cycle on review_workspace.discovery_activation_events;
create trigger discovery_activation_requires_completed_cycle before insert on review_workspace.discovery_activation_events
for each row execute function review_workspace.validate_discovery_activation();

create trigger discovery_activation_events_append_only before update or delete on review_workspace.discovery_activation_events for each row execute function review_workspace.reject_audit_mutation();
create trigger discovery_query_cells_append_only before update or delete on review_workspace.discovery_query_cells for each row execute function review_workspace.reject_audit_mutation();
create trigger discovery_query_executions_append_only before update or delete on review_workspace.discovery_query_executions for each row execute function review_workspace.reject_audit_mutation();
create trigger discovery_run_events_append_only before update or delete on review_workspace.discovery_run_events for each row execute function review_workspace.reject_audit_mutation();
create trigger discovery_lineages_append_only before update or delete on review_workspace.discovery_lineages for each row execute function review_workspace.reject_audit_mutation();
create trigger discovery_evaluations_append_only before update or delete on review_workspace.discovery_evaluations for each row execute function review_workspace.reject_audit_mutation();
create trigger discovery_disposition_events_append_only before update or delete on review_workspace.discovery_disposition_events for each row execute function review_workspace.reject_audit_mutation();
create trigger discovery_lead_observations_append_only before update or delete on review_workspace.discovery_lead_observations for each row execute function review_workspace.reject_audit_mutation();
create trigger candidate_revision_discovery_links_append_only before update or delete on review_workspace.candidate_revision_discovery_links for each row execute function review_workspace.reject_audit_mutation();

grant select, insert on review_workspace.discovery_activation_events, review_workspace.discovery_query_cells, review_workspace.discovery_query_executions,
  review_workspace.discovery_run_events, review_workspace.discovery_lineages, review_workspace.discovery_evaluations, review_workspace.discovery_disposition_events,
  review_workspace.discovery_lead_observations, review_workspace.candidate_revision_discovery_links to review_workspace_app;
grant select, insert, update on review_workspace.discovery_activation_state, review_workspace.discovery_current_state,
  review_workspace.discovery_daily_budgets, review_workspace.discovery_campaigns to review_workspace_app;
