---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
title: "feat: automate conservative CBO audit cohorts"
date: 2026-08-13
plan_depth: standard
origin: docs/plans/2026-08-13-feat-live-verification-pilot.md
---

# feat: automate conservative CBO audit cohorts

## Goal

Audit every seeded CBO/WIC resource in a durable monthly cohort. Each scheduled invocation claims exactly one checkpoint, gathers evidence using fixed server-side providers, records a GPT-5.6 advisory under a versioned world prompt, and sends only deterministic deltas or conflicts to human review. It never changes a production record, closes a resource, or publishes automatically.

## Product Contract

- **R1.** The cohort includes every resource with a seeded public snapshot exactly once per monthly run; an existing non-terminal cohort resumes rather than creating an overlap.
- **R2.** Vercel Cron invokes one secured `/api/cron` checkpoint. The lease remains the overlap guard; no browser or Clerk session is required.
- **R3.** GPT-5.6 receives only the baseline plus bounded collected evidence and returns strict JSON: CBO eligibility, operational assessment, evidence quality, citations, and rationale.
- **R4.** Model output is advisory only. It cannot request a tool, expand crawl scope, declare a record closed, merge identities, create categories, approve, or publish.
- **R5.** Every checkpoint ends with an auditable state. Retrieval failure or ambiguity is `unable_to_verify` or `conflict`, never a status change.

## Decisions

1. Keep the existing Azure GPT-5.6 client as the model adapter. The durable Neon run registry is the agent orchestrator; adding a general-purpose multi-agent runtime does not improve this bounded workflow.
2. Use fixed tools only: official URL through Firecrawl, Google Places, Tavily discovery, and explicitly configured trusted directories. Model text cannot cause additional tool calls.
3. Schedule one checkpoint every 5 minutes in production. At this rate, a 1,969-record cohort completes in roughly 7 days before retries; Hobby plans must leave the schedule disabled because daily Cron cannot meet the cohort target.

## Implementation Units

### U1. GPT audit contract

**Files:** `src/lib/ai/azure-openai.ts`, `src/lib/providers/hosted-evidence.ts`, `src/lib/verification/index.ts`, `tests/azure-openai.test.ts`, `tests/verification-workflow.test.ts`.

**Approach:** Version and embed the conservative world prompt; validate the JSON contract before passing the advisory to verification. Preserve advisory provenance but keep deterministic verification authoritative.

**Tests:** malformed classification fails closed; closure-suspected output cannot produce a closed field; prompt states the no-tools/no-publish constraints.

### U2. All-resource monthly cohort

**Files:** `src/lib/runs/index.ts`, `tests/run-lifecycle.test.ts`.

**Approach:** Reuse the existing durable run/checkpoint schema. Create or resume one scheduled run per UTC month over all seeded resources, allowing scheduled runs above the manual 100-record ceiling.

**Tests:** same month is idempotent, a queued/running run is resumed, and manual limits remain unchanged.

### U3. Cron worker

**Files:** `src/lib/runs/execute-checkpoint.ts`, `src/app/api/runs/[runId]/execute/route.ts`, `src/app/api/cron/route.ts`, `vercel.json`, `tests/execute-batch.test.ts`, `tests/run-lifecycle.test.ts`.

**Approach:** Move the one-checkpoint worker behind a server-only function used by both operator and Cron routes. Bound provider work below the Vercel duration; authorize Cron with `CRON_SECRET`; return a compact auditable outcome.

**Tests:** invalid Cron is rejected, a valid invocation performs exactly one checkpoint, and a worker failure releases its lease.

## Verification

- `npm run check`
- `npm run build`
- Vercel Preview: `/api/cron` rejects unauthenticated requests; no real provider calls or data mutation in preview smoke tests.

## Deferred

- Production publishing and automatic closure/deactivation.
- Unrestricted browser/search tools or multi-agent handoffs.
- Schedule activation on a Vercel Hobby project.
