# Operator runbook

Clerk controls access through a signed-in account whose subject has an active `operator` grant in the review workspace. Start a dry run through `POST /api/runs` with a unique idempotency key, bounded source selection, and budget. Repeating the same key returns the same run. Use `PATCH /api/runs` to cancel or resume; completion advances one durable checkpoint at a time. Cancelling releases an unfinished lease; a stale worker cannot complete it.

Cron is intentionally disabled (`vercel.json` has no schedules). After a manual non-production acceptance run, enable one `/api/cron` schedule and set `CRON_SECRET`; the endpoint rejects missing or invalid bearer secrets. The review app uses the dedicated Neon review workspace only; its startup connection must find `review_workspace.workspace_sentinel` with `workspace_kind = dedicated_review_workspace` before hosted use.

## Seed the current CBO directory

Before selecting an import source, run `npm run profile:cbo-source` in the authorized source environment with `SOURCE_DATABASE_URL`, `CBO_SOURCE_TABLE`, and `CBO_SOURCE_ID_COLUMN`. It emits only the schema-qualified relation, column metadata, and aggregate ID/count checks; it never prints a connection string or CBO row. It accepts a base relation or the reviewed `public.cbo_public_directory_v1` view, but does not create or modify either one. Stop if the ID has nulls or duplicates, or if the profile does not match the intended public-directory relation.

Before the first seed, run `npm run apply:baseline-import-migration` from the same controlled environment. It is additive and must complete before `npm run import:cbo-baseline`; the importer fails before row writes unless the receipt table, append-only trigger, and INSERT grant exist.

Run `npm run import:cbo-baseline` only from an authorized operator environment. It reads `SOURCE_DATABASE_URL` and `CBO_SOURCE_PROFILE=chicagohealthmap-public-v1`; all relation, ID, and field choices are fixed in the reviewed profile. The runtime source role must be `cbo_import_reader`, read-only, and granted SELECT only on the reviewed public-directory view; do not grant it access to base tables containing notes, contacts, or other non-directory data.

The command validates the complete source result before changing the review workspace, then records only the profile-approved JSON payload, a deterministic hash, and aggregate counts. It never prints a connection string, raw source row, or source error. A successful import writes a terminal `baseline_import_receipts` record. A row-write failure records completed, unchanged, failed, and unattempted (`skipped`) counts where available; re-run after fixing the cause. Do not run it until the normalized view, profile, and source-role grant have been reviewed. The count equation is `source rows = inserted snapshots + unchanged + skipped + failed`; any failed/nonreconciling run is not eligible for web verification.

This seed establishes the existing CBO population. A later verification release will compare public web evidence to it and stage proposed open/closed, changed-data, or potential-new-resource reviews. Missing evidence, failed lookups, or import failures never remove a CBO and never publish to ChicagoHealthMap production.
