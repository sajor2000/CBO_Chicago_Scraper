-- Copied production-compatible CBO/WIC rows remain in public. This schema only
-- records their refresh provenance and review-workspace verification state.
create table if not exists review_workspace.mirror_refreshes (
  id uuid primary key default gen_random_uuid(),
  status text not null check (status in ('running', 'complete', 'failed')),
  source_manifest_sha256 text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists review_workspace.mirror_resource_links (
  source_relation text not null check (source_relation in ('community_resource_locations', 'wic_locations')),
  source_key text not null,
  resource_id uuid not null unique references review_workspace.resources(id),
  refresh_id uuid not null references review_workspace.mirror_refreshes(id),
  primary key (source_relation, source_key)
);

create index if not exists source_observations_run_resource_idx
  on review_workspace.source_observations (run_id, resource_id, retrieved_at desc);

grant select on review_workspace.mirror_refreshes, review_workspace.mirror_resource_links to review_workspace_app;
