import assert from "node:assert/strict";
import test from "node:test";
import {
  CboBaselineImportError,
  canonicalJson,
  contentSha256,
  importCboBaseline,
  preflightRows,
  readSourceRows,
  sourceConfigFromEnv
} from "../src/lib/imports/cbo-baseline.ts";

const sourceConfig = () => sourceConfigFromEnv({
  SOURCE_DATABASE_URL: "postgres://private",
  CBO_SOURCE_PROFILE: "chicagohealthmap-public-v1"
});

function fakeDestination(promoted: boolean) {
  const queries: string[] = [];
  const destination = Object.assign(
    async (strings: TemplateStringsArray) => {
      const sql = strings.join("");
      queries.push(sql);
      return sql.includes("workspace_sentinel") ? [{ is_review_workspace: true }] : [{ is_ready: true }];
    },
    {
      query: async (sql: string) => {
        queries.push(sql);
        if (sql.includes("insert into review_workspace.refresh_manifests")) return [{ id: "00000000-0000-4000-8000-000000000001" }];
        if (sql.includes("exists(select 1 from inserted_resource)")) return [{ inserted_resource: true, inserted_snapshot: true }];
        if (sql.includes("promote_refresh_manifest")) return [{ promoted }];
        return [];
      }
    }
  );
  return { destination, queries };
}

test("baseline configuration requires a named source profile before any database access", () => {
  assert.throws(
    () => sourceConfigFromEnv({
      SOURCE_DATABASE_URL: "postgres://private"
    }),
    (error: Error) => error instanceof CboBaselineImportError && !error.message.includes("postgres")
  );
});

test("baseline configuration rejects an unknown profile before any database access", () => {
  assert.throws(
    () => sourceConfigFromEnv({
      SOURCE_DATABASE_URL: "postgres://private",
      CBO_SOURCE_PROFILE: "operator-expanded-fields"
    }),
    (error: Error) => error instanceof CboBaselineImportError && !error.message.includes("postgres")
  );
});

test("the approved profile ignores operator field expansion", () => {
  const config = sourceConfigFromEnv({
    SOURCE_DATABASE_URL: "postgres://private",
    CBO_SOURCE_PROFILE: "chicagohealthmap-public-v1",
    CBO_SOURCE_FIELDS: "internal_notes,phone"
  });
  assert.equal(config.table, "public.cbo_public_directory_v1");
  assert.ok(!config.fields.includes("internal_notes"));
  assert.ok(!config.fields.includes("phone"));
});

test("canonical JSON gives equivalent source objects the same content receipt", () => {
  const first = { name: "Example", address: { zip: "60601", street: "1 Main" }, services: ["food", "care"] };
  const second = { services: ["food", "care"], address: { street: "1 Main", zip: "60601" }, name: "Example" };
  assert.equal(canonicalJson(first), canonicalJson(second));
  assert.equal(contentSha256(first), contentSha256(second));
});

test("source rows require unique non-empty stable IDs before destination writes", () => {
  assert.throws(
    () => preflightRows([
      { sourceId: "42", payload: { name: "A" } },
      { sourceId: "42", payload: { name: "B" } }
    ]),
    CboBaselineImportError
  );
  assert.throws(
    () => preflightRows([{ sourceId: " ", payload: { name: "A" } }]),
    CboBaselineImportError
  );
});

