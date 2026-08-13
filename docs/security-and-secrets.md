# Security and secrets

Keep Firecrawl, Google, search, AI, Neon, Entra, cron, and production-publisher credentials outside Git. Use the hosting platform's encrypted environment variables; production credentials exist only in the future publisher deployment, never in review or preview deployments.

Use separate least-privilege roles for the review database and future production publisher. Reviewers and run operators receive only their respective allowlist roles. Rotate a suspected secret immediately, revoke the old credential, inspect deployment and provider logs, and record the incident without copying the secret into tickets or chat.

Raw evidence may include page content and contact information. Retain only evidence needed to support a review decision, restrict access, redact tokens/cookies/authorization headers, and delete it under the retention policy in [operations.md](operations.md).

The current fixture-only implementation has no production-write module or production credential path. Do not treat it as authorization to connect a production database.
