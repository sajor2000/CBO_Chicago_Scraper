# Migrations

Apply with `npm run apply:review-migrations` (requires `REVIEW_DATABASE_URL`).

| File | In apply script | Notes |
| --- | --- | --- |
| `001_review_workspace.sql` | yes | Core review schema |
| `002_categories.sql` | yes | Category taxonomy |
| `003_neon_review_persistence.sql` | yes | Persistence / grants |
| `004_baseline_imports.sql` | yes | Baseline import receipts |
| `005_azure_exports.sql` | yes | Azure export staging |
| `006_expanded_categories.sql` | yes | Expanded categories |
| `007_live_verification.sql` | no | Mirror refresh / resource link tables for live verification; apply explicitly when ready |
| `008_reviewer_cbo_eligibility.sql` | no | Additive reviewer-decision label; apply with `npm run apply:reviewer-cbo-eligibility-migration` |
| `009_recurring_verification.sql` | no | Frozen 60-day cycle state; apply with `npm run apply:recurring-verification-migration` after the migration-ledger preflight passes |
| `010_cbo_mirror_copy.sql` | no | PostGIS and fenced refresh-request groundwork; the same controlled runner applies it after `009` |
| `011_pause_preserves_checkpoint_lease.sql` | no | Lets a paused run finish its already leased checkpoint without starting another; the controlled runner applies it after `010` |
| `012_cbo_eligibility_review.sql` | no | Adds a human-gated CBO-eligibility review candidate kind; the controlled runner applies it after `011` |
| `013_eligibility_decision_state.sql` | no | Records eligibility decisions without making them exportable directory approvals; the controlled runner applies it after `012` |
| `014_migration_ledger_runtime_access.sql` | no | Grants the application role read-only schema-ledger access; the controlled runner applies it after `013` |

Do not reuse sequence numbers. Older plans that mention `004_live_verification.sql` now mean `007_live_verification.sql`.

## Production releases

Production releases run through `.github/workflows/production.yml`; direct Git production deployments are disabled in `vercel.json`. The workflow builds a staged Vercel production artifact, applies and verifies the controlled Neon migrations, and only then promotes and smoke-tests that exact artifact. Configure `VERCEL_TOKEN` and `REVIEW_DATABASE_URL` as GitHub `production` environment secrets. Preview deployments remain automatic and never migrate production.

For an emergency local release, export the production `REVIEW_DATABASE_URL` and run `npm run release:production` from a clean, up-to-date `main` checkout. Vercel sensitive variables are intentionally not used as a migration credential source.
