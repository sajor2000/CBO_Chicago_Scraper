# Chicago CBO resource verification

Reviewer-first workspace for checking Chicago-area community resources against captured evidence. Clerk provides the small team’s sign-in; provider adapters currently make no network requests, the run registry is in memory, and no production publisher exists.

## Local check

```sh
npm ci
npm run check
```

Copy `.env.example` to `.env` only for local development. Never add credentials to the repository.

## Operating boundary

- Reviewers can assess evidence-backed candidates; only approved field-level changes may later be published.
- Run operators can start, cancel, and resume bounded dry runs.
- Production publishing is deferred. `PRODUCTION_DATABASE_URL` and publisher credentials belong only to a separately deployed publisher environment.

See [operator guidance](docs/operations.md), [secret handling](docs/security-and-secrets.md), and the [source policy](docs/source-policy.md).
