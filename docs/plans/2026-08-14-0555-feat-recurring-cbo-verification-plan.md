---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
product_contract_source: ce-plan-bootstrap
title: "feat: Add recurring CBO verification and discovery"
date: 2026-08-14
plan_depth: deep
deepened: 2026-08-14
---

# feat: Add recurring CBO verification and discovery

## Goal Capsule

Operate one review-first program with two visible lanes: adjudicate the current copied CBO/WIC directory in batches, then discover credible new Chicagoland resources in a separate queue. An operator can start a one-record, selected-record, full-cycle, or discovery-only run. Every 60 days, the system refreshes its source baseline, queues records due for review, runs bounded discovery, and gives staff a durable report for every checked site—not only sites that need a change.

The app never automatically closes, removes, adds, merges, or publishes a directory record. The source mirror remains read-only; the new Neon workspace is the durable working copy and audit system; Azure is a manual, contract-gated handoff.

**Execution profile:** Vercel hosts the Clerk-protected review app and the bounded worker. A GitHub Actions dispatcher calls the protected worker every 15 minutes on the public repository, while Neon—not cron syntax—decides whether a 60-day cycle is due. This preserves the free Vercel tier without pretending a daily Hobby cron can drain a provider-backed directory review.

---

## Product Contract

### Summary

The first cycle adjudicates the resources ChicagoHealthMap already lists. Staff work through known resources in manageable batches, comparing the listed name, address, phone, URL, organization type/category, and operational status with attributable evidence. Each later cycle rechecks those resources against a frozen CBO/WIC refresh and separately discovers possible new resources. Every completed resource produces an auditable case report; only supported changes and credible unmatched leads require a reviewer decision.

Approved field subsets become a manually downloadable, Azure-ready delta only after the Azure owner supplies and rehearses the authoritative table/key/version contract. The app never receives an Azure production credential and never overwrites or directly applies the directory.

### Problem Frame

The current directory is a valuable baseline, not proof that every listing is current or eligible. Nearly 2,000 CBO locations and 30 WIC locations need periodic attention, while a one-off browser loop cannot safely coordinate provider usage, retries, evidence provenance, or staff review. A literal 60-day cron also cannot represent missed runs or recover from an interrupted provider call.

### Requirements

- R1. Support four user-facing run modes: manual verification of one or selected existing resources, manual full-cycle verification of all due resources, manual discovery-only, and scheduled cycle verification plus discovery. The scheduled composite cycle may use separate internal verification and discovery run types under one operator-visible cycle.
- R2. A full or scheduled cycle first binds immutable per-resource cycle membership to a successful, promoted CBO/WIC refresh manifest, freezes the selected snapshots, and records its 60-day due-window anchor. A refresh failure creates no verification checkpoints.
- R3. Use one shared leased-checkpoint worker for manual and scheduled work. Launches, dispatcher deliveries, retries, pause/resume, and cancellation must be idempotent and may not duplicate provider work or candidates; cancellation is terminal.
- R4. Treat outcome states separately: `verified_no_change`, `candidate_staged`, `conflict`, `unable_to_verify`, provider failure, duplicate lead, out-of-scope lead, non-credible lead, and budget exhaustion. Every terminal existing-resource outcome creates a durable case report; only actionable changes and credible unmatched leads enter the reviewer queue.
- R5. Re-verify existing resources with official-site Firecrawl evidence, identity-matched Google Places corroboration, and advisory-only Azure OpenAI scoring. Deterministic comparison may propose supported corrections to name, address, phone, URL, and governed category/type; operational status remains conservative. Failures, absent websites, stale pages, and a Google-only closure may not change public status.
- R6. Discovery is a separate, bounded lead pipeline. Approved category-and-geography searches may propose a `potential_new_resource` only after deterministic deduplication, the versioned seven-county Chicagoland/CBO eligibility policy in `README.md`, and public evidence collection. Discovery never inserts into copied public CBO/WIC tables.
- R7. The system must calculate a rolling 60-day due date from fenced completed verification outcomes, not from a brittle calendar expression. A single active full cycle may exist at once; manual spot checks may coexist only when they do not claim the same pending resource. `unable_to_verify`, provider failure, cancellation, and budget-paused work do not advance a due date.
- R8. The operator UI must show run scope, frozen baseline, budget, progress, failure counts, and safe start/pause/cancel/resume actions. It must let an operator start a bounded selected batch or a full/due cycle that drains in budgeted batches. The reviewer UI must filter by cycle and distinguish actionable candidates from operational outcomes.
- R9. Every provider observation, AI advisory, lead decision, frozen snapshot, run outcome, reviewer decision, and schedule/manual trigger is traceable and append-only. New evidence or an edit supersedes prior approval.
- R10. Scheduled execution stays disabled until a manual pilot produces a reconciled refresh, bounded cost report, usable reviewer decisions, and an explicit persisted activation decision. A service-owner-controlled global emergency stop is checked before cycle creation and every checkpoint claim; a run operator may pause or cancel only its individual run. Manual runs remain available while scheduling is disabled, subject to operator authorization, a reconciled frozen refresh where required, and their explicit budget.
- R11. A reviewer-approved subset of an existing resource's fields is exportable only through a manually downloaded PostgreSQL delta artifact. Existing-row updates require a versioned, allowlisted Azure target contract, exact source identity/version, immutable evidence and decision references, an idempotency receipt, and a schema-matched non-production rehearsal. An approved new-resource proposal remains export-disabled until the Azure owner supplies a separately reviewed insert contract with target table, required columns/defaults, and deduplication evidence. No export workflow may mutate Azure or overwrite the copied CBO/WIC tables.

### Actors

- A1. **Run and export operator:** starts, confirms, pauses, cancels, or resumes a manual run; sees its operational report; and, after reviewer approval, creates and downloads a manual export artifact.
- A2. **Scheduler identity:** invokes only the protected dispatcher; it cannot approve, edit, or export anything.
- A3. **Reviewer:** examines evidence and makes field-level approve, reject, defer, or edit decisions with a reason.
- A4. **Source owner:** owns the read-only mirror and the completed refresh contract.
- A5. **Service owner:** alone may change scheduler activation or emergency-stop state; every transition is server-authorized and audited.

