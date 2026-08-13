# ChicagoHealthMap CBO Verifier

A review-first internal application for keeping ChicagoHealthMap community-based organization (CBO) and WIC resources current. It starts from production-compatible copies of the `community_resource_locations` and `wic_locations` tables, gathers public evidence about a resource, proposes only supported field-level changes, and lets a human reviewer decide what is eligible for a later Azure handoff.

This is deliberately **not** an autonomous publisher. No scraper, Google result, AI score, timeout, or missing URL can automatically close, delete, merge, or publish a CBO.

## What the app does

1. Keeps the copied CBO/WIC tables in their source-compatible shape for future refreshes and Azure handoff.
2. Stores evidence, run state, candidate revisions, human decisions, and exports separately under `review_workspace` in Neon.
3. Lets an authorized operator start a small, durable manual verification run.
4. Collects official-site evidence, Google Places corroboration, search/directory context, and bounded Azure OpenAI advisory scoring.
5. Stages only reviewable deltas. Provider failures and conflicting signals remain evidence states, not public-directory changes.

## Tech stack

| Layer | Choice | Responsibility |
| --- | --- | --- |
| Web app | Next.js 16 + React 19 + TypeScript | Reviewer queue, operator controls, server routes |
| Hosting | Vercel | Preview/production deployment and future cron entry point |
| Authentication | Clerk | Small-team sign-in; server-side reviewer/operator authorization |
| Review database | Neon PostgreSQL + PostGIS | CBO/WIC copies and the `review_workspace` audit workflow |
| Evidence storage | Vercel Blob | Private raw evidence artifacts when configured |
| Official-site retrieval | Firecrawl v2 | Public website scrape; bounded Interact fallback only when configured |
| Place corroboration | Google Places API (New) | Name, address, phone, URL, and business-status evidence |
| Discovery | Tavily, with trusted-directory/IRS seams | Discovery and corroboration only; never auto-insert or auto-close |
| Advisory AI | Azure OpenAI (`gpt-5.6-sol` deployment) | Structured, bounded category/rationale suggestion only |
| Tests | Node test runner + TypeScript | Contract, workflow, provider, migration, and authorization coverage |

## Safety model

- The original Neon mirror is read-only to this app. Azure production is never connected to the reviewer app.
- `public.community_resource_locations` and `public.wic_locations` remain production-compatible copies; app-specific records belong in `review_workspace.*`.
- Evidence/audit tables are append-only. Corrections create superseding records.
- Official sites are primary operational evidence; Google Places corroborates. Search is discovery-only.
- Azure OpenAI is advisory. It cannot create a category, merge organizations, set closure, or write a directory field.
- Blocked, rate-limited, timed-out, absent, or contradictory sources are `unable_to_verify`/conflict outcomes.
- Cron is intentionally disabled in [vercel.json](vercel.json) until a manual pilot is accepted.

## Repository map

```text
src/app/                 Clerk-protected review UI and API routes
src/lib/providers/       Firecrawl, Google Places, Tavily, IRS, directory adapters
src/lib/verification/    Deterministic evidence checks and checkpoint workflow
src/lib/repositories/    Neon review/audit persistence
src/lib/ai/              Azure OpenAI advisory scorer
migrations/              Ordered Neon review-workspace migrations
scripts/                 Source profiling and baseline import commands
tests/                   Node contract and workflow tests
docs/                    Runbooks, data dictionary, policy, and delivery plans
```

## Local setup

```sh
npm ci
cp .env.example .env.local
npm run check
npm run dev
```

Do not commit `.env.local` or any credential. Add secrets only through Vercel/Neon/Azure secret stores.

### Required server-side environment variables

See [.env.example](.env.example) for the complete list. The hosted evidence worker requires Clerk, `REVIEW_DATABASE_URL`, Firecrawl, Google Places, Tavily, and Azure OpenAI configuration. Optional IRS, trusted-directory, Firecrawl Interact, Vercel Blob, source-import, and Azure-export variables remain disabled until their prerequisites are satisfied.

## Validation

```sh
npm run check   # TypeScript + all Node tests
npm run build   # Production Next.js build
```

## Operating sequence

1. Apply the reviewed migrations to the **dedicated** Neon workspace only.
2. Profile/import the current CBO/WIC source data and verify the count-only baseline receipt reconciles.
3. Grant Clerk `reviewer` and `operator` roles in `review_workspace.reviewer_access`.
4. Configure provider secrets in Vercel and run a one-record manual pilot from `/review`.
5. Review the evidence and candidate UX before widening the batch.
6. Keep cron disabled until the manual pilot, reviewer workflow, and cost guardrails are accepted.
7. Build/test the manual Azure patch handoff only after the Azure schema/key/version contract and a non-production target are available.

## Cursor handoff

Start with these files, in order:

1. [docs/plans/2026-08-13-feat-live-verification-pilot.md](docs/plans/2026-08-13-feat-live-verification-pilot.md) — current manual-pilot scope and safety rules.
2. [docs/operator-runbook.md](docs/operator-runbook.md) and [docs/source-policy.md](docs/source-policy.md) — operational boundaries.
3. [src/lib/verification/run-checkpoint.ts](src/lib/verification/run-checkpoint.ts) — one-checkpoint verification lifecycle.
4. [src/lib/providers/hosted-evidence.ts](src/lib/providers/hosted-evidence.ts) — provider orchestration.
5. [src/lib/repositories/review.ts](src/lib/repositories/review.ts) and [src/lib/runs/index.ts](src/lib/runs/index.ts) — durable Neon state.
6. [src/app/review/page.tsx](src/app/review/page.tsx) and [src/app/api/runs](src/app/api/runs) — reviewer/operator surfaces.

Before changing behavior, run `npm run check`. Preserve the review-first boundary and use the existing tests as the contract; add a focused test for any new provider, state transition, or persistence behavior.

## Further documentation

- [Operator runbook](docs/operator-runbook.md)
- [Operations](docs/operations.md)
- [Security and secrets](docs/security-and-secrets.md)
- [Data dictionary](docs/data-dictionary.md)
- [Reviewer guide](docs/reviewer-guide.md)
- [Source policy](docs/source-policy.md)
