import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

export const sourceRelations = ["community_resource_locations", "wic_locations"] as const;
export type SourceRelation = typeof sourceRelations[number];

export type SourceColumnContract = {
  name: string;
  ordinal: number;
  type: string;
  nullable: boolean;
};

const columns = (values: Array<[string, string, boolean]>): SourceColumnContract[] => values.map(([name, type, nullable], index) => ({ name, type, nullable, ordinal: index + 1 }));

export const sourceSchemaContract: Record<SourceRelation, readonly SourceColumnContract[]> = {
  community_resource_locations: columns([
    ["id", "integer", false], ["organization_name", "text", true], ["location_type", "text", true], ["full_address", "text", true], ["hyperlink", "text", true], ["latitude", "double precision", true], ["longitude", "double precision", true], ["categories", "jsonb", true], ["status", "text", true], ["capacity", "text", true], ["phone", "text", true], ["email", "text", true], ["hours", "jsonb", true], ["languages", "jsonb", true], ["description", "text", true], ["confidence", "double precision", true], ["sources", "jsonb", true], ["last_verified", "timestamp with time zone", true], ["last_enriched", "timestamp with time zone", true], ["geom", "geometry(Point,4326)", true], ["created_at", "timestamp with time zone", true], ["updated_at", "timestamp with time zone", true]
  ]),
  wic_locations: columns([
    ["wic_id", "integer", false], ["location_name", "text", false], ["location_type", "text", true], ["full_address", "text", true], ["city", "text", true], ["state", "character(2)", true], ["zip_code", "character varying(10)", true], ["county", "text", true], ["fips_state", "character(2)", true], ["fips_county", "character(5)", true], ["phone", "character varying(20)", true], ["website", "text", true], ["longitude", "double precision", false], ["latitude", "double precision", false], ["geom", "geometry(Point,4326)", true], ["source_date", "date", true], ["created_at", "timestamp with time zone", true], ["updated_at", "timestamp with time zone", true]
  ])
};

export const directSourceColumns: Record<SourceRelation, readonly string[]> = {
  community_resource_locations: sourceSchemaContract.community_resource_locations.map((column) => column.name),
  wic_locations: sourceSchemaContract.wic_locations.map((column) => column.name)
};

export type SourceColumnMetadata = SourceColumnContract & { table_name: SourceRelation };

export class CboSourceSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CboSourceSchemaError";
  }
}

export function assertSourceSchema(rows: SourceColumnMetadata[]) {
  for (const relation of sourceRelations) {
    const actual = rows.filter((row) => row.table_name === relation);
    const expected = sourceSchemaContract[relation];
    if (actual.length !== expected.length || actual.some((column, index) => {
      const contract = expected[index];
      return !contract || column.name !== contract.name || column.ordinal !== contract.ordinal || column.type !== contract.type || column.nullable !== contract.nullable;
    })) {
      throw new CboSourceSchemaError(`CBO source schema drift detected for ${relation}.`);
    }
  }
  if (rows.some((row) => !sourceRelations.includes(row.table_name))) {
    throw new CboSourceSchemaError("CBO source schema drift detected for an unexpected relation.");
  }
}

export async function verifyCboSourceSchema(databaseUrl: string | undefined, query?: NeonQueryFunction<false, false>) {
  if (!databaseUrl) throw new CboSourceSchemaError("SOURCE_DATABASE_URL is required for source-schema verification.");
  const sourceQuery = query ?? neon(databaseUrl);
  const rows = await sourceQuery.query(
    `select information.table_name, information.ordinal_position as ordinal, information.column_name as name,
            pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) as type,
            information.is_nullable = 'YES' as nullable
       from information_schema.columns information
       join pg_catalog.pg_namespace namespace on namespace.nspname = information.table_schema
       join pg_catalog.pg_class relation on relation.relnamespace = namespace.oid and relation.relname = information.table_name
       join pg_catalog.pg_attribute attribute on attribute.attrelid = relation.oid and attribute.attname = information.column_name and attribute.attnum = information.ordinal_position
      where information.table_schema = 'public' and information.table_name = any($1::text[])
      order by information.table_name, information.ordinal_position`,
    [...sourceRelations]
  ) as SourceColumnMetadata[];
  assertSourceSchema(rows);
  return rows;
}
