import { createHash } from "node:crypto";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { assertReviewWorkspace, reviewWorkspaceDb } from "../db.ts";
import { approvedCboSourceProfile, isPostgresIdentifier, quotePostgresIdentifier } from "./cbo-source-profile.ts";

export type CboSourceConfig = {
  databaseUrl: string;
  profileName: string;
  sourceName: string;
  mode: "normalized_view" | "direct_tables";
  table: string;
  tables: string[];
  idColumn: string;
  fields: string[];
};

export type SourceRow = { sourceId: string; payload: Record<string, unknown> };
export const sourceRelations = ["community_resource_locations", "wic_locations"] as const;
export type SourceRelation = typeof sourceRelations[number];
export const directSourceColumns: Record<SourceRelation, readonly string[]> = {
  community_resource_locations: ["id", "organization_name", "location_type", "full_address", "hyperlink", "latitude", "longitude", "categories", "status", "capacity", "phone", "email", "hours", "languages", "description", "confidence", "sources", "last_verified", "last_enriched", "geom", "created_at", "updated_at"],
  wic_locations: ["wic_id", "location_name", "location_type", "full_address", "city", "state", "zip_code", "county", "fips_state", "fips_county", "phone", "website", "longitude", "latitude", "geom", "source_date", "created_at", "updated_at"]
};

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
  const profileName = env.CBO_SOURCE_PROFILE ?? "";
  let profile;
  try {
    profile = approvedCboSourceProfile(profileName);
  } catch {
    throw new CboBaselineImportError("CBO source profile is not approved.");
  }
  const config = {
    databaseUrl: env.SOURCE_DATABASE_URL ?? "",
    profileName: profile.name,
    sourceName: profile.sourceName,
    mode: profile.mode,
    table: profile.table,
    tables: [...profile.tables],
    idColumn: profile.idColumn,
    fields: [...profile.fields]
  };
  validateConfig(config);
  return config;
}

