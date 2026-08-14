# Operator runbook

Clerk controls access through a signed-in account whose subject has an active `operator` grant in the review workspace. Start a dry run through `POST /api/runs` with a unique idempotency key, bounded source selection, and budget. Repeating the same key returns the same run. Use `PATCH /api/runs` to cancel or resume; completion advances one durable checkpoint at a time. Cancelling releases an unfinished lease; a stale worker cannot complete it.

When the canary acceptance gate is met, Vercel production invokes `GET /api/cron` every five minutes. It requires `CRON_SECRET`: Vercel sends it as a bearer token and the endpoint rejects missing or invalid authorization. Each invocation starts or resumes the current UTC-month cohort and processes one durably leased record, so invocations cannot overlap work. This schedule needs a Vercel Pro or Enterprise project; Vercel does not activate cron for preview deployments. It performs real public-provider requests and writes review candidates only—never a production directory publish or automatic closure. The review app uses the dedicated Neon review workspace only; its startup connection must find `review_workspace.workspace_sentinel` with `workspace_kind = dedicated_review_workspace` before hosted use.

## Production canary and recovery

Before relying on the scheduled cohort, confirm the `/review` readiness checks are green, then run a **one-resource manual canary**. An operator watches its run status and a reviewer checks the resulting candidate or unable-to-verify outcome. Stop scheduled work, cancel the active run, and investigate before continuing when any of these occur: a provider failure, blocked/timeout/rate-limit result for more than 20% of the first 10 checkpoints, an unexpected candidate volume, or an advisory citation/rationale that the reviewer cannot support with captured evidence.

Resume only after the owner documents the cause and validates the fix with another one-resource canary. A cancelled or failed checkpoint is recoverable through the operator controls; never delete an audit record or edit a directory record to clear the queue. Escalate provider outages, workspace/readiness failures, or any suspected policy violation to the service owner.

## Reviewer CBO-eligibility calibration

Before deploying the reviewer eligibility UI, run `npm run apply:reviewer-cbo-eligibility-migration` against the dedicated review workspace. The migration is additive and safe for the prior app; deploy the new app only after it succeeds. Reviewers may optionally label a terminal approval or rejection as CBO eligible or not eligible; the label is independent of the selected field action. Do not attach a label to a deferred or edited proposal. Deferred, edited, historical, unassessed, and GPT `insufficient_evidence` records are excluded from agreement counts. Calibration is a prospective quality signal, never an approval, closure, or publishing rule.

## Seed the current CBO directory

Before selecting an import source, run `npm run profile:cbo-source` in the authorized source environment with `SOURCE_DATABASE_URL`, `CBO_SOURCE_TABLE`, and `CBO_SOURCE_ID_COLUMN`. It emits only the schema-qualified relation, column metadata, and aggregate ID/count checks; it never prints a connection string or CBO row. It accepts a base relation or the reviewed `public.cbo_public_directory_v1` view, but does not create or modify either one. Stop if the ID has nulls or duplicates, or if the profile does not match the intended public-directory relation.

Before the first seed, run `npm run apply:baseline-import-migration` from the same controlled environment. It is additive and must complete before `npm run import:cbo-baseline`; the importer fails before row writes unless the receipt table, append-only trigger, and INSERT grant exist.

Run `npm run import:cbo-baseline` only from an authorized operator environment. It reads `SOURCE_DATABASE_URL` and `CBO_SOURCE_PROFILE=chicagohealthmap-public-v1`; all relation, ID, and field choices are fixed in the reviewed profile. The runtime source role must be `cbo_import_reader`, read-only, and granted SELECT only on the reviewed public-directory view; do not grant it access to base tables containing notes, contacts, or other non-directory data.

The command validates the complete source result before changing the review workspace, then records only the profile-approved JSON payload, a deterministic hash, and aggregate counts. It never prints a connection string, raw source row, or source error. A successful import writes a terminal `baseline_import_receipts` record. A row-write failure records completed, unchanged, failed, and unattempted (`skipped`) counts where available; re-run after fixing the cause. Do not run it until the normalized view, profile, and source-role grant have been reviewed. The count equation is `source rows = inserted snapshots + unchanged + skipped + failed`; any failed/nonreconciling run is not eligible for web verification.

This seed establishes the existing CBO population. A later verification release will compare public web evidence to it and stage proposed open/closed, changed-data, or potential-new-resource reviews. Missing evidence, failed lookups, or import failures never remove a CBO and never publish to ChicagoHealthMap production.
