# Operations

## Current boundary

The app has durable Neon review/run repositories and a one-checkpoint hosted worker for manual runs or the guarded production Cron. It calls Firecrawl, Google Places, Tavily, optional approved IRS/directory endpoints, and Azure OpenAI only when the matching Vercel Production secrets are present. It never writes ChicagoHealthMap production. CI runs only `npm ci` and `npm run check`.

## Roles

- **Run operator:** starts, cancels, or resumes a bounded dry run; must be signed in with Clerk.
- **Reviewer:** evaluates evidence and records an approve, decline, or defer decision; must be signed in with Clerk.
- **Publisher operator (future):** operates the separate production publisher after a production-copy test and approved reversible canary. This role must not be combined with routine review access.
- **Service owner:** owns provider budgets, deployment access, backups, incidents, and post-incident review.

## Evidence and source controls

Follow [source-policy.md](../policy/source-policy.md): official sites are primary, Google corroborates but cannot close a resource alone, trusted directories can propose leads, and AI advice is advisory only. Retain the immutable citation metadata, normalized observations, reviewer decision, and run report needed to explain a change. Store raw captures in controlled object storage with least-privilege access; redact credentials, cookies, authorization headers, and unnecessary personal contact information before retention. Set and periodically review a retention period with the service owner and data-governance owner.

## Cost and monitoring

Before enabling hosted providers, set provider-specific spend caps and request limits in the deployment environment. Start with an explicitly bounded manual selection and run `POST /api/runs/{runId}/execute` once per checkpoint; its lease prevents duplicate completion. Record each run's selected resources, duration, provider limit/failure events, estimated cost, candidate decisions, blocked-source rate, and export result in the non-production review database. Alert the service owner on budget exhaustion, repeated provider failures, or a source-policy violation. During the first 10-checkpoint canary, stop on any provider failure, more than 20% blocked/timeout/rate-limited checkpoints, unexpected candidate volume, or a reviewer finding that advisory rationale lacks captured-evidence support.

Calibration begins only after explicit reviewer CBO-eligibility labels are available. A label is accepted only on a terminal approval or rejection and is independent of the proposed field decision. Treat unlabeled, legacy, deferred, edited, and GPT `insufficient_evidence` records as non-comparable; do not infer a label from field approval or rejection. Review the first small labeled sample qualitatively before adopting any numerical quality threshold.

## Incident, rollback, and emergency stop

1. Stop scheduled/manual work and preserve the run, evidence IDs, and audit trail.
2. For a future publisher, set `PUBLISHER_ENABLED=false`, remove its production database credential from the deployment, and revoke the deployment's production role. The current code has no publisher to disable.
3. Investigate and correct the review workspace first. Never edit production records manually to bypass the receipt/audit path.
4. A future production rollback must use the publication receipt and refuse a rollback when a later publication touched the same field.
5. The service owner confirms backup/restore readiness for the review database and production directory, then documents the incident and recovery decision.

## Azure handoff gate

Azure export remains disabled until the directory owner has supplied and approved the target table, primary key, optimistic version field, allowlisted column map, backup owner, and a schema-matched non-production database. The included SQL builder is not an export endpoint; enabling one requires the contract, an approved candidate-to-target mapping, test-copy rehearsal, and a downloadable artifact receipt. A generated SQL file is reviewed and applied manually by an Azure operator. Any target-version mismatch must roll back the transaction; the Vercel app has no Azure production credential.