export function validateConfig(config: CboSourceConfig) {
  if (!config.databaseUrl || !config.profileName || !config.sourceName.trim() || !config.idColumn || config.fields.length === 0) {
    throw new CboBaselineImportError("CBO baseline import configuration is incomplete.");
  }
  let profile;
  try {
    profile = approvedCboSourceProfile(config.profileName);
  } catch {
    throw new CboBaselineImportError("CBO source profile is not approved.");
  }
  if (config.sourceName !== profile.sourceName || config.mode !== profile.mode || config.table !== profile.table || config.tables.join(",") !== profile.tables.join(",") || config.idColumn !== profile.idColumn || config.fields.join(",") !== profile.fields.join(",")) {
    throw new CboBaselineImportError("CBO source configuration must match its approved profile.");
  }
  const relations = config.mode === "direct_tables" ? config.tables : [config.table];
  if (!relations.every((relation) => {
    const parts = relation.split(".");
    return parts.length === 2 && parts.every(isPostgresIdentifier);
  })) {
    throw new CboBaselineImportError("CBO source table must be schema-qualified.");
  }
  if (relations.some((relation) => ["pg_catalog", "information_schema"].includes(relation.split(".")[0]!))) {
    throw new CboBaselineImportError("CBO source table must not use a system schema.");
  }
  if (!isPostgresIdentifier(config.idColumn) || !config.fields.every(isPostgresIdentifier)) {
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

export async function readSourceRows(config: CboSourceConfig, query: NeonQueryFunction<false, false> = neon(config.databaseUrl)): Promise<SourceRow[]> {
  validateConfig(config);
  if (config.mode === "direct_tables") return readDirectSourceRows(config, query);
  const [schema, table] = config.table.split(".") as [string, string];
  const relation = await query.query(
    `select c.relkind = 'v' as is_profile_relation
     from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = $1 and c.relname = $2`,
    [schema, table]
  ) as Array<{ is_profile_relation: boolean }>;
  if (!relation[0]?.is_profile_relation) throw new CboBaselineImportError("Configured CBO source table is unavailable.");

  const requestedColumns = [config.idColumn, ...config.fields];
  const columns = await query.query(
    `select column_name from information_schema.columns
     where table_schema = $1 and table_name = $2 and column_name = any($3::text[])`,
    [schema, table, requestedColumns]
  ) as Array<{ column_name: string }>;
  if (columns.length !== new Set(requestedColumns).size) {
    throw new CboBaselineImportError("Configured CBO source columns are unavailable.");
  }

  const jsonPairs = config.fields.flatMap((field) => [`'${field}'`, quotePostgresIdentifier(field)]).join(", ");
  const rows = await query.query(
    `select ${quotePostgresIdentifier(config.idColumn)}::text as source_id, jsonb_build_object(${jsonPairs}) as payload
     from ${quotePostgresIdentifier(schema)}.${quotePostgresIdentifier(table)}`
  ) as Array<{ source_id: string | null; payload: Record<string, unknown> }>;
  return rows.map((row) => ({ sourceId: row.source_id ?? "", payload: row.payload }));
}

async function readDirectSourceRows(config: CboSourceConfig, query: NeonQueryFunction<false, false>): Promise<SourceRow[]> {
  const expected = config.tables.map((relation) => relation.split(".")[1]);
  const relations = await query.query(
    `select c.relname
     from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relname = any($1::text[])`,
    [expected]
  ) as Array<{ relname: string }>;
  if (relations.length !== expected.length || relations.some(({ relname }) => !expected.includes(relname))) {
    throw new CboBaselineImportError("Configured CBO source tables are unavailable.");
  }

  const columns = await query.query(
    `select table_name, column_name from information_schema.columns
     where table_schema = 'public' and table_name = any($1::text[])`,
    [expected]
  ) as Array<{ table_name: SourceRelation; column_name: string }>;
  for (const [table, required] of Object.entries(directSourceColumns)) {
    const available = new Set(columns.filter((column) => column.table_name === table).map((column) => column.column_name));
    if (!required.every((column) => available.has(column))) throw new CboBaselineImportError("Configured CBO source columns are unavailable.");
  }

  const rows = await query.query(`
    select 'community_resource:' || resource.id::text as source_id,
      jsonb_build_object(
        'organization_name', resource.organization_name, 'location_name', null,
        'full_address', resource.full_address, 'city', null, 'state', null, 'zip_code', null,
        'location_type', resource.location_type, 'website', resource.hyperlink, 'phone', resource.phone,
        'latitude', resource.latitude, 'longitude', resource.longitude, 'description', resource.description,
        'source_relation', 'community_resource_locations', 'source_record', jsonb_build_object(
          'id', resource.id, 'organization_name', resource.organization_name, 'location_type', resource.location_type,
          'full_address', resource.full_address, 'hyperlink', resource.hyperlink, 'latitude', resource.latitude,
          'longitude', resource.longitude, 'categories', resource.categories, 'status', resource.status,
          'capacity', resource.capacity, 'phone', resource.phone, 'email', resource.email, 'hours', resource.hours,
          'languages', resource.languages, 'description', resource.description, 'confidence', resource.confidence,
          'sources', resource.sources, 'last_verified', resource.last_verified, 'last_enriched', resource.last_enriched,
          'created_at', resource.created_at, 'updated_at', resource.updated_at
        )
      ) as payload
    from public.community_resource_locations resource
    union all
    select 'wic:' || wic.wic_id::text as source_id,
      jsonb_build_object(
        'organization_name', null, 'location_name', wic.location_name,
        'full_address', wic.full_address, 'city', wic.city, 'state', wic.state, 'zip_code', wic.zip_code,
        'location_type', 'wic', 'website', wic.website, 'phone', wic.phone,
        'latitude', wic.latitude, 'longitude', wic.longitude, 'description', null,
        'source_relation', 'wic_locations', 'source_record', jsonb_build_object(
          'wic_id', wic.wic_id, 'location_name', wic.location_name, 'location_type', wic.location_type,
          'full_address', wic.full_address, 'city', wic.city, 'state', wic.state, 'zip_code', wic.zip_code,
          'county', wic.county, 'fips_state', wic.fips_state, 'fips_county', wic.fips_county,
          'phone', wic.phone, 'website', wic.website, 'longitude', wic.longitude, 'latitude', wic.latitude,
          'source_date', wic.source_date, 'created_at', wic.created_at, 'updated_at', wic.updated_at
        )
      ) as payload
    from public.wic_locations wic
  `) as Array<{ source_id: string | null; payload: Record<string, unknown> }>;
  return rows.map((row) => ({ sourceId: row.source_id ?? "", payload: row.payload }));
}

type DestinationQuery = ReturnType<typeof reviewWorkspaceDb>;

function sourceRelation(row: SourceRow): SourceRelation {
  const relation = row.payload.source_relation;
  if (!sourceRelations.includes(relation as SourceRelation)) {
    throw new CboBaselineImportError("Every refresh row must identify its CBO or WIC source relation.");
  }
  return relation as SourceRelation;
}

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

async function importRow(query: DestinationQuery, config: CboSourceConfig, row: SourceRow, manifestId: string, relation: SourceRelation) {
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
     ), frozen_membership as (
       insert into review_workspace.refresh_snapshot_memberships
         (manifest_id, resource_id, resource_snapshot_id, source_relation)
       select $5::uuid, resource.id, snapshot.id, $6 from resource cross join snapshot
       on conflict (manifest_id, resource_id) do nothing
     )
     select exists(select 1 from inserted_resource) as inserted_resource,
       exists(select 1 from inserted_snapshot) as inserted_snapshot`,
    [config.sourceName, row.sourceId, version, payload, manifestId, relation]
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
  const relationRows = new Map(sourceRelations.map((relation) => [relation, 0]));
  const manifestRows = await destination.query(
    `insert into review_workspace.refresh_manifests (status, source_manifest_sha256)
     values ('running', $1) returning id`,
    [sha256(canonicalJson(rows.map((row) => ({ sourceId: row.sourceId, payload: row.payload }))))]
  ) as Array<{ id: string }>;
  const manifestId = manifestRows[0]?.id;
  if (!manifestId) throw new CboBaselineImportError("Refresh manifest creation failed.");
  try {
    for (let offset = 0; offset < rows.length; offset += 20) {
      const outcomes = await Promise.all(rows.slice(offset, offset + 20).map(async (row) => {
        const relation = sourceRelation(row);
        return { relation, outcome: await importRow(destination, config, row, manifestId, relation) };
      }));
      for (const { relation, outcome } of outcomes) {
        relationRows.set(relation, relationRows.get(relation)! + 1);
        if (outcome?.inserted_resource) report.insertedResources += 1;
        if (outcome?.inserted_snapshot) report.insertedSnapshots += 1;
        else report.unchanged += 1;
      }
    }
    for (const relation of sourceRelations) {
      const count = relationRows.get(relation)!;
      await destination.query(
        `insert into review_workspace.refresh_source_receipts
          (manifest_id, source_relation, outcome, source_row_count, copied_snapshot_count, discrepancy_count, error_code)
         values ($1::uuid, $2, $3, $4, $4, $5, $6)`,
        [manifestId, relation, count ? "succeeded" : "failed", count, count ? 0 : 1, count ? null : "source_omitted"]
      );
    }
    const promoted = await destination.query(
      "select review_workspace.promote_refresh_manifest($1::uuid) as promoted",
      [manifestId]
    ) as Array<{ promoted: boolean }>;
    if (!promoted[0]?.promoted) throw new CboBaselineImportError("CBO/WIC refresh did not reconcile and was not promoted.");
  } catch (error) {
    report.failed = 1;
    report.skipped = Math.max(0, report.sourceRows - report.insertedSnapshots - report.unchanged - report.failed);
    try {
      await destination.query(
        `update review_workspace.refresh_manifests
         set status = 'failed', completed_at = now(), discrepancy_count = greatest(discrepancy_count, 1)
         where id = $1::uuid and status = 'running'`,
        [manifestId]
      );
      await insertReceipt(destination, config, "failed", report, "destination_write_failed");
    } catch {
      // Preserve the original row-write failure when the receipt table is unavailable.
    }
    throw error;
  }
  await insertReceipt(destination, config, "succeeded", report, null);
  return report;
}
