import { createHash } from "node:crypto";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { assertReviewWorkspace, reviewWorkspaceDb } from "../db.ts";

const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type CboSourceConfig = {
  databaseUrl: string;
  sourceName: string;
  table: string;
  idColumn: string;
  fields: string[];
};

export type SourceRow = { sourceId: string; payload: Record<string, unknown> };

export type BaselineImportReport = {
  sourceRows: number;
  insertedResources: number;
  insertedSnapshots: number;
  unchanged: number;
  skipped: number;
  failed: number;
};

export class CboBaselineImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CboBaselineImportError";
  }
}

export function sourceConfigFromEnv(env: Record<string, string | undefined> = process.env): CboSourceConfig {
  const fields = env.CBO_SOURCE_FIELDS?.split(",").map((field) => field.trim()).filter(Boolean) ?? [];
  const config = {
    databaseUrl: env.SOURCE_DATABASE_URL ?? "",
    sourceName: env.CBO_SOURCE_NAME ?? "",
    table: env.CBO_SOURCE_TABLE ?? "",
    idColumn: env.CBO_SOURCE_ID_COLUMN ?? "",
    fields
  };
  validateConfig(config);
  return config;
}

export function validateConfig(config: CboSourceConfig) {
  if (!config.databaseUrl || !config.sourceName.trim() || !config.idColumn || config.fields.length === 0) {
    throw new CboBaselineImportError("CBO baseline import configuration is incomplete.");
  }
  const parts = config.table.split(".");
  if (parts.length !== 2 || !parts.every((part) => identifier.test(part))) {
    throw new CboBaselineImportError("CBO source table must be schema-qualified.");
  }
  if (["pg_catalog", "information_schema"].includes(parts[0])) {
    throw new CboBaselineImportError("CBO source table must not use a system schema.");
  }
  if (!identifier.test(config.idColumn) || !config.fields.every((field) => identifier.test(field))) {
    throw new CboBaselineImportError("CBO source identifiers must be valid PostgreSQL identifiers.");
  }
  if (new Set(config.fields).size !== config.fields.length) {
    throw new CboBaselineImportError("CBO source fields must not repeat.");
  }
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function sha256(content: string) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function contentSha256(payload: Record<string, unknown>) {
  return sha256(canonicalJson(payload));
}

export function preflightRows(rows: SourceRow[]) {
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.sourceId.trim() || seen.has(row.sourceId)) {
      throw new CboBaselineImportError("CBO source rows must have unique, non-empty IDs.");
    }
    seen.add(row.sourceId);
  }
}

const quoteIdentifier = (value: string) => `"${value}"`;

export async function readSourceRows(config: CboSourceConfig, query: NeonQueryFunction<false, false> = neon(config.databaseUrl)): Promise<SourceRow[]> {
  validateConfig(config);
  const [schema, table] = config.table.split(".") as [string, string];
  const relation = await query.query(
    `select c.relkind = 'r' as is_base_table
     from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = $1 and c.relname = $2`,
    [schema, table]
  ) as Array<{ is_base_table: boolean }>;
  if (!relation[0]?.is_base_table) throw new CboBaselineImportError("Configured CBO source table is unavailable.");

  const requestedColumns = [config.idColumn, ...config.fields];
  const columns = await query.query(
    `select column_name from information_schema.columns
     where table_schema = $1 and table_name = $2 and column_name = any($3::text[])`,
    [schema, table, requestedColumns]
  ) as Array<{ column_name: string }>;
  if (columns.length !== new Set(requestedColumns).size) {
    throw new CboBaselineImportError("Configured CBO source columns are unavailable.");
  }

  const jsonPairs = config.fields.flatMap((field) => [`'${field}'`, quoteIdentifier(field)]).join(", ");
  const rows = await query.query(
    `select ${quoteIdentifier(config.idColumn)}::text as source_id, jsonb_build_object(${jsonPairs}) as payload
     from ${quoteIdentifier(schema)}.${quoteIdentifier(table)}`
  ) as Array<{ source_id: string | null; payload: Record<string, unknown> }>;
  return rows.map((row) => ({ sourceId: row.source_id ?? "", payload: row.payload }));
}

type DestinationQuery = ReturnType<typeof reviewWorkspaceDb>;

