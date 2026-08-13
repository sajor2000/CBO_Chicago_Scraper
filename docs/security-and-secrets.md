# Security and secrets

Keep Clerk, Firecrawl, Google, search, AI, Neon, cron, and production-publisher credentials outside Git. Use the hosting platform's encrypted environment variables; production credentials exist only in the future publisher deployment, never in review or preview deployments.

Use Clerk Free for the small review team. Configure allowed sign-in methods and invite reviewers in the Clerk Dashboard. Clerk protects `/review` and `/api`; Vercel can remain on its free Hobby plan because the application, rather than Vercel Deployment Protection, owns authentication.

Use separate least-privilege roles for the review database and future production publisher. Reviewers and run operators receive only their respective allowlist roles. Rotate a suspected secret immediately, revoke the old credential, inspect deployment and provider logs, and record the incident without copying the secret into tickets or chat.

Azure OpenAI credentials are scoring-only Vercel secrets. `AZURE_EXPORT_MAPPING_JSON` describes an approved Azure directory mapping and contains no database credential. The reviewed app generates a downloadable patch; an Azure operator applies it manually. Do not add an Azure production connection string to Vercel, preview deployments, or this repository.

Raw evidence may include page content and contact information. Retain only evidence needed to support a review decision, restrict access, redact tokens/cookies/authorization headers, and delete it under the retention policy in [operations.md](operations.md).

The review app has no production-write module or production credential path. Do not treat it as authorization to connect a production database. Put provider/source/export secrets only in Vercel Production; Preview must receive none of them.
