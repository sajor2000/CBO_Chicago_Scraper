import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.REVIEW_DATABASE_URL ?? "";
if (!databaseUrl) throw new Error("REVIEW_DATABASE_URL is required.");

const baselinePath = new URL("../migrations/004_baseline_imports.sql", import.meta.url);
const recurringPath = new URL("../migrations/009_recurring_verification.sql", import.meta.url);
const checksum = (path: URL) => createHash("sha256").update(readFileSync(path)).digest("hex");

const sql = neon(databaseUrl);
const ledger = await sql.query(
  `select version, count(*)::integer as count, min(checksum) as checksum
   from review_workspace.schema_migrations where version in (4, 9) group by version`
) as Array<{ version: number; count: number; checksum: string }>;
const recorded = (version: number) => ledger.find((entry) => Number(entry.version) === version);
const baselineLedger = recorded(4);
const recurringLedger = recorded(9);

// Preflight only: a historical 004 collision must be resolved explicitly, never rewritten here.
if (Number(baselineLedger?.count ?? 0) > 1 || (baselineLedger?.checksum && baselineLedger.checksum !== checksum(baselinePath))) {
  throw new Error("Migration preflight blocked: ambiguous 004 migration ledger history.");
}
if (Number(recurringLedger?.count ?? 0) > 1 || (recurringLedger?.checksum && recurringLedger.checksum !== checksum(recurringPath))) {
  throw new Error("Migration preflight blocked: version 9 checksum drift.");
}
if (recurringLedger) process.exit(0);

const result = spawnSync("psql", [
  databaseUrl,
  "-v", "ON_ERROR_STOP=1",
  "--single-transaction",
  "-f", fileURLToPath(recurringPath),
  "-c", `insert into review_workspace.schema_migrations (version, checksum) values (9, '${checksum(recurringPath)}')`
], { stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
