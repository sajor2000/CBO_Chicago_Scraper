import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.REVIEW_DATABASE_URL ?? "";
if (!databaseUrl) throw new Error("REVIEW_DATABASE_URL is required.");

const baselinePath = new URL("../migrations/004_baseline_imports.sql", import.meta.url);
const recurringPath = new URL("../migrations/009_recurring_verification.sql", import.meta.url);
const mirrorCopyPath = new URL("../migrations/010_cbo_mirror_copy.sql", import.meta.url);
const pauseLeasePath = new URL("../migrations/011_pause_preserves_checkpoint_lease.sql", import.meta.url);
const eligibilityReviewPath = new URL("../migrations/012_cbo_eligibility_review.sql", import.meta.url);
const eligibilityDecisionPath = new URL("../migrations/013_eligibility_decision_state.sql", import.meta.url);
const checksum = (path: URL) => createHash("sha256").update(readFileSync(path)).digest("hex");

const sql = neon(databaseUrl);
const ledger = await sql.query(
  `select version, count(*)::integer as count, min(checksum) as checksum
   from review_workspace.schema_migrations where version in (4, 9, 10, 11, 12, 13) group by version`
) as Array<{ version: number; count: number; checksum: string }>;
const recorded = (version: number) => ledger.find((entry) => Number(entry.version) === version);
const baselineLedger = recorded(4);
const recurringLedger = recorded(9);
const mirrorCopyLedger = recorded(10);
const pauseLeaseLedger = recorded(11);
const eligibilityReviewLedger = recorded(12);
const eligibilityDecisionLedger = recorded(13);

// Preflight only: a historical 004 collision must be resolved explicitly, never rewritten here.
if (Number(baselineLedger?.count ?? 0) > 1 || (baselineLedger?.checksum && baselineLedger.checksum !== checksum(baselinePath))) {
  throw new Error("Migration preflight blocked: ambiguous 004 migration ledger history.");
}
if (Number(recurringLedger?.count ?? 0) > 1 || (recurringLedger?.checksum && recurringLedger.checksum !== checksum(recurringPath))) {
  throw new Error("Migration preflight blocked: version 9 checksum drift.");
}
if (Number(mirrorCopyLedger?.count ?? 0) > 1 || (mirrorCopyLedger?.checksum && mirrorCopyLedger.checksum !== checksum(mirrorCopyPath))) {
  throw new Error("Migration preflight blocked: version 10 checksum drift.");
}
if (Number(pauseLeaseLedger?.count ?? 0) > 1 || (pauseLeaseLedger?.checksum && pauseLeaseLedger.checksum !== checksum(pauseLeasePath))) {
  throw new Error("Migration preflight blocked: version 11 checksum drift.");
}
if (Number(eligibilityReviewLedger?.count ?? 0) > 1 || (eligibilityReviewLedger?.checksum && eligibilityReviewLedger.checksum !== checksum(eligibilityReviewPath))) {
  throw new Error("Migration preflight blocked: version 12 checksum drift.");
}
if (Number(eligibilityDecisionLedger?.count ?? 0) > 1 || (eligibilityDecisionLedger?.checksum && eligibilityDecisionLedger.checksum !== checksum(eligibilityDecisionPath))) {
  throw new Error("Migration preflight blocked: version 13 checksum drift.");
}
if (eligibilityDecisionLedger) process.exit(0);

const migrations = eligibilityReviewLedger ? [eligibilityDecisionPath] : pauseLeaseLedger ? [eligibilityReviewPath, eligibilityDecisionPath] : mirrorCopyLedger ? [pauseLeasePath, eligibilityReviewPath, eligibilityDecisionPath] : recurringLedger ? [mirrorCopyPath, pauseLeasePath, eligibilityReviewPath, eligibilityDecisionPath] : [recurringPath, mirrorCopyPath, pauseLeasePath, eligibilityReviewPath, eligibilityDecisionPath];
const ledgerValues = migrations.map((path) => {
  const version = path === recurringPath ? 9 : path === mirrorCopyPath ? 10 : path === pauseLeasePath ? 11 : path === eligibilityReviewPath ? 12 : 13;
  return `(${version}, '${checksum(path)}')`;
});
const result = spawnSync("psql", [
  databaseUrl,
  "-v", "ON_ERROR_STOP=1",
  "--single-transaction",
  ...migrations.flatMap((path) => ["-f", fileURLToPath(path)]),
  "-c", `insert into review_workspace.schema_migrations (version, checksum) values ${ledgerValues.join(", ")} on conflict (version) do nothing`
], { stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
