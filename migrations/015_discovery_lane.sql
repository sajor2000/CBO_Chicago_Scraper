-- Additive, review-only discovery lane. It never writes copied source tables.
create table if not exists review_workspace.discovery_lineages (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  normalized_name text not null,
  normalized_address text,
  place_id text,
  canonical_domain text,
  normalized_phone text,
  created_at timestamptz not null default now(),
  unique (normalized_name, normalized_address)
);

create table if not exists review_workspace.discovery_evaluations (
  id uuid primary key default gen_random_uuid(),
  lineage_id uuid not null references review_workspace.discovery_lineages(id),
  identity_policy_version text not null,
  disposition text not null check (disposition in ('duplicate', 'possible_duplicate', 'out_of_scope', 'not_a_cbo', 'insufficient_evidence', 'provider_failure', 'new_resource')),
  reasons jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

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
  policy_version text not null,
  daily_provider_call_ceiling integer not null check (daily_provider_call_ceiling > 0),
  rationale text not null,
  created_at timestamptz not null default now(),
  check (not active or accepted_cycle_id is not null)
);

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

create or replace function review_workspace.validate_discovery_activation()
returns trigger language plpgsql as $$
begin
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
  review_workspace.candidate_revision_discovery_lineages to review_workspace_app;
grant update (activation_id, active, updated_at) on review_workspace.discovery_activation_current to review_workspace_app;