### Key Flows

- F1. **Existing-resource adjudication:** refresh manifest → freeze due resource snapshots → operator selects a manageable batch or confirms a full/due cycle → leased evidence checkpoints → durable report for every site → actionable review candidates or visible non-actionable outcomes → human field decision.
- F2. **New-resource discovery:** approved search query → durable lead → deduplicate and screen → collect corroborating evidence → `potential_new_resource` candidate or non-actionable disposition → human decision.
- F3. **Manual review:** operator chooses one, selected, full-cycle, or discovery-only scope → confirms budget → durable run progresses one checkpoint at a time → staff inspect evidence and decide only proposed changes.
- F4. **Azure handoff:** approved immutable field subset or new-resource decision → contract-gated delta artifact and manifest → authorized operator downloads → Azure owner validates and applies it manually to a schema-matched target.

### Acceptance Examples

- AE1. A staff member launches one existing pantry; Firecrawl and an identity-matched Google Place corroborate its new address; the queue shows both sources and only that address can be approved.
- AE2. A scheduled dispatcher is delivered twice while a full cycle is active; it resumes the same durable run and does not repeat a checkpoint or create a second cycle.
- AE3. The mirror refresh fails validation; the attempt has a failed manifest and the system stages no web-verification work.
- AE4. Discovery finds a credible in-region clinic absent from the directory; it becomes a reviewable potential resource. A same-name/same-address result links to the existing resource instead.
- AE5. Firecrawl times out or Google says closed without corroboration; the run records `unable_to_verify` or conflict, and no closure, removal, or new-resource proposal is created.
- AE6. A 1,999-record cycle reaches its provider-cost cap; it pauses with remaining work visible and requires a human-approved continuation rather than silently exceeding the cap.
- AE7. A verified but unchanged clinic appears in the completed batch report with the baseline fields, sources checked, evidence excerpts, AI advisory, and a clear “keep—no supported change” result; it does not create a reviewer candidate.
- AE8. A reviewer approves only a pantry's corrected phone and category while deferring its address; the downloadable Azure patch contains only the approved phone/category fields, target version guard, evidence/decision IDs, and a receipt.

### Success Criteria

- A complete scheduled or manual full cycle has a reconciled refresh, frozen scope, countable terminal outcomes, a report for every checked existing resource, and a review link for every actionable result.
- Staff can explain any candidate from its source snapshot, evidence, advisory score, and decision history.
- The due-resource queue finishes within 60 days at the configured provider budget, or visibly reports why it did not.
- The pilot acceptance receipt records the team-set review-age cap, candidate disposition rate, and either a successful non-production Azure update-artifact rehearsal or its explicit external-contract blocker.

### Scope Boundaries

**In scope:** recurring verification, potential-resource discovery, manual operator controls, field-level adjudication of name/address/phone/URL/category/status, durable per-resource case reports, free dispatcher integration, a contract-gated manual Azure delta artifact, evidence safety fixes, durable state, reviewer filters, and operational runbooks.

**Deferred for later:** direct Azure publishing, automatic directory changes, 211 Illinois ingestion before a data-use agreement/API, login/CAPTCHA bypass, free-form browser agents, and natural-language operator controls.

**Outside this product's identity:** treating AI, a search result, an unreachable website, or an omitted source row as proof of closure or non-eligibility.

---

## Planning Contract

### Key Technical Decisions

1. **Use a due-date dispatcher, not a literal 60-day cron.** Neon owns `next_due_at`, active-cycle locks, and frozen run scope; a frequent dispatcher merely wakes it. This recovers after late/missed schedules while preserving manual starts. Governs R1, R2, R3, R7, R10.
2. **Use GitHub Actions as the free frequent dispatcher.** A scheduled, replay-protected request invokes the same bounded Vercel worker every 15 minutes; its actual work remains a Neon-leased checkpoint. This avoids paying for a Vercel plan solely to obtain more frequent cron execution. Governs R3, R7, R10.
3. **Keep discovery separate from existing-resource verification.** A durable lead is deduplicated and screened before it can become a potential-resource candidate, preserving the first cycle's focus on adjudicating the existing directory and reserving its provider budget. Governs R4, R6, R9.
4. **Make public-source evidence deterministic and AI advisory-only.** Google corroboration must identity-match; Azure output cannot supply values, categories, closures, merges, or actions. This avoids treating model or untrusted-page content as evidence. Governs R5, R6, R9.
5. **Freeze cycle inputs before web work starts.** A refresh failure or later refresh cannot alter a queued run's baseline: checkpoints reference a `(cycle, resource, snapshot)` membership row rather than the latest snapshot. Governs R2, R3, R9.
6. **Make a report the primary output of an existing-resource check.** A no-change, conflict, or unable-to-verify result is a completed, inspectable case—not an invisible counter or an empty candidate. This keeps the first-cycle adjudication work reviewable without flooding the candidate queue. Governs R4, R8, R9.
7. **Export approved deltas, never a wholesale table copy.** The copied CBO/WIC tables stay production-compatible refresh baselines; an artifact is generated from immutable reviewed subsets against a supplied Azure schema/key/version contract, then manually applied by the Azure owner. Governs R11.

### High-Level Technical Design

```mermaid
flowchart LR
  M[Manual operator] --> G[Run gateway]
  S[GitHub Actions dispatcher] --> G
  G --> N[(Neon cycle and run state)]
  N --> R[Refresh and frozen snapshot gate]
  R --> V[Existing-resource checkpoints]
  R --> D[Discovery lead checkpoints]
  V --> E[Public evidence and AI advisory]
  D --> E
  E --> P[Per-resource case reports]
  E --> Q[Actionable review queue]
  E --> O[Operational outcomes]
  Q --> H
  H --> X[Manual Azure delta artifact]
```

### Scheduler and Cycle Lifecycle

```mermaid
stateDiagram-v2
  [*] --> waiting
  waiting --> refreshing: due or manual full cycle
  refreshing --> queued: complete reconciled manifest
  refreshing --> failed: failed manifest
  queued --> running: worker claims checkpoint
  running --> queued: checkpoint complete and work remains
  running --> paused: budget exhausted or operator pause
  queued --> cancelled: operator cancel
  running --> cancelled: operator cancel after current checkpoint
  paused --> cancelled: operator cancel
  queued --> complete: all checkpoints terminal
  paused --> queued: operator-approved resume
  failed --> waiting: next eligible attempt
  complete --> waiting: next_due_at set
```

