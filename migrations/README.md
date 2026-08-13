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

Do not reuse sequence numbers. Older plans that mention `004_live_verification.sql` now mean `007_live_verification.sql`.
