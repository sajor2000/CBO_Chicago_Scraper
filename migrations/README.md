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

Do not reuse sequence numbers. Older plans that mention `004_live_verification.sql` now mean `007_live_verification.sql`.