test("source projection uses literal allowlisted JSON keys and maps source rows", async () => {
  const queries: string[] = [];
  const query = {
    query: async (sql: string) => {
      queries.push(sql);
      if (sql.includes("pg_catalog.pg_class")) return [{ is_profile_relation: true }];
      if (sql.includes("information_schema.columns")) return [
        { column_name: "source_id" }, { column_name: "organization_name" }, { column_name: "location_name" },
        { column_name: "full_address" }, { column_name: "city" }, { column_name: "state" }, { column_name: "zip_code" },
        { column_name: "location_type" }, { column_name: "website" }, { column_name: "latitude" }, { column_name: "longitude" },
        { column_name: "description" }, { column_name: "source_relation" }
      ];
      return [{ source_id: "42", payload: { name: "Example CBO" } }];
    }
  };
  const rows = await readSourceRows(sourceConfigFromEnv({
    SOURCE_DATABASE_URL: "postgres://private",
    CBO_SOURCE_PROFILE: "chicagohealthmap-public-v1"
  }), query as never);
  assert.deepEqual(rows, [{ sourceId: "42", payload: { name: "Example CBO" } }]);
  assert.match(queries[2], /jsonb_build_object\('organization_name', "organization_name",/);
});

test("direct profile reads only both approved base tables and preserves public source records", async () => {
  const queries: string[] = [];
  const required = {
    community_resource_locations: ["id", "organization_name", "location_type", "full_address", "hyperlink", "latitude", "longitude", "categories", "status", "capacity", "phone", "email", "hours", "languages", "description", "confidence", "sources", "last_verified", "last_enriched", "geom", "created_at", "updated_at"],
    wic_locations: ["wic_id", "location_name", "location_type", "full_address", "city", "state", "zip_code", "county", "fips_state", "fips_county", "phone", "website", "longitude", "latitude", "geom", "source_date", "created_at", "updated_at"]
  };
  const query = {
    query: async (sql: string) => {
      queries.push(sql);
      if (sql.includes("pg_catalog.pg_class")) return [
        { relname: "community_resource_locations" }, { relname: "wic_locations" }
      ];
      if (sql.includes("information_schema.columns")) return Object.entries(required).flatMap(([table_name, columns]) =>
        columns.map((column_name) => ({ table_name, column_name }))
      );
      return [
        { source_id: "community_resource:42", payload: { organization_name: "CBO", phone: "312-555-0100", source_relation: "community_resource_locations", source_record: { id: 42 } } },
        { source_id: "wic:7", payload: { location_name: "WIC", location_type: "wic", source_relation: "wic_locations", source_record: { wic_id: 7 } } }
      ];
    }
  };
  const rows = await readSourceRows(sourceConfigFromEnv({
    SOURCE_DATABASE_URL: "postgres://private",
    CBO_SOURCE_PROFILE: "chicagohealthmap-direct-v2"
  }), query as never);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.payload.phone, "312-555-0100");
  assert.deepEqual(rows[1]?.payload.source_record, { wic_id: 7 });
  assert.match(queries[2]!, /from public\.community_resource_locations resource/);
  assert.match(queries[2]!, /from public\.wic_locations wic/);
  assert.doesNotMatch(queries[2]!, /to_jsonb\(/);
  assert.match(queries[2]!, /'last_verified', resource\.last_verified/);
  assert.match(queries[2]!, /'source_date', wic\.source_date/);
});

test("direct profile fails closed when either approved table or required column is unavailable", async () => {
  const config = sourceConfigFromEnv({
    SOURCE_DATABASE_URL: "postgres://private",
    CBO_SOURCE_PROFILE: "chicagohealthmap-direct-v2"
  });
  await assert.rejects(readSourceRows(config, { query: async () => [{ relname: "community_resource_locations" }] } as never), /tables are unavailable/i);
  await assert.rejects(readSourceRows(config, { query: async (sql: string) => sql.includes("pg_catalog.pg_class")
    ? [{ relname: "community_resource_locations" }, { relname: "wic_locations" }]
    : [] } as never), /columns are unavailable/i);
});

test("baseline refresh promotes only after both source relations are receipted", async () => {
  const { destination, queries } = fakeDestination(true);
  const report = await importCboBaseline(sourceConfig(), {
    readRows: async () => [
      { sourceId: "cbo:1", payload: { source_relation: "community_resource_locations", organization_name: "CBO" } },
      { sourceId: "wic:1", payload: { source_relation: "wic_locations", location_name: "WIC" } }
    ],
    destination: destination as never
  });
  assert.deepEqual(report, { sourceRows: 2, insertedResources: 2, insertedSnapshots: 2, unchanged: 0, skipped: 0, failed: 0 });
  assert.equal(queries.filter((sql) => sql.includes("refresh_source_receipts")).length, 2);
  assert.equal(queries.filter((sql) => sql.includes("promote_refresh_manifest")).length, 1);
});

test("unreconciled refresh is failed and cannot become the active baseline", async () => {
  const { destination, queries } = fakeDestination(false);
  await assert.rejects(
    importCboBaseline(sourceConfig(), {
      readRows: async () => [
        { sourceId: "cbo:1", payload: { source_relation: "community_resource_locations", organization_name: "CBO" } },
        { sourceId: "wic:1", payload: { source_relation: "wic_locations", location_name: "WIC" } }
      ],
      destination: destination as never
    }),
    /did not reconcile/i
  );
  assert.equal(queries.filter((sql) => sql.includes("promote_refresh_manifest")).length, 1);
  assert.ok(queries.some((sql) => sql.includes("set status = 'failed'")));
});
