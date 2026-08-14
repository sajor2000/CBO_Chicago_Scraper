# Codex handoff — ChicagoHealthMap CBO Verifier

Date: 2026-08-13  
Base: `main` @ `5804ce3` (includes merged PRs #6 and #7)  
Open: [PR #8](https://github.com/sajor2000/CBO_Chicago_Scraper/pull/8) — align `cbo_public_directory_v1` with live Neon columns (ready to merge)

## Product boundary (do not violate)

- Review-first. No scraper/AI/timeout may auto-close, delete, merge, or publish a CBO.
- Dedicated Neon review workspace only. Original mirror and Azure production stay read-only.
- Cron stays disabled in `vercel.json` until a manual pilot is accepted.
- Browser never receives provider credentials.

## What shipped

| Area | Status |
| --- | --- |
| U3 operator UX | Done on `main` — `/review` mounts `RunControls` for operators |
| Execute contract | One checkpoint per `POST /api/runs/[runId]/execute`; `maxDuration=60`; `releaseLease` on failure |
| Client pilot loop | `limit: 1` per request, cancel button, queue refresh, partial totals |
| Roles | `/review` allows operator **or** reviewer; panel vs queue still role-gated |
| Tests | `npm run check` uses `node --experimental-strip-types`; 51 tests on last green run |
| Impeccable | Installed under `.cursor/skills` + `.github/skills`; `PRODUCT.md` / `DESIGN.md` present |
| Neon baseline | Applied live on project `chicagohealthmap-cbo-verifier` (`fragrant-band-24602967`): reconciled receipt, **1999** snapshots |
| Clerk grants | `user_3HrI5eXMheNwppmX4Ys1Efk7t6R` has active `operator` + `reviewer` |

## Blockers for hosted pilot

1. **Production returns HTTP 500** on `/`, `/sign-in`, and `/api/*`  
   URL: `https://chicagohealthmap-cbo-verifier.vercel.app`  
   Likely missing/invalid Clerk env (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`) or other required Production secrets. Vercel CLI was **logged out** in the cloud agent; Vercel MCP needs desktop auth.
2. Local `.env.local` is gitignored and was empty of Clerk/provider keys in the agent VM (DB URL was filled for baseline import only — do not commit).

## Immediate Codex tasks (in order)

1. Merge [PR #8](https://github.com/sajor2000/CBO_Chicago_Scraper/pull/8) if still open.
2. Auth Vercel (`vercel login` / token) → `vercel link -p chicagohealthmap-cbo-verifier` → `vercel env ls` / `vercel env pull`.
3. Confirm Production has Clerk + `REVIEW_DATABASE_URL` (Neon `chicagohealthmap-cbo-verifier`) + Firecrawl/Google/Tavily/Azure OpenAI.
4. Redeploy Production; confirm `/sign-in` loads (not 500).
5. Sign in as the granted Clerk user → `/review` → **one-record** pilot → decide candidate.
6. Only after a good pilot: consider provider field-extraction gaps (Firecrawl structured values / Google Place Details for AE1) and staging fingerprint idempotency (AE3).

## Code map

1. [docs/plans/2026-08-13-feat-live-verification-pilot.md](plans/2026-08-13-feat-live-verification-pilot.md)
2. [docs/operator-runbook.md](operator-runbook.md) · [docs/source-policy.md](source-policy.md) · [docs/security-and-secrets.md](security-and-secrets.md)
3. `src/lib/verification/run-checkpoint.ts`
4. `src/lib/providers/hosted-evidence.ts`
5. `src/lib/repositories/review.ts` · `src/lib/runs/index.ts`
6. `src/app/review/page.tsx` · `src/app/review/run-controls.tsx` · `src/app/api/runs/**`

## Verify before any behavior change

```sh
npm ci
npm run check
npm run build
```

## Neon notes

- Verifier project (has copies + `review_workspace` + baseline): `chicagohealthmap-cbo-verifier` / `fragrant-band-24602967`
- Second project `Chicago CBO Review Workspace` / `damp-mouse-84068738` also has sentinel but **no** baseline/receipts/roles — prefer the verifier project for `REVIEW_DATABASE_URL`
- Live view was created with null city/state/zip for community resources (mirror lacks those columns); PR #8 records that SQL in-repo

## Explicitly deferred

- Cron enablement
- Azure patch export / production writes
- Firecrawl Interact / IRS / trusted-directory enrichment UI
- Potential-new-resource discovery UI
