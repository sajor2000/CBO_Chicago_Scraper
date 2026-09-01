<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Production release invariant

Never deploy `main`/`master` directly. Production releases must use `.github/workflows/production.yml` (or the equivalent emergency `npm run release:production` command), which stages the Vercel build without assigning the production domain, applies and verifies the Neon migration ledger, then promotes and smoke-tests the staged deployment. Every database migration must remain backward-compatible with the currently deployed app and increment `REQUIRED_REVIEW_SCHEMA_VERSION`.

## CBO source-schema contract

Before proposing source fields or producing a source-format CSV, consult `docs/data/cbo-source-schema.md` and its code contract in `src/lib/imports/cbo-source-schema.ts`. Never infer a source field, identifier, type, or column order. In an authorized source-reader environment, run `npm run verify:cbo-source-schema` before a release; it is metadata-only and source tables remain read-only. Keep `SOURCE_DATABASE_URL` out of Vercel, the browser, and CSV downloads.
