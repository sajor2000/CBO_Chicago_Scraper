-- Azure receives downloadable, manually applied patches only. This workspace
-- never stores an Azure production credential or executes these patches.
create table review_workspace.azure_export_artifacts (
  id uuid primary key default gen_random_uuid(),
  requested_by text not null,
  manifest jsonb not null,
  blob_reference text not null,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now()
);

create trigger azure_export_artifacts_append_only
before update or delete on review_workspace.azure_export_artifacts
for each row execute function review_workspace.reject_audit_mutation();

grant select, insert on review_workspace.azure_export_artifacts to review_workspace_app;
