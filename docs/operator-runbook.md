# Operator runbook

Clerk controls access through a signed-in account whose subject has an active `operator` grant in the review workspace. Start a dry run through `POST /api/runs` with a unique idempotency key, bounded source selection, and budget. Repeating the same key returns the same run. Use `PATCH /api/runs` to cancel or resume; completion advances one durable checkpoint at a time. Cancelling releases an unfinished lease; a stale worker cannot complete it.

Cron is intentionally disabled (`vercel.json` has no schedules). After a manual non-production acceptance run, enable one `/api/cron` schedule and set `CRON_SECRET`; the endpoint rejects missing or invalid bearer secrets. The review app uses the dedicated Neon review workspace only; its startup connection must find `review_workspace.workspace_sentinel` with `workspace_kind = dedicated_review_workspace` before hosted use.

## Seed the current CBO directory

Before the first seed, run `npm run apply:baseline-import-migration` from the same controlled environment. It is additive and must complete before `npm run import:cbo-baseline`; the importer fails before row writes unless the receipt table, append-only trigger, and INSERT grant exist.

Run `npm run import:cbo-baseline` only from an authorized operator environment. It reads `SOURCE_DATABASE_URL`, `CBO_SOURCE_NAME`, `CBO_SOURCE_TABLE` (for example, `public.resources`), `CBO_SOURCE_ID_COLUMN`, and the comma-separated public-directory field allowlist in `CBO_SOURCE_FIELDS`. The source role must be read-only and granted SELECT only on the reviewed public-directory relation; do not grant access to tables containing notes, contacts, or other non-directory data.

The command validates the complete source result before changing the review workspace, then records only the allowlisted JSON payload, a deterministic hash, and aggregate counts. It never prints a connection string, raw source row, or source error. A successful import writes a terminal `baseline_import_receipts` record. A row-write failure records completed, unchanged, failed, and unattempted (`skipped`) counts where available; re-run after fixing the cause. Do not run it until the source table and public-field allowlist have been reviewed.

This seed establishes the existing CBO population. A later verification release will compare public web evidence to it and stage proposed open/closed, changed-data, or potential-new-resource reviews. Missing evidence, failed lookups, or import failures never remove a CBO and never publish to ChicagoHealthMap production.