### Assumptions

- The GitHub repository stays public or otherwise has sufficient GitHub Actions minutes for a small scheduled dispatcher.
- Source refresh work uses the existing read-only mirror connection in a separately authorized environment; Vercel never receives that source credential.
- The configured provider budget can process the frozen cycle before its 60-day due window. A budget that cannot do so is treated as an operational failure, not silently relaxed.

### Sources & Research

- Existing durable-run, evidence, and safety patterns: `src/lib/runs/index.ts`, `src/lib/verification/run-checkpoint.ts`, `src/lib/providers/hosted-evidence.ts`, `src/lib/repositories/review.ts`, `tests/run-lifecycle.test.ts`, and `tests/verification-workflow.test.ts`.
- Existing source, human-review, and deployment boundaries: `docs/operator-runbook.md`, `docs/source-policy.md`, `docs/reviewer-guide.md`, `docs/operations.md`, and `docs/security-and-secrets.md`.
- [Vercel Cron Jobs](https://vercel.com/docs/cron-jobs) and [Vercel Cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing): schedules are UTC; Hobby allows only one daily invocation and does not guarantee timing precision.
- [Vercel cron management](https://vercel.com/docs/cron-jobs/manage-cron-jobs): no automatic retry; function duration limits apply, so the worker must be checkpointed.
- [Firecrawl v2](https://docs.firecrawl.dev/api-reference/v2-introduction), [Map](https://docs.firecrawl.dev/api-reference/endpoint/map), and [error handling](https://docs.firecrawl.dev/api-reference/errors): bounded retrieval, error-class retry policy, and `Retry-After` handling.
- [Google Text Search (New)](https://developers.google.com/maps/documentation/places/web-service/text-search) and [Place Details (New)](https://developers.google.com/maps/documentation/places/web-service/place-details): field-mask costs, business status, and moved-place fields must be treated as corroborating evidence rather than autonomous status decisions.
- [Google Maps Platform Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms) and [Place IDs](https://developers.google.com/maps/documentation/places/web-service/place-id): retain the Google Place ID as the durable identity reference; apply the current Google content caching, attribution, and refresh rules to any Google-derived display value rather than treating raw Places content as an indefinite audit payload.

---

## Implementation Units

### U0. Establish the production-compatible CBO/WIC copy and migration gate

**Goal:** Make the new Neon workspace a safe, production-compatible CBO/WIC working copy before recurring adjudication, case reports, or Azure delta export depend on it.

**Requirements:** R2, R9, R11.

**Dependencies:** A source-owner-approved profile of the two read-only mirror relations and a dedicated new Neon workspace.

**Files:** `migrations/006_cbo_mirror_workspace.sql`, `scripts/apply-review-migrations.ts`, `src/lib/imports/cbo-baseline.ts`, `src/lib/imports/cbo-source-profile.ts`, `sql/source/cbo_public_directory_v1.sql`, `tests/cbo-source-profile.test.ts`, `tests/baseline-import.test.ts`, `tests/schema-contract.test.ts`, `docs/operator-runbook.md`.

**Approach:**

1. Capture and review non-executable source profiles for `community_resource_locations` and `wic_locations`, then commit constrained additive DDL that preserves each relation's approved public columns, stable key, PostGIS geometry type/SRID, and source-compatible names in the new workspace's `public` schema. Do not copy source triggers, functions, grants, policies, owner settings, or arbitrary expressions.
2. Extend the separately authorized refresh/import command to read only the two approved source relations, stage their immutable row snapshots and source receipts under one refresh manifest, validate count/key/geometry/hash reconciliation, and promote the manifest atomically. The source mirror remains read-only; a missing source row is a discrepancy, never a deletion.
3. Before any migration or refresh write, require the migration owner to reconcile the duplicate `004_*` history in the target ledger. A clean new workspace uses one documented ordered migration sequence; an existing workspace requires an approved ledger/checksum disposition before proceeding. An unresolved or mismatched ledger blocks the command before any copied-row mutation.
4. Bind the workspace sentinel to the dedicated new Neon project/database and use least-privilege runtime roles: a short-lived migration principal for DDL, a source-only refresh environment outside Vercel, and an app role that cannot mutate copied `public` tables.

**Test scenarios:**

- The approved profile preserves CBO and WIC stable IDs and `geometry(Point,4326)` while rejecting an unreviewed source field, relation, expression, or extension.
- A reconciled two-relation refresh produces source-compatible public rows and an eligible manifest; a mismatch/partial failure leaves no eligible manifest.
- Clean and existing workspace migration preflight rejects ambiguous `004_*` ledger state before a public-table or snapshot write.
- The Vercel app role cannot mutate the `public` copies, and the source refresh role has no review/export authority.

**Verification:** Disposable-Neon migration and refresh integration proves the public-table schema contract, PostGIS preflight, receipt reconciliation, role boundaries, and target sentinel before U1 begins.

---

### U1. Establish cycle, frozen-snapshot, and terminal-outcome state

**Goal:** Make a 60-day full cycle a durable, no-overlap object whose checkpoints always reference the exact CBO/WIC snapshot selected after a completed refresh.

**Requirements:** R1, R2, R3, R4, R7, R9.

**Dependencies:** U0.

**Files:** `migrations/007_recurring_verification.sql`, `scripts/apply-review-migrations.ts`, `src/lib/imports/cbo-baseline.ts`, `src/lib/domain/review-workspace.ts`, `src/lib/runs/index.ts`, `src/lib/repositories/review.ts`, `tests/run-lifecycle.test.ts`, `tests/schema-contract.test.ts`.

**Approach:**

1. Add additive cycle, immutable membership, run-mode, fenced outcome, due-date, budget-state, and per-resource case-report projections; preserve existing append-only evidence and decision tables. Each membership has one `(cycle, resource, snapshot)` tuple and an FK proving the snapshot belongs to its resource; checkpoints and candidate staging reference that membership, never a latest-snapshot query.
2. Make the separately authorized refresh command own the source handoff: it creates the CBO/WIC source receipts under one manifest, copies the immutable public-row payloads, and asks Neon to promote that manifest in one destination transaction only after both sources reconcile. Failed or abandoned manifests remain audit-only; source omissions are discrepancies, never deletions or closure evidence.
3. Enforce one active full cycle with a database partial-unique constraint and transactionally create/reuse it. Define `paused` as resumable and `cancelled` as terminal; manual spot checks do not reset routine due dates.
4. Persist exactly one immutable case report for every terminal existing-resource checkpoint before its lease-token-fenced completion. A report links the frozen snapshot, normalized current fields, every provider observation or failure, deterministic reasons, Azure advisory/version, outcome, optional candidate revision, and completion time. Advance `next_due_at` once in that completion transaction for `verified_no_change`, `candidate_staged`, or `conflict`; `unable_to_verify`, provider failure, budget pause, cancellation, discovery dispositions, and later-superseded evidence remain due. Reviewer decisions never retroactively advance a checkpoint due date.
5. Make migration `007` additive, retain old run readability, and backfill only safe due state from the latest reconciled receipt. U0's migration-ledger preflight is a hard prerequisite; this unit never repairs history as part of the feature. Rollback disables eligibility/dispatch or selects a prior promoted manifest; it never drops audit history.

**Patterns to follow:** Existing migration order and append-only triggers in `migrations/003_neon_review_persistence.sql` and `migrations/004_live_verification.sql`; fenced checkpoint ownership in `src/lib/runs/index.ts`.

**Test scenarios:**

- A completed refresh freezes all due CBO/WIC snapshot IDs before checkpoints are queued.
- A no-change, conflict, and unable-to-verify checkpoint each retain one report with its source snapshot and evidence/failure details, while only the actionable result has a candidate link.
- A later refresh proves queued evidence and candidates retain the original membership snapshot.
- A failed or non-reconciled refresh records failure and creates no verification checkpoint.
- An injected partial CBO/WIC refresh failure leaves no eligible manifest or cycle.
- A refresh command records both source receipts and the promoted manifest before a full-cycle launch can proceed.
- A second scheduled or manual full-cycle launch returns the active cycle without duplicating work.
- A manual spot check leaves the resource's cycle due date unchanged; a terminal full-cycle check advances it.
- An expired/stale lease cannot complete an outcome or advance a due date; budget pause leaves work resumable while cancellation is terminal.
- Outcome-matrix tests prove exactly which terminal existing-resource states advance the due date and that every other state remains due.

**Verification:** Database constraints reject overlapping active cycles and invalid snapshot links; lifecycle tests prove 60-day eligibility, frozen inputs, resume, exactly-one terminal case report, and terminal reports.

### U2. Make evidence collection safe for recurring execution

**Goal:** Harden the existing worker so public evidence remains independently attributable, bounded, and safe to retry before it runs across the entire directory.

**Requirements:** R3, R4, R5, R9.

**Dependencies:** U1.

**Files:** `src/lib/verification/run-checkpoint.ts`, `src/lib/verification/index.ts`, `src/lib/providers/hosted-evidence.ts`, `src/lib/retrieval/firecrawl.ts`, `src/lib/retrieval/google-places.ts`, `src/lib/ai/azure-openai.ts`, `src/lib/repositories/review.ts`, `tests/run-checkpoint.test.ts`, `tests/provider-clients.test.ts`, `tests/verification-workflow.test.ts`.

**Approach:**

1. Keep Azure advice isolated from captured provider values; deterministic evidence extraction and identity matching decide whether a provider observation can corroborate name, address, phone, URL, or status. A model may propose only a controlled taxonomy ID/confidence and short rationale; it cannot supply fields, categories, closures, or actions.
2. Canonicalize every public URL; reject localhost, private/link-local/reserved IP literals and DNS-resolved private targets, then revalidate every redirect/final host. Use Firecrawl only for public unauthenticated fetches and never forward internal credentials to a target. Discovery URLs cannot become scrape targets until identity vetting accepts an official domain. Restrict Interact to an exact vetted domain, one page, fixed timeout, no form/file/navigation actions, and unconditional session cleanup.
3. Redact and size-limit excerpts before both persistence and Azure. For Google Places, permanently retain only the Place ID, source/time, request/version metadata, allowed derived decision metadata, and integrity reference; display/cache Google-derived content only under the current vendor retention and attribution policy, with a scheduled purge/refresh job. Send Azure bounded, per-observation-delimited evidence and accept only a schema-constrained advisory score, approved taxonomy ID, short rationale, model/deployment, and prompt-policy version—never model-supplied field values, URLs, or actions.
4. Persist observations and the case report even when no candidate is warranted. Complete a leased checkpoint with a durable operational failure if persistence/staging fails after a claim; do not leave it hanging for lease expiry.
5. Make observation and candidate idempotency stable across a retry and serialize staging by run/resource before evidence-specific candidate checks. A candidate approval or edit must compare the immutable current revision/evidence-set version; refreshed or contradictory evidence supersedes and blocks an older pending approval.

**Execution note:** Start with characterization tests for the current unsafe boundaries, then change the worker.

**Patterns to follow:** Capture contracts in `src/lib/retrieval/types.ts`, current evidence redaction in `src/lib/evidence/redaction.ts`, and lease completion in `src/lib/runs/index.ts`.

**Test scenarios:**

- An Azure-suggested address absent from primary evidence cannot create a candidate.
- A Google result for a similarly named organization becomes conflict/no-result rather than corroboration.
- A hung provider times out within the checkpoint budget and completes as `unable_to_verify`.
- Google-derived values expire/purge under the documented policy while the case retains its Place ID and derived decision provenance; required attribution remains visible wherever Google content is displayed.
- A repository failure after a lease claim records a terminal failure without duplicating provider calls on recovery.
- A retry with identical evidence produces one observation/candidate lineage.
- URL parser bypasses, private DNS/redirect destinations, and injected discovery links fail closed without outbound credential delivery.
- Redacted credential-like text or prompt injection never reaches Azure, durable evidence, a category mapping, or a candidate action.
- A reviewer cannot approve an older revision after refreshed evidence supersedes it.

**Verification:** Worker tests prove every claimed checkpoint reaches a fenced terminal state and no AI/provider failure can create an unreviewed status change.

### U3. Add manual run modes and protected cycle dispatch

**Goal:** Let operators explicitly start the right workload while making scheduled and manual full cycles use the same run gateway and provider budget controls.

**Requirements:** R1, R3, R7, R8, R10.

**Dependencies:** U1, U2.

**Files:** `src/app/api/runs/route.ts`, `src/app/api/runs/[runId]/execute/route.ts`, `src/app/api/cron/route.ts`, `src/lib/runs/cron.ts`, `src/lib/runs/index.ts`, `tests/review-authorization.test.ts`, `tests/run-lifecycle.test.ts`, `tests/run-checkpoint.test.ts`.

**Approach:**

1. Add explicit `manual_verify`, `manual_full_cycle`, `manual_discover`, `scheduled_verify`, and `scheduled_discover` modes with validated scope, source-refresh version, and capped, separately reserved existing/discovery provider budgets. Keep one/selected verification as an operator-selected batch, while full/due cycles page their frozen membership through bounded batches rather than passing thousands of IDs through a request.
2. Keep the current one-checkpoint worker as the execution primitive; the browser and scheduler only launch, resume, or request a bounded drain. The run gateway must refuse an existing resource already claimed by another active run/cycle rather than relying on a disabled browser button.
3. Make the scheduler identity server-authorized rather than Clerk-impersonated. The cron endpoint derives scope and budgets from persisted configuration; it accepts no resource IDs, modes, or overrides. Require the persisted activation gate and emergency-stop check before cycle creation and every claim.
4. Persist a timestamped scheduler-delivery nonce and per-cycle claim quota so repeated, expired, or concurrent deliveries cannot amplify work or spend. Reject duplicate/unknown selection IDs, duplicate active cycles, cross-scope resource conflicts, and budget-free full runs; return the existing active run where applicable. A run completion receipt summarizes frozen scope, terminal case-report counts, candidate links, remaining work, provider usage, and failures.
5. Require same-origin/CSRF validation on every Clerk-cookie-authenticated mutation before any side effect; scheduler requests use their separate signed-delivery validation.

**Patterns to follow:** Clerk operator gate in `src/lib/db.ts` and `src/app/api/runs/route.ts`; existing `CRON_SECRET` handling in `src/app/api/cron/route.ts`.

**Test scenarios:**

- A reviewer cannot launch or execute a run; an operator can launch a one-record or bounded selected run.
- A full-cycle confirmation creates one frozen due set, while a duplicate request returns that run.
- Duplicate scheduler deliveries continue the existing cycle without a second refresh or provider request.
- A manual spot check overlapping an actively leased cycle resource is rejected or linked to the existing work.
- An operator starts a 25-site selected batch, sees one durable case report per resource as it finishes, and continues the next batch without resubmitting an already-complete site.
- Pause stops future claims and resume continues the same frozen scope; cancellation is terminal.
- A disabled pilot gate, invalid scheduler secret, or missing provider budget prevents scheduled execution.
- Replayed/expired scheduler delivery and activation revoked between claims cause no additional provider call.
- Cross-origin requests cannot launch, execute, pause, resume, or cancel a run.

**Verification:** Route and lifecycle tests prove mode authorization, idempotency, no-overlap rules, and bounded scheduler invocation.

### U4. Build the durable new-resource discovery lane

**Goal:** Turn bounded, approved searches into explainable potential-resource reviews without contaminating existing-resource verification or the copied source tables.

**Requirements:** R4, R6, R9.

**Dependencies:** U1, U2, U5. U3/U5 deliver the known-directory batch and case-review release first; this unit adds discovery only after staff can pilot the core adjudication workflow.

**Files:** `migrations/008_discovery_lane.sql`, `src/lib/domain/review-workspace.ts`, `src/lib/providers/hosted-evidence.ts`, `src/lib/verification/run-checkpoint.ts`, `src/lib/verification/index.ts`, `src/lib/repositories/review.ts`, `src/lib/taxonomy/categories.ts`, `tests/hosted-evidence.test.ts`, `tests/verification-workflow.test.ts`, `tests/run-checkpoint.test.ts`.

**Approach:**

1. Persist versioned discovery queries, lead fingerprints, source observations, policy version, and dispositions separately from copied resource identities. A discovery checkpoint has exactly one target—either a frozen existing membership or a lead—and one active lineage per normalized fingerprint/source-scope version.
2. Before the first discovery run, persist a reviewed query/source matrix covering the selected taxonomy categories and seven counties, with per-query caps and a coverage/yield report. Use the existing Tavily/Google discovery paths only to find leads or official URLs, then collect public evidence through the ordinary provider policy. Add another search provider only after a measured discovery-quality gap and an explicit provider decision; a low/zero credible-lead yield is a visible service-owner decision, not a healthy silent completion.
3. Deduplicate each lead against copied CBO/WIC records, Google place identity, prior open leads, and prior reviewer dispositions before advisory scoring.
4. Stage only credible, unmatched, in-scope leads as a `new_resource` candidate with UI label `potential_new_resource`; link it to its immutable lead/evidence lineage rather than `candidate_revision_snapshot_links`, which remains for existing copied resources. Retain rejected, duplicate, out-of-scope, and insufficient-evidence results in the run report instead of the reviewer candidate list. Discovery has a separate provider budget and cannot starve due existing-resource adjudication.

**Patterns to follow:** `potential_new_resource` semantics in `src/lib/verification/index.ts`, source-policy boundaries in `docs/source-policy.md`, and governed category lookup in `src/lib/taxonomy/categories.ts`.

**Test scenarios:**

- A trusted lead matching current name/address/phone links to the existing record and cannot create a new resource candidate.
- A credible unmatched food pantry or clinic within the defined counties stages exactly one potential-resource candidate with sources and advisory rationale.
- A for-profit clinic, worship-only site, advocacy-only nonprofit, out-of-region lead, or prompt-injection text is recorded as non-actionable.
- Repeated discovery query runs deduplicate previously adjudicated leads unless material evidence changes.
- Concurrent discovery retries and a later exact match to a seeded record retain one lead lineage and create no copied-table write.
- A search result alone cannot create a category, closure, copied table row, or reviewer-approved resource.
- The discovery report identifies each approved query's category/county/source coverage, deduplication count, credible-lead yield, and a zero-yield review decision when applicable.

**Verification:** Discovery fixtures prove the end-to-end lead state machine and reviewer queue receives only actionable unmatched leads.

### U5. Deliver an operator console and reviewer audit workflow

**Goal:** Give operators a usable batch console and give reviewers an evidence-led adjudication workspace without hiding uncertainty or conflating AI advice with evidence.

**Requirements:** R4, R8, R9, R10.

**Dependencies:** U1, U3. U4 adds the Discovery surface after the known-directory batch release; U8 adds the Exports surface after its target-contract gate.

**Files:** `src/app/review/page.tsx`, `src/app/review/runs/page.tsx`, `src/app/review/cases/page.tsx`, `src/app/review/discovery/page.tsx`, `src/app/review/exports/page.tsx`, `src/app/review/run-controls.tsx`, `src/app/review/[candidateId]/page.tsx`, `src/app/review/review-actions.tsx`, `src/app/review/review-provenance.tsx`, `src/app/styles.css`, `tests/review-ui-workflow.test.ts`, `tests/review-action-ui.test.ts`, `docs/reviewer-guide.md`.

**Approach:**

1. Establish a role-aware information architecture: `/review` is the actionable reviewer queue; `/review/runs` is the operator landing surface and run composer; and `/review/cases` lists every completed known-resource case. U4 adds `/review/discovery` for potential new-resource work and U8 adds `/review/exports` for the run-and-export operator once enabled. Navigation begins with the two work lanes—Known directory and Discovery—and progressively reveals one/selected/due/full controls only after a lane is chosen.
2. Present four explicit operator choices with scope/count, expected provider budget, frozen-refresh status, and a second confirmation for full cycle/discovery runs. For known resources, offer one-site, selected-batch, due-batch, and full-cycle choices; a full cycle is a durable sequence of batches, never one opaque browser request.
3. Add a run history/progress surface with current state, remaining checkpoints, pause/cancel/resume controls, provider failures, non-actionable outcome counts, and direct links to every case report and candidate created by the run. Legacy reports that lack retained evidence remain immutable but are visibly labeled legacy and can be hidden from the default operational view; they are never deleted from audit history.
4. Make each case report a decision aid: show listed baseline name, address, phone, URL, category/type, and status beside proposed values; cite sources, captured excerpts, timestamps, provider failures, deterministic reasoning, and bounded AI advice. A clear “keep—no supported change” or “unable to verify” result explains why it does not need a reviewer approval.
5. Define the operator/reviewer interaction states and allowed recovery: loading; empty; blocked by missing/non-reconciled refresh; running; active elsewhere; paused; budget-paused; provider/checkpoint failed; cancelled; complete; unauthorized/expired session; and mixed-success/stale batch decision. Each state gives the user its scope, retained audit outcome, and only safe next action—retry/continue where permitted, or contact the run/service owner where not.
6. Add reviewer filters for cycle, batch, candidate type, proposed field, conflict, and potential new resource. Show `unable_to_verify` and provider failures only in the operator run report. Render source excerpts and AI rationales as escaped plain text, render only validated HTTP(S) links, and never render source/AI HTML or Markdown.
7. Present a compact candidate provenance timeline: cycle/run, frozen source snapshot and captured values, evidence source/time, AI advisory version, current/superseded revision status, and reviewer decision actor/time/reason. Support a batch-review view that submits one field-level compare-and-swap decision per candidate and reports individual stale conflicts rather than blindly applying a bulk action.
8. Use the supplied Conscience tokens with responsive layouts that preserve the field comparison at narrow widths, semantic table/list alternatives, visible keyboard focus, focus restoration after mutations, screen-reader announcements for run progress and batch outcomes, touch targets at least 44px, and WCAG AA contrast. Preserve distinct reviewer/operator permissions and existing field-level approve/reject/defer/edit rules.

**Patterns to follow:** Current Clerk page gate and reviewer components; supplied Conscience design tokens already applied in `src/app/styles.css`.

**Test scenarios:**

- A manual one-record and full-cycle start disclose scope/budget and cannot double-submit.
- An operator with an expired session, non-reconciled refresh, active conflicting run, exhausted budget, or checkpoint failure sees the correct state-specific recovery action and never a misleading success message.
- A completed selected batch exposes a case report for every resource, including unchanged and unable-to-verify results, plus a countable completion receipt.
- A queued full cycle shows progress and can be paused/resumed without changing its frozen count; a cancellation is terminal and preserves audit data.
- A reviewer can filter only potential new resources or conflicts and see evidence, AI advisory, and decision history.
- A reviewer can tell whether the visible revision is current or superseded and trace it to its frozen snapshot and run.
- A reviewer approves a name and phone correction, defers an uncertain category, and sees only the approved fields marked ready for future export.
- An operational-only `unable_to_verify` result appears in a run report but not as an empty candidate.
- A reviewer cannot access operator controls, and an operator cannot bypass a reviewer decision.
- Keyboard-only and narrow-screen checks cover opening a case, comparing fields, filtering a batch, receiving progress/decision announcements, and returning focus after an approve/defer/reject mutation.

**Verification:** UI workflow tests and an authenticated preview smoke prove manual launch, progress, evidence inspection, decision persistence, and safe rendering of malicious HTML/URL payloads.

### U6. Add the free periodic dispatcher and activation gate

**Goal:** Run the durable cycle automatically without exceeding Vercel Hobby cron limits or activating the schedule before the pilot is accepted.

**Requirements:** R3, R7, R9, R10.

**Dependencies:** U1, U3, U4, U5.

**Files:** `.github/workflows/cbo-dispatcher.yml`, `src/app/api/cron/route.ts`, `src/lib/runs/cron.ts`, `vercel.json`, `docs/operator-runbook.md`, `docs/operations.md`, `docs/security-and-secrets.md`, `tests/run-lifecycle.test.ts`, `tests/review-authorization.test.ts`.

**Approach:**

1. Keep `vercel.json` cron-free. GitHub Actions `schedule` and maintainer-controlled manual dispatch call the protected Vercel dispatcher every 15 minutes; the repository workflow uses pinned actions and `contents: read` only.
2. Make each call cheap and bounded: create/reuse a due cycle only once, then claim/complete a small persisted checkpoint quota. A short-lived timestamped delivery signature/nonce, a Neon lease, and per-cycle budget enforcement make late, missed, replayed, or duplicate deliveries harmless.
3. Leave the scheduled workflow present but operationally no-op until the persisted activation lifecycle moves from `disabled → manual-pilot-accepted → dispatcher-canary → recurring-enabled`. A distinct server-enforced service-owner allowlist, not the operator/reviewer role, authorizes activation and emergency-stop mutations; each transition records actor and before/after state.
4. Store scheduler credentials only in GitHub Actions and Vercel production secrets; previews receive neither source nor provider/scheduler credentials. The source mirror credential remains outside Vercel. Audit and telemetry store delivery nonce IDs/hashes and redacted error fields only—never authorization headers, signatures, tokens, or provider credentials.

**Patterns to follow:** Current disabled cron endpoint and runbook boundary; existing GitHub CI conventions in `.github/workflows/ci.yml`.

**Test scenarios:**

- The dispatcher before activation returns a no-work state and creates no cycle.
- A due cycle is created once even when the scheduled request repeats or arrives late.
- A normal no-op dispatcher does not consume provider budget; an active cycle advances only its configured checkpoint limit.
- A missing/incorrect scheduler secret cannot invoke the worker.
- Replayed/expired/concurrent valid deliveries cannot exceed the configured quota or provider spend.
- Scheduler requests cannot provide selection, run mode, budget, reviewer action, or export input.
- Reviewer and run-operator identities cannot activate scheduling or clear the emergency stop; audit/log records contain no secret-bearing request data.
- A 60-day due calculation resumes after downtime and never relies on a calendar-day expression.
- Workflow configuration contains no source, provider, Neon, Azure, or Clerk secret value.

**Verification:** A staging smoke uses a tiny provider budget and fixture data to run scheduler → durable queue → review candidate without any production-directory write; the runbook documents emergency disable and recovery.

### U7. Prove first-cycle readiness and operate the recurring program

**Goal:** Establish the first real review cycle as a controlled, measurable pilot before enabling the recurring dispatcher.

**Requirements:** R2, R4, R5, R6, R8, R9, R10.

**Dependencies:** U1-U6.

**Files:** `docs/operator-runbook.md`, `docs/reviewer-guide.md`, `docs/operations.md`, `docs/source-policy.md`, `README.md`.

**Approach:**

1. Before migration, record a recoverable Neon backup/branch point, dedicated workspace sentinel, current CBO/WIC counts, latest baseline-receipt aggregates, migration version, and absence of an active full cycle. Apply additive migrations only after ledger, grants, append-only guards, active-cycle, and activation-state checks pass.
2. Run a read-only source refresh and verify its receipt/count/geometry integrity before any web work. Pilot one record, then a balanced small sample of existing CBO/WIC categories, then a bounded discovery sample; review every candidate and non-actionable outcome with staff.
3. Run a dispatcher canary with tiny persisted budgets and exercise duplicate delivery plus pause/resume. Record provider requests/spend, run duration, candidate rate, reviewer disposition, blocked-source rate, dispatcher/auth errors, and remaining-work forecast against the 60-day window.
4. Persist the activation decision only when the team accepts evidence quality, costs, reviewer throughput, and recovery behavior. Its append-only receipt records baseline hash/count reconciliation, code/migration version, caps/actual usage, terminal counts, failure rate, review aging, duplicate/pause-resume proof, operator, and service-owner approval. Otherwise leave schedule disabled and continue manual runs.

**Patterns to follow:** `docs/operator-runbook.md`, `docs/reviewer-guide.md`, `docs/operations.md`, and `docs/source-policy.md`.

**Test expectation:** none -- this is an operational rollout/runbook unit; its proof is the recorded non-production and controlled production-like pilot evidence defined below.

**Verification:** The service owner can reconstruct the first cycle from refresh manifest through reviewer decisions, and a scheduled canary can be stopped without losing its audit trail.

---

### U8. Generate the manual Azure handoff artifact

**Goal:** Turn only immutable, reviewer-approved CBO/WIC field changes into a downloadable, auditable PostgreSQL delta that the Azure team can validate and apply manually, while retaining approved new-resource proposals until their separate insert contract is approved.

**Requirements:** R9, R11.

**Dependencies:** U1, U2, U4, U5. The authoritative Azure table/key/version contract and a schema-matched non-production target must be supplied before this unit is enabled.

**Files:** `migrations/010_azure_export_claims.sql`, `src/lib/export/azure-sql.ts`, `src/lib/export/azure-export.ts`, `src/lib/repositories/review.ts`, `src/app/api/exports/route.ts`, `src/app/review/exports/page.tsx`, `tests/azure-sql-export.test.ts`, `tests/review-authorization.test.ts`, `docs/operations.md`, `docs/operator-runbook.md`.

**Approach:**

1. Persist an immutable, versioned target contract for exactly the approved CBO/WIC update mappings, stable IDs, optimistic version columns, and allowed update fields. Reject unknown identifiers, expressions, or fields; do not infer mapping from the mirror or review schema. Keep an approved new-resource proposal in review state unless a separately reviewed Azure insert contract supplies target relation, required fields/defaults, deduplication proof, and rehearsal result.
2. In one workspace transaction, claim only current `approved_for_future_export` candidate revisions with an idempotency key, materialize immutable export membership, and prevent a superseded/previously claimed revision from entering another artifact. A reviewer edit or new evidence invalidates an unclaimed approval; an already generated artifact remains an audit record.
3. Generate a transaction-wrapped PostgreSQL patch and count-only manifest with safely encoded literals, per-row identity/version guards, field-level before/after values, evidence and decision IDs, source refresh/case-report references, artifact hash, and receipt. A target drift must abort the whole patch transaction rather than partially applying a batch.
4. Store the artifact privately with operator-only download authorization and append-only creation/download/failure receipts. The review app has no Azure production credential; the Azure operator downloads, validates, backs up, and manually applies the patch.
5. Keep export disabled unless the target contract, backup owner, non-production rehearsal result, and operator authorization are all present. An approved new-resource proposal is never an update to a guessed existing row and stays export-disabled until its separate insert contract is approved.

**Patterns to follow:** Existing pure SQL builder in `src/lib/export/azure-sql.ts`, disabled mapping boundary in `src/lib/export/azure-export.ts`, append-only artifact storage in `migrations/005_azure_exports.sql`, and candidate revision CAS in `src/lib/repositories/review.ts`.

**Test scenarios:**

- A reviewer-approved address and phone export only those approved fields; a deferred category and all unapproved fields are absent.
- Two concurrent export requests claim one immutable revision once and produce one artifact receipt.
- A revision superseded before claim cannot export; a stale target version makes the patch roll back every row in the artifact.
- Quotes, newlines, and adversarial identifiers in values/contracts cannot generate arbitrary SQL.
- An authenticated reviewer or scheduler identity cannot create or download an export; a revoked operator cannot download a prior artifact.
- A schema-matched non-production application updates each intended CBO/WIC row once, rejects a stale row atomically, and records the patch receipt; a new-resource proposal remains unavailable until its insert contract passes its own rehearsal.

**Verification:** SQL-generator, repository, authorization, and schema-matched rehearsal tests prove only approved immutable subsets become a manually downloadable artifact; no route or environment contains Azure production credentials.

---

## Verification Contract

- `npm run check` and `npm run build` pass for every implementation unit.
- Migration integration proves the new role cannot edit/delete audit rows, only one active full cycle exists, cycle membership references the correct resource snapshot, and a wrong Neon sentinel cannot run a cycle.
- Fixture coverage includes normal updates, no-change, provider timeout, Google-only closure, source conflict, source refresh failure, discovery duplicate, ineligible lead, credible new CBO, stale approval, duplicate dispatcher, budget exhaustion, pause/resume, cancellation, and prompt-injection content.
- A selected or due batch proves each frozen existing resource receives exactly one durable case report, while only supported changes are candidates; cases preserve an immutable optional link to the revision staged by that run even when a later run supersedes the current candidate.
- An authenticated Vercel preview smoke confirms the review UI, but only a dedicated staging workspace may run provider calls; it must not write source-mirror, public CBO/WIC, or Azure production data. Preview environments fail closed without scheduler/provider/source/export secrets.
- Before schedule activation, execute a canary with fixed tiny budgets, inspect the count-only report and evidence, and confirm a reviewer can dispose of the resulting candidates.
- Before enabling export, apply a generated artifact to an Azure-schema-matched non-production target and prove a stale version rolls the whole patch back; production application remains manual.

---

## System-Wide Impact and Risks

| Risk | Mitigation |
|---|---|
| Free Vercel cron cannot drain the directory | Use a GitHub Actions dispatcher and Neon-backed checkpoint queue; each request is bounded and idempotent. |
| Provider costs or rate limits prevent timely completion | Fixed provider budgets, one checkpoint at a time, `Retry-After` handling, pause-on-budget exhaustion, and an explicit remaining-work report. |
| Wrong Google match or AI hallucination changes a listing | Deterministic identity gate; provider evidence stays separate; AI has no decision/write authority. |
| A failed refresh mixes baselines | Full cycles require a complete manifest and frozen snapshot links. |
| Search discovers duplicates or ineligible organizations | Lead lane, deterministic dedupe, scope/eligibility screen, and human approval only. |
| Scheduler delivery is late, repeated, or fails | Due state, locks, idempotency, leases, and retryable durable checkpoints live in Neon rather than the scheduler. |
| Scheduler credential is replayed or emergency stop is needed | Signed nonce/quota checks plus a Neon activation/kill switch are checked before creation and every claim; rotate the secret on compromise. |
| Untrusted URL or page text triggers unsafe retrieval or model behavior | Canonical URL/DNS/redirect validation, vetted official-domain policy, fixed Interact limits, evidence redaction, and schema-only AI advice. |
| Reviewer queue becomes noisy | Operational outcomes remain in run reports; only evidence-backed field changes and credible unmatched leads become candidates. |
| A completed site has no explainable deliverable | Persist one immutable case report per terminal checkpoint, including baseline, source evidence/failures, advisory, outcome, and optional candidate link. |
| An export repeats or partially updates Azure | Claim immutable approved revisions once, use an idempotency receipt and transaction-wide target-version guards, and require manual Azure application. |

---

## Documentation and Operational Notes

- The user-facing term “open” means evidence supports a current operational record; it does not turn absence of evidence into “closed.”
- The first full cycle is the current source directory adjudication. New-resource discovery supplements it and never replaces it.
- The dispatcher is a trigger, not a source of truth. The Neon emergency stop halts new claims immediately; disabling the GitHub workflow or rotating its secret blocks future deliveries. Current durable runs preserve their audit trail and may be paused or cancelled by an operator.
- Reviewers continue to approve only fields or new-resource proposals. Export is a separately gated, manual delta process; it never modifies the production-compatible CBO/WIC copies or Azure directly.

---

## Definition of Done

- Manual one/selected/full-cycle/discovery-only runs and scheduled due-cycle runs share durable, idempotent state and evidence semantics.
- Every full cycle references a reconciled immutable source baseline; no later refresh changes its scope or snapshots.
- Existing-resource verification and discovery both produce clear terminal outcomes, while only actionable changes and credible new leads reach staff review.
- Every checked known resource has an immutable evidence-led case report, including no-change and unable-to-verify outcomes, and operators can work the known directory in bounded batches.
- No provider, AI, scheduler, or failed lookup can close, remove, merge, publish, or directly add a directory record.
- The 60-day due model, budget pause, cancellation, pause/resume, duplicate delivery recovery, and reviewer audit trail are covered by automated tests and a controlled pilot.
- The free dispatcher remains disabled until the team records pilot acceptance; its secrets are absent from previews and source control.
- After the Azure owner supplies and rehearses the update target contract, approved immutable field subsets can produce one operator-downloadable, idempotent delta artifact; approved new-resource proposals wait for their separate insert contract, and the review app never receives Azure production credentials.
- No abandoned experiments, unsafe credential paths, or duplicate queue implementations remain in the delivered change.
