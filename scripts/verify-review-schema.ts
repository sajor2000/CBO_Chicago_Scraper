import { neon } from "@neondatabase/serverless";
import { REQUIRED_REVIEW_SCHEMA_VERSION } from "../src/lib/review-schema.ts";

const databaseUrl = process.env.REVIEW_DATABASE_URL;
if (!databaseUrl) throw new Error("REVIEW_DATABASE_URL is required.");

const rows = await neon(databaseUrl).query(
  `select
     exists (select 1 from review_workspace.workspace_sentinel where workspace_kind = 'dedicated_review_workspace') as workspace_ready,
     exists (select 1 from review_workspace.schema_migrations where version = $1) as schema_ready,
     (select outcome = 'succeeded' and failed_count = 0 and skipped_count = 0
        and source_row_count = inserted_snapshot_count + unchanged_count
      from review_workspace.baseline_import_receipts order by recorded_at desc limit 1) as baseline_ready`,
  [REQUIRED_REVIEW_SCHEMA_VERSION]
) as Array<{ workspace_ready: boolean; schema_ready: boolean; baseline_ready: boolean }>;

const state = rows[0];
if (!state?.workspace_ready || !state.schema_ready || !state.baseline_ready) {
  throw new Error(`Production review database is not ready for schema version ${REQUIRED_REVIEW_SCHEMA_VERSION}.`);
}
console.log(`Review database ready at migration ${REQUIRED_REVIEW_SCHEMA_VERSION}.`);