async function insertReceipt(
  query: DestinationQuery,
  config: CboSourceConfig,
  outcome: "succeeded" | "failed",
  report: BaselineImportReport,
  errorCode: string | null
) {
  await query.query(
    `insert into review_workspace.baseline_import_receipts (
      source_name, source_table, outcome, source_row_count, inserted_resource_count,
      inserted_snapshot_count, unchanged_count, skipped_count, failed_count, error_code
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [config.sourceName, config.table, outcome, report.sourceRows, report.insertedResources,
      report.insertedSnapshots, report.unchanged, report.skipped, report.failed, errorCode]
  );
}

async function assertBaselineImportSchema(query: DestinationQuery) {
  const rows = await query`
    select exists (
      select 1 from information_schema.tables
      where table_schema = 'review_workspace' and table_name = 'baseline_import_receipts'
    ) and exists (
      select 1 from information_schema.triggers
      where event_object_schema = 'review_workspace'
        and event_object_table = 'baseline_import_receipts'
        and trigger_name = 'baseline_import_receipts_append_only'
    ) and has_table_privilege(
      current_user, 'review_workspace.baseline_import_receipts', 'insert'
    ) as is_ready
  ` as Array<{ is_ready: boolean }>;
  if (!rows[0]?.is_ready) {
    throw new CboBaselineImportError("Review workspace baseline-import migration is not ready.");
  }
}

async function importRow(query: DestinationQuery, config: CboSourceConfig, row: SourceRow) {
  const payload = canonicalJson(row.payload);
  const version = sha256(payload);
  const result = await query.query(
    `with inserted_resource as (
       insert into review_workspace.resources (reference_source, reference_source_id)
       values ($1, $2) on conflict (reference_source, reference_source_id) do nothing
       returning id
     ), resource as (
       select id from inserted_resource
       union all
       select id from review_workspace.resources
       where reference_source = $1 and reference_source_id = $2
       limit 1
     ), inserted_snapshot as (
       insert into review_workspace.resource_snapshots (resource_id, source_version, source_payload, imported_by)
       select id, $3, $4::jsonb, 'cbo-baseline-cli' from resource
       on conflict (resource_id, source_version) do nothing
       returning id
     ), snapshot as (
       select id from inserted_snapshot
       union all
       select s.id from review_workspace.resource_snapshots s
       join resource r on r.id = s.resource_id
       where s.source_version = $3
       limit 1
     ), inserted_receipt as (
       insert into review_workspace.resource_snapshot_receipts (
         resource_snapshot_id, content_sha256, redaction_policy_version, raw_object_reference
       ) select id, $3, 'public-directory-v1', null from snapshot
       on conflict (resource_snapshot_id) do nothing
     )
     select exists(select 1 from inserted_resource) as inserted_resource,
       exists(select 1 from inserted_snapshot) as inserted_snapshot`,
    [config.sourceName, row.sourceId, version, payload]
  ) as Array<{ inserted_resource: boolean; inserted_snapshot: boolean }>;
  return result[0];
}

export async function importCboBaseline(
  config: CboSourceConfig,
  dependencies: {
    readRows?: (config: CboSourceConfig) => Promise<SourceRow[]>;
    destination?: DestinationQuery;
  } = {}
): Promise<BaselineImportReport> {
  validateConfig(config);
  const rows = await (dependencies.readRows ?? readSourceRows)(config);
  preflightRows(rows);

  const destination = dependencies.destination ?? reviewWorkspaceDb();
  await assertReviewWorkspace(destination);
  await assertBaselineImportSchema(destination);
  const report: BaselineImportReport = { sourceRows: rows.length, insertedResources: 0, insertedSnapshots: 0, unchanged: 0, skipped: 0, failed: 0 };
  try {
    for (const row of rows) {
      const outcome = await importRow(destination, config, row);
      if (outcome?.inserted_resource) report.insertedResources += 1;
      if (outcome?.inserted_snapshot) report.insertedSnapshots += 1;
      else report.unchanged += 1;
    }
  } catch (error) {
    report.failed = 1;
    report.skipped = report.sourceRows - report.insertedSnapshots - report.unchanged - report.failed;
    try {
      await insertReceipt(destination, config, "failed", report, "destination_write_failed");
    } catch {
      // Preserve the original row-write failure when the receipt table is unavailable.
    }
    throw error;
  }
  await insertReceipt(destination, config, "succeeded", report, null);
  return report;
}
