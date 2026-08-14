---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
title: "feat: live CBO verification pilot"
date: 2026-08-13
plan_depth: standard
---

# feat: live CBO verification pilot

## Goal Capsule

Make the hosted CBO reviewer useful: an authorized operator can start a bounded manual run over the copied CBO/WIC records; the server gathers public evidence, stages only deterministic, evidence-backed field deltas, and the existing Clerk-protected queue presents those deltas for field-level human approval.

The dedicated Neon project is the writable CBO/WIC copy and review workspace. The original Neon mirror and Azure production remain read-only to this app. A provider failure, an absent website, or Google-only closure is recorded as an operational result, never an automatic status change.

## Product Contract

### Requirements

- **R1.** An operator can select a small number of copied CBO/WIC resources and start, resume, or cancel a durable bounded run from the hosted app.
- **R2.** Each claimed checkpoint loads its production-compatible copied row, captures an immutable baseline snapshot if none exists for the active mirror refresh, persists provider observations, and completes with a fenced lease token.
- **R3.** The worker uses Firecrawl v2 for an official public URL, Google Places New Text Search then Place Details for corroboration, and Azure OpenAI (`gpt-5.6-sol`) only for bounded advisory extraction/scoring. Exa is discovery-only when no official URL is known.
- **R4.** Only the existing deterministic verifier may propose a field delta. AI/provider content is untrusted evidence; it cannot request tools, create categories, close a resource, merge records, or write public tables.
- **R5.** Blocked, timeout, rate-limited, malformed, absent, and conflicting observations are saved in the run report but do not create empty review candidates. Google-only closure remains a conflict with no proposed status delta.
- **R6.** Candidate staging is atomic and idempotent per run/resource/evidence fingerprint, preserving before/proposed values, evidence URLs/excerpts, baseline snapshot link, and reviewer queue semantics.
- **R7.** Cron remains disabled by default. A later activation must use the same worker route, `CRON_SECRET`, durable run lock, and a persisted pilot-acceptance gate.

### Scope Boundaries

In scope: existing copied resources, a 1–100 record manual pilot, Firecrawl/Google/Azure evidence, durable observations and candidates, and a minimal operator panel.

Deferred: potential-new-resource discovery UI, Firecrawl Interact, IRS/local-directory enrichment, automated two-month scheduling, taxonomy changes, Azure patch export, and any direct production write.

### Acceptance Examples

- **AE1.** Firecrawl and Google corroborate an address change; exactly one staged candidate contains the old/new address and both evidence references.
- **AE2.** Firecrawl is blocked or Google rate-limited; the checkpoint completes with `unable_to_verify`, records the failure, and adds no candidate.
- **AE3.** Two invocations of the same worker run do not create duplicate observations, candidates, or checkpoint completion.
- **AE4.** An authenticated reviewer cannot start a run; an authenticated operator can launch a 10-record pilot and see progress/report counts.

## Planning Contract

### Key Technical Decisions

1. **Manual-first, review-first** (session-settled: user-directed — chosen over automatic recurring publication: the small team needs to validate output before automation). Governs R1, R5, R7.
2. **Dedicated Neon copy plus audit schema** (session-settled: user-directed — chosen over writing the existing mirror or Azure production: preserve source/prod boundaries). Governs R2, R6.
3. **Deterministic gate before Azure advisory AI** (session-settled: user-approved — chosen over model-controlled writes: web evidence can be wrong or adversarial). Governs R3, R4, R5.
4. **Server-only provider credentials** (session-settled: user-directed — chosen over browser calls: provider keys and source data must never reach review clients). Governs R1, R3.

### Implementation Units

### U1. Durable evidence and candidate staging

**Goal:** Add the smallest Neon repository methods needed to resolve a copied resource, record public-source observations, create/reuse its immutable mirror baseline, and atomically stage a candidate.

**Files:** `src/lib/repositories/review.ts`, `migrations/007_live_verification.sql`, `tests/live-verification.test.ts`.

**Approach:** Use one SQL CTE/transactional statement per staging operation with `pg_advisory_xact_lock(hashtext(run/resource key))`. Create baseline snapshots only from the completed mirror refresh and content-hash the redacted copied payload. Use a deterministic external candidate key based on run/resource/evidence hash. Do not update audit rows.

**Verification:** A fake SQL client proves an evidence-backed result creates one candidate and duplicate staging returns the same candidate; no candidate is staged for unavailable/conflict results.

### U2. Provider-backed checkpoint worker

**Goal:** Replace captured-only adapters with server-side Firecrawl, Google Places New, Azure OpenAI advisory, and Exa discovery calls, then drive a claimed run checkpoint to completion.

**Files:** `src/lib/retrieval/`, `src/lib/scoring/`, `src/lib/verification/run-checkpoint.ts`, `src/lib/runs/index.ts`, `tests/live-verification.test.ts`, `.env.example`.

**Approach:** Inject `fetch` for tests; cap excerpts and request fields; map failures to existing observation states. Google flow is Text Search then Details. Azure uses its configured Responses deployment with `max_completion_tokens` and no temperature override. Advisory JSON parse failures stay evidence-only. Always complete or record the checkpoint with its lease token.

**Verification:** Mock Firecrawl/Google/Azure responses to prove AE1; test a rate limit proves AE2; test a stale lease token cannot complete.

### U3. Operator controls and future cron seam

**Goal:** Add a small Clerk-authorized run form and run-status panel to the review page; make API launch optionally execute a capped number of checkpoints and provide one authenticated cron-compatible worker endpoint without enabling a cron schedule.

**Files:** `src/app/review/page.tsx`, `src/app/review/run-controls.tsx`, `src/app/api/runs/route.ts`, `src/app/api/runs/[runId]/execute/route.ts`, `src/app/api/cron/route.ts`, `vercel.json`, `tests/review-ui-workflow.test.ts`.

**Approach:** The browser never supplies provider credentials or raw SQL. Operator authorization remains server-side. Execute route processes at most the requested safe cap and is idempotent around checkpoint leases. Leave `vercel.json` crons empty and return an explicit disabled state from cron.

**Verification:** Route tests reject non-operators, validate 1–100 selection/budget, and prove cron authorization cannot enable a run. `npm run check` and `npm run build` pass.

## Verification Contract

- Run TypeScript and all Node tests after each behavior-bearing unit.
- Run a production build before delivery.
- Run a manual hosted pilot only after deployment, beginning with one selected CBO and reviewing the stored evidence; it must not write public CBO/WIC columns.
- Do not add provider secrets to Git or test output.

## Definition of Done

- A Clerk operator can trigger and observe a bounded run from `/review`.
- A live-compatible provider worker stages only deterministic, evidence-backed proposed values; all other outcomes remain audited run results.
- Existing review approval UI can display its candidates.
- Cron is not enabled.
- CI and production build pass, and the change is delivered in an open PR.
