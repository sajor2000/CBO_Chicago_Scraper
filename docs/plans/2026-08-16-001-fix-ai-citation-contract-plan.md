---
title: "fix: enforce AI citation provider contract"
type: fix
status: completed
date: 2026-08-16
---

# fix: enforce AI citation provider contract

## Overview

Make the selected `DeepSeek-V4-Flash` deployment usable by constraining its structured JSON citations to the providers actually captured for each resource. The application will continue to fail closed if a response is malformed or unsupported, and no AI result will update a directory record without human review.

---

## Problem Frame

The scorer currently tells the model to cite exact provider names, but its strict response schema accepts any citation string. In a four-case live comparison, both `DeepSeek-V4-Flash` and `gpt-4.1` classified the CBO/non-CBO cases correctly but emitted organization names in `citations`. The post-response validator rejects those names because they are not captured providers, producing `AzureOpenAiMalformedResponseError` and preventing the run from advancing.

`DeepSeek-V4-Flash` remains the selected candidate: it matched `gpt-4.1` on the limited, source-grounded label test and had lower median latency. This plan fixes the contract mismatch before any production deployment or resumed audit.

---

## Requirements Trace

- R1. A decisive AI advisory must cite only providers present in the exact evidence package supplied for that resource.
- R2. Invalid, missing, duplicate, or otherwise unsupported citations must remain fail-closed; the application must not relabel, fabricate, or silently repair provenance.
- R3. The strict structured-output schema must remain compatible with Azure OpenAI and Azure Foundry v1 deployments.
- R4. Unit tests must prove the request contract for one, multiple, and no captured providers, plus the existing malformed-response retry behavior.
- R5. Before changing Vercel Production configuration or resuming the paused audit, an operator must run a bounded DeepSeek canary and confirm all advisories pass validation with provider-class provenance retained.
- R6. Before the canary, the responsible operator must verify production-only Azure/Vercel access, least-privilege roles, and the existing credential rotation/revocation procedure for failed canaries or suspected exposure.

---

## Scope Boundaries

- No model-directed tool use, unrestricted web search, autonomous closure, record publishing, or directory mutation.
- No normalization of an organization name, URL, or free text into a provider citation after the response is returned.
- No database migration or change to immutable advisory persistence.
- No automatic Vercel Production secret or endpoint change as part of code deployment. An operator may configure the candidate resource immediately before the bounded canary; retaining that configuration for routine production use requires canary acceptance. Citation-contract acceptance alone does not establish model accuracy or replace reviewer-labeled calibration.

### Deferred to Follow-Up Work

- Replace provider-level citations with stable, observation-level identifiers if reviewers need to distinguish multiple observations from the same provider.
- Broader reviewer-labeled calibration across the May baseline after the canary is accepted.

---

## Context and Decisions

`src/lib/providers/hosted-evidence.ts` creates a bounded evidence envelope and passes the deduplicated observation providers to `AzureOpenAiScorer`. `src/lib/ai/azure-openai.ts` validates those provider names after response generation, but its module-level `responseFormat` currently types each citation only as a string. The contract is therefore enforceable after generation but not during generation.

Azure structured outputs support arrays and enums in the supported JSON Schema subset, including strict schemas. The request-specific provider allowlist can therefore be encoded as the citation item enum whenever at least one provider was captured. This is the smallest change that prevents the observed model behavior while preserving the existing independent parser.

- **Constrain, then verify:** Build the response schema from the per-resource provider list and retain the parser as defense in depth. The schema prevents unsupported citations; the parser protects against provider/API noncompliance.
- **No-provider fallback remains conservative:** When no provider exists, do not call the model; return the standard insufficient-evidence advisory with an empty citation list. This avoids unsupported strict-schema constraints and prevents a citation-retry loop without evidence to cite.
- **Select DeepSeek only after canary evidence:** The live comparison supports DeepSeek as the candidate, not as proof of production reliability. The paused run stays unchanged until code is deployed, an operator configures the candidate resource for the bounded canary, and its evidence is reviewed.

---

## Implementation Units

### U1. Generate a provider-constrained structured-output schema

- **Goal:** Bind `citations` to the captured provider names at response generation time.
- **Requirements:** R1, R2, R3
- **Dependencies:** None
- **Files:**
  - Modify: `src/lib/ai/azure-openai.ts`
  - Test: `tests/azure-openai.test.ts`
- **Approach:** Replace the static response-format value with a narrowly scoped builder that receives the deduplicated allowed providers. For one or more providers, emit a citation item enum of exactly those names. For no providers, return the standard insufficient-evidence advisory without calling the model. Pass the generated format to both the initial and one correction request.
- **Patterns to follow:** `parse` in `src/lib/ai/azure-openai.ts`, and the existing Foundry v1 request branching.
- **Execution note:** Start with request-body characterization tests; the Azure schema must remain free of unsupported strict-mode keywords.
- **Test scenarios:**
  - Happy path: one supplied provider produces a citation item enum containing only that provider.
  - Happy path: duplicate input provider names become one allowed enum value without changing parser behavior.
  - Edge case: no supplied provider returns the standard insufficient-evidence/empty-citation advisory without an Azure request.
  - Failure path: an unsupported citation returned despite the schema still fails closed and triggers only the existing single correction attempt.
  - Compatibility: Azure Foundry v1 retains the deployment name in the request body and receives the generated strict schema.
