import assert from "node:assert/strict";
import test from "node:test";
import {
  CboBaselineImportError,
  canonicalJson,
  contentSha256,
  preflightRows,
  readSourceRows,
  sourceConfigFromEnv
} from "../src/lib/imports/cbo-baseline.ts";

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
