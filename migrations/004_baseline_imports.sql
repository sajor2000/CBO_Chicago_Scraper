-- Terminal receipts for read-only imports from the authoritative CBO mirror.
create table if not exists review_workspace.baseline_import_receipts (
  id uuid primary key default gen_random_uuid(),
  source_name text not null,
  source_table text not null,
  outcome text not null check (outcome in ('succeeded', 'failed')),
  source_row_count integer not null check (source_row_count >= 0),
  inserted_resource_count integer not null check (inserted_resource_count >= 0),
  inserted_snapshot_count integer not null check (inserted_snapshot_count >= 0),
  unchanged_count integer not null check (unchanged_count >= 0),
  skipped_count integer not null check (skipped_count >= 0),
  failed_count integer not null check (failed_count >= 0),
  error_code text,
  recorded_at timestamptz not null default now()
);

drop trigger if exists baseline_import_receipts_append_only on review_workspace.baseline_import_receipts;
create trigger baseline_import_receipts_append_only
before update or delete on review_workspace.baseline_import_receipts
for each row execute function review_workspace.reject_audit_mutation();

grant select, insert on review_workspace.baseline_import_receipts to review_workspace_app;
