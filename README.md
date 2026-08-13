# Chicago CBO resource verification

Reviewer-first workspace for checking Chicago-area community resources against captured evidence. Clerk provides the small team’s sign-in; Neon holds only the review/audit workspace; a one-checkpoint hosted worker stages candidates for people to review. No production publisher exists.

## Local check

```sh
npm ci
npm run check
```

Copy `.env.example` to `.env` only for local development. Never add credentials to the repository.

## Deployment sequence

1. Merge this branch to `main`, create a dedicated Neon review database, and run `npm run apply:review-migrations` from an authorized environment.
2. Apply the reviewed mirror view and grant `cbo_import_reader` access to it only; configure its connection string and run `npm run import:cbo-baseline`.
3. Confirm the count-only baseline receipt reconciles before granting Clerk reviewer/operator roles or adding provider secrets to Vercel Production.
4. Use `POST /api/runs/{runId}/execute` to process one bounded, lease-fenced manual checkpoint at a time. Cron remains disabled until the pilot is accepted.

## Operating boundary

- Reviewers can assess evidence-backed candidates; only approved field-level changes may later be published.
- Run operators can start, cancel, resume, and execute bounded hosted checkpoints.
- Production publishing is deferred. `PRODUCTION_DATABASE_URL` and publisher credentials belong only to a separately deployed publisher environment.

See [operator guidance](docs/operations.md), [secret handling](docs/security-and-secrets.md), and the [source policy](docs/source-policy.md).
