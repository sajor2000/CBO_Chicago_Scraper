-- U0 groundwork: a refresh request is the immutable handoff between the
-- source-only refresh job and any future verification cycle. Exact copied-table
-- DDL is intentionally deferred until its live source profile is approved.

create extension if not exists postgis;

create table if not exists review_workspace.refresh_requests (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  status text not null check (status in ('pending', 'claimed', 'reconciled', 'failed', 'abandoned')),
  manifest_id uuid unique references review_workspace.refresh_manifests(id),
  claim_token uuid,
  claim_expires_at timestamptz,
  requested_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  check ((claim_token is null) = (claim_expires_at is null))
);

create trigger refresh_requests_append_only
before delete on review_workspace.refresh_requests
for each row execute function review_workspace.reject_audit_mutation();

grant select, insert, update (status, manifest_id, claim_token, claim_expires_at, claimed_at, completed_at)
  on review_workspace.refresh_requests to review_workspace_app;