- **Verification:** Every decisive persisted advisory can name only a provider that was included in its captured evidence package; malformed responses still make no advisory or review mutation.

### U2. Strengthen provenance-contract coverage

- **Goal:** Make the generation-time and validation-time citation invariants executable and durable.
- **Requirements:** R1, R2, R4
- **Dependencies:** U1
- **Files:**
  - Modify: `tests/azure-openai.test.ts`
  - Modify: `tests/hosted-evidence.test.ts`
- **Approach:** Extend the existing injected-fetch tests to inspect the request JSON, not only the returned advisory. Add a hosted-evidence boundary test showing that the deduplicated observation provider list passed into scoring is the same list represented in the generated schema. Keep fixtures public, short, and credential-free.
- **Patterns to follow:** injected `fetch` tests in `tests/azure-openai.test.ts` and bounded observation fixtures in `tests/hosted-evidence.test.ts`.
- **Test scenarios:**
  - Integration: Firecrawl, Google Places, and search-fallback observations yield a generated citation enum with exactly those three provider names.
  - Edge case: repeated provider observations yield one enum member and remain valid when the model cites it once.
  - Security: request snapshots and assertion failures contain no API keys, raw cookies, or authorization headers.
  - Regression: a model output citing the organization name rather than a provider is rejected if a provider/API ignores the schema.
- **Verification:** Tests fail if the provider list drifts between captured evidence, generation-time schema, and post-response validation.

### U3. Perform an operator-controlled DeepSeek canary and configuration handoff

- **Goal:** Prove the repaired contract against the chosen model before changing production state.
- **Requirements:** R3, R5, R6
- **Dependencies:** U1, U2
- **Files:**
  - Modify: `docs/ops/security-and-secrets.md`
  - Modify: `docs/ops/operator-runbook.md`
  - Modify: `README.md`
- **Approach:** Document `DeepSeek-V4-Flash` as the selected pending production deployment, including its Azure Foundry v1 request shape and the rule that all endpoint/key/deployment values live only in Vercel encrypted environment variables. Before configuration, verify the authorized Azure and Vercel operator roles, production-only environment scope, least-privilege permissions, and the documented rotation/revocation response for a failed canary or suspected exposure. Specify an operator-controlled ten-record canary with the existing run controls: create a frozen selection of ten records with an initial budget of one, execute one checkpoint, inspect its provider citations, and extend the budget by exactly one only after acceptance. On a provider or schema failure, the exhausted budget leaves the run paused; the operator cancels it rather than resuming. Retain the new production configuration only after all ten checkpoints pass the citation contract; update the current GPT-5.6-specific security guidance at that point. This gate confirms contract compatibility only and does not replace reviewer-labeled model calibration.
- **Patterns to follow:** `docs/ops/security-and-secrets.md`, `docs/ops/operator-runbook.md`, `hostedEvidenceFromEnv`, and the existing pause/resume lifecycle.
- **Test scenarios:**
  - Manual integration: all ten canary advisories validate and retain only captured provider citations before the operator extends the budget to the next checkpoint.
  - Failure path: one `azure_openai:malformed` or HTTP 400 provider issue exhausts the one-checkpoint budget, leaves the run paused, and blocks any production-model cutover.
  - Security: documentation names variables and operating conditions but never values, endpoints with keys, or production database credentials; it assigns configuration and rotation/revocation actions to authorized operator roles.
- **Verification:** An operator has an auditable one-checkpoint-at-a-time canary result and explicit stop condition before the paused May-data audit is resumed.

---

## System-Wide Impact

The change is confined to advisory generation, but it protects three downstream surfaces: checkpoint execution records, immutable candidate provenance, and the reviewer evidence page. Provider citations establish provider-class, not observation-level, provenance. The deterministic verification policy remains authoritative; the model continues to provide only advisory context.

---

## Risks and Dependencies

- Azure strict-schema behavior can vary by deployment. Mitigation: retain injected request-contract tests and require a live bounded canary on the selected deployment.
- The current operations document identifies a different Azure resource and deployment. Mitigation: do not treat the model benchmark as authorization to move production secrets; require the Azure/Vercel operator to approve and apply that configuration separately.
- Provider-level citations establish source class, not a unique observation. Mitigation: do not overstate provenance; defer stable observation identifiers until reviewer needs justify the added storage contract.

---

## Sources and References

- [Azure OpenAI structured outputs](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/structured-outputs) — strict structured-output schema subset and Azure Foundry v1 request form.
- `src/lib/ai/azure-openai.ts` — existing prompt, strict schema, retry, and fail-closed parser.
- `src/lib/providers/hosted-evidence.ts` — bounded observation collection and provider-list handoff.
- `tests/azure-openai.test.ts` and `tests/hosted-evidence.test.ts` — current scorer and evidence-boundary tests.
