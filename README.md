# ChicagoHealthMap CBO Verifier

A review-first internal application for keeping ChicagoHealthMap community-based organization (CBO) and WIC resources current. It starts from production-compatible copies of the `community_resource_locations` and `wic_locations` tables, gathers public evidence about a resource, proposes only supported field-level changes, and lets a human reviewer decide what is eligible for a later Azure handoff.

This is deliberately **not** an autonomous publisher. No scraper, Google result, AI score, timeout, or missing URL can automatically close, delete, merge, or publish a CBO.

## What counts as a CBO resource

For this directory, a CBO resource is a **currently operating organization or service location that gives people direct access to health-related or health-enabling support**. It must satisfy all of the following before it can be proposed for review:

- serves people in the defined Chicagoland geography;
- provides a direct resource, referral, or care/service access point—not only information, advocacy, fundraising, or worship;
- has a credible public identity and current contact/location evidence; and
- fits at least one approved resource area: food access, clinic/FQHC or primary care, shelter/housing, mental health, substance-use support, WIC, benefits navigation, transportation, domestic-violence/crisis support, or immigrant/refugee support.

Public agencies, nonprofit organizations, and faith-affiliated programs may qualify when the specific program provides a direct eligible resource. A for-profit provider, worship-only site, advocacy-only organization, duplicate listing, or an organization with no credible evidence of a direct local service does not qualify by default. Ambiguous cases are staged as `needs_review`; the agent never invents eligibility.

### Geographic scope

The default service-location boundary is the seven-county Chicagoland/CMAP region: **Cook, DuPage, Kane, Kendall, Lake, McHenry, and Will Counties, Illinois**. A location outside that area is out of scope unless a reviewer explicitly documents that it delivers a substantial, direct service to residents within the seven-county region. The verifier records its location/service evidence but does not automatically add an out-of-scope lead.

## What the app does

1. Keeps the copied CBO/WIC tables in their source-compatible shape for future refreshes and Azure handoff.
2. Stores evidence, run state, candidate revisions, human decisions, and exports separately under `review_workspace` in Neon.
3. Lets an authorized operator start a small, durable manual verification run.
4. Collects official-site evidence, Google Places corroboration, search/directory context, and bounded Azure OpenAI advisory scoring.
5. Stages only reviewable deltas. Provider failures and conflicting signals remain evidence states, not public-directory changes.

## Operator and reviewer experience

The app needs a polished, simple interface for a small ChicagoHealthMap team—not an engineering console. It must let an operator manually start a bounded agentic crawling run, follow its progress and failure states, and hand reviewers a clear queue of evidence-backed field diffs. Reviewers should be able to understand the resource, sources, confidence, and proposed change on one screen before approving, rejecting, or deferring individual fields.

After the manual canary is accepted, the same durable workflow runs through the secured Vercel Cron endpoint. The current production schedule invokes one checkpoint every five minutes for the monthly cohort; it prevents overlapping work, obeys provider budgets, and never bypasses human review.

## Tech stack

| Layer | Choice | Responsibility |
| --- | --- | --- |
| Web app | Next.js 16 + React 19 + TypeScript | Reviewer queue, operator controls, server routes |
| Hosting | Vercel | Preview/production deployment, manual trigger, and guarded five-minute Cron entry point |
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
- Cron is production-only and secured by `CRON_SECRET`; previews do not run it. Start relying on it only after the documented manual canary passes.

## Repository map

```text
src/app/                 Clerk-protected review UI and API routes
src/lib/providers/       Firecrawl, Google Places, Tavily, IRS, directory adapters
src/lib/verification/    Deterministic evidence checks and checkpoint workflow
src/lib/repositories/    Neon review/audit persistence
src/lib/ai/              Azure OpenAI advisory scorer
migrations/              Ordered Neon review-workspace migrations (001–006 applied via npm script; 007 pending)
scripts/                 Source profiling and baseline import commands
sql/source/              Read-only source view definitions for the Neon mirror
tests/                   Node contract and workflow tests
docs/                    See docs/README.md — ops, policy, data, and delivery plans
PRODUCT.md / DESIGN.md   Impeccable product and visual context (repo root)
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
6. Run the one-resource manual canary, then the documented 10-checkpoint canary. Stop on the runbook thresholds before relying on the guarded production Cron schedule.
7. Build/test the manual Azure patch handoff only after the Azure schema/key/version contract and a non-production target are available.

## Cursor handoff

Start with these files, in order:

1. [docs/plans/2026-08-13-feat-live-verification-pilot.md](docs/plans/2026-08-13-feat-live-verification-pilot.md) — current manual-pilot scope and safety rules.
2. [docs/ops/operator-runbook.md](docs/ops/operator-runbook.md) and [docs/policy/source-policy.md](docs/policy/source-policy.md) — operational boundaries.
3. [src/lib/verification/run-checkpoint.ts](src/lib/verification/run-checkpoint.ts) — one-checkpoint verification lifecycle.
4. [src/lib/providers/hosted-evidence.ts](src/lib/providers/hosted-evidence.ts) — provider orchestration.
5. [src/lib/repositories/review.ts](src/lib/repositories/review.ts) and [src/lib/runs/index.ts](src/lib/runs/index.ts) — durable Neon state.
6. [src/app/review/page.tsx](src/app/review/page.tsx) and [src/app/api/runs](src/app/api/runs) — reviewer/operator surfaces.

Before changing behavior, run `npm run check`. Preserve the review-first boundary and use the existing tests as the contract; add a focused test for any new provider, state transition, or persistence behavior.

## Further documentation

Index: [docs/README.md](docs/README.md)

- [Operator runbook](docs/ops/operator-runbook.md)
- [Operations](docs/ops/operations.md)
- [Security and secrets](docs/ops/security-and-secrets.md)
- [Data dictionary](docs/data/data-dictionary.md)
- [Reviewer guide](docs/policy/reviewer-guide.md)
- [Source policy](docs/policy/source-policy.md)
