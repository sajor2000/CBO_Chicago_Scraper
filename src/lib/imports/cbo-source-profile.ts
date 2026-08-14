import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

export const isPostgresIdentifier = (value: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
export const quotePostgresIdentifier = (value: string) => `"${value}"`;
export const approvedNormalizedView = "public.cbo_public_directory_v1";

export type ApprovedCboSourceProfile = {
  name: string;
  sourceName: string;
  mode: "normalized_view" | "direct_tables";
  table: string;
  tables: readonly string[];
  idColumn: string;
  fields: readonly string[];
};

const chicagoHealthMapPublicV1: ApprovedCboSourceProfile = {
  name: "chicagohealthmap-public-v1",
  sourceName: "chicagohealthmap",
  mode: "normalized_view",
  table: approvedNormalizedView,
  tables: [approvedNormalizedView],
  idColumn: "source_id",
  fields: ["organization_name", "location_name", "full_address", "city", "state", "zip_code", "location_type", "website", "latitude", "longitude", "description", "source_relation"]
};

const chicagoHealthMapDirectV2: ApprovedCboSourceProfile = {
  name: "chicagohealthmap-direct-v2",
  sourceName: "chicagohealthmap",
  mode: "direct_tables",
  table: "public.community_resource_locations+public.wic_locations",
  tables: ["public.community_resource_locations", "public.wic_locations"],
  idColumn: "source_id",
  fields: ["organization_name", "location_name", "full_address", "city", "state", "zip_code", "location_type", "website", "phone", "latitude", "longitude", "description", "source_relation", "source_record"]
};

export function approvedCboSourceProfile(name: string): ApprovedCboSourceProfile {
  if (name === chicagoHealthMapPublicV1.name) return chicagoHealthMapPublicV1;
  if (name === chicagoHealthMapDirectV2.name) return chicagoHealthMapDirectV2;
  throw new CboSourceProfileError("CBO source profile is not approved.");
}

export type CboSourceProfileConfig = {
  databaseUrl: string;
  table: string;
  idColumn: string;
};

export type CboSourceProfileReport = {
  relation: string;
  relationKind: "base_table" | "normalized_view";
  idColumn: string;
  columns: Array<{ name: string; dataType: string; nullable: boolean }>;
  idCandidates: string[];
  totalRows: number;
  nullIdRows: number;
  duplicateIdRows: number;
};

export class CboSourceProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CboSourceProfileError";
  }
}

export function sourceProfileConfigFromEnv(env: Record<string, string | undefined> = process.env): CboSourceProfileConfig {
  const config = {
    databaseUrl: env.SOURCE_DATABASE_URL ?? "",
    table: env.CBO_SOURCE_TABLE ?? "",
    idColumn: env.CBO_SOURCE_ID_COLUMN ?? ""
  };
  validateSourceProfileConfig(config);
  return config;
}

export function validateSourceProfileConfig(config: CboSourceProfileConfig) {
  const parts = config.table.split(".");
  if (!config.databaseUrl || parts.length !== 2 || !parts.every(isPostgresIdentifier) || !isPostgresIdentifier(config.idColumn)) {
    throw new CboSourceProfileError("CBO source profile configuration is incomplete.");
  }
  if (["pg_catalog", "information_schema"].includes(parts[0]!)) {
    throw new CboSourceProfileError("CBO source relation must not use a system schema.");
  }
}

export async function profileCboSource(
  config: CboSourceProfileConfig,
  query: NeonQueryFunction<false, false> = neon(config.databaseUrl)
): Promise<CboSourceProfileReport> {
  validateSourceProfileConfig(config);
  const [schema, table] = config.table.split(".") as [string, string];
  try {
    const relation = await query.query(
      `select c.relkind
       from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = $1 and c.relname = $2`,
      [schema, table]
    ) as Array<{ relkind: string }>;
    const relationKind = relation[0]?.relkind === "r" ? "base_table" : relation[0]?.relkind === "v" && config.table === approvedNormalizedView ? "normalized_view" : null;
    if (!relationKind) throw new CboSourceProfileError("Configured CBO source relation is unavailable.");

    const columns = await query.query(
      `select column_name, data_type, udt_name, is_nullable, ordinal_position
       from information_schema.columns
       where table_schema = $1 and table_name = $2
       order by ordinal_position`,
      [schema, table]
    ) as Array<{ column_name: string; data_type: string; udt_name: string; is_nullable: "YES" | "NO" }>;
    if (!columns.some((column) => column.column_name === config.idColumn)) {
      throw new CboSourceProfileError("Configured CBO source ID column is unavailable.");
    }

    const aggregate = await query.query(
      `select count(*)::text as total_rows,
         count(*) filter (where ${quotePostgresIdentifier(config.idColumn)} is null)::text as null_id_rows,
         (count(*) filter (where ${quotePostgresIdentifier(config.idColumn)} is not null) - count(distinct ${quotePostgresIdentifier(config.idColumn)}))::text as duplicate_id_rows
       from ${quotePostgresIdentifier(schema)}.${quotePostgresIdentifier(table)}`
    ) as Array<{ total_rows: string; null_id_rows: string; duplicate_id_rows: string }>;
    const counts = aggregate[0];
    if (!counts) throw new CboSourceProfileError("Configured CBO source relation is unavailable.");

    const publicColumns = columns.map((column) => ({ name: column.column_name, dataType: column.data_type === "USER-DEFINED" ? column.udt_name : column.data_type, nullable: column.is_nullable === "YES" }));
    return {
      relation: config.table,
      relationKind,
      idColumn: config.idColumn,
      columns: publicColumns,
      idCandidates: publicColumns.filter((column) => column.name === "id" || column.name.endsWith("_id")).map((column) => column.name),
      totalRows: Number(counts.total_rows),
      nullIdRows: Number(counts.null_id_rows),
      duplicateIdRows: Number(counts.duplicate_id_rows)
    };
  } catch (error) {
    if (error instanceof CboSourceProfileError) throw error;
    throw new CboSourceProfileError("CBO source profile query failed safely.");
  }
}
