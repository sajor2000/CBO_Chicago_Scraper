import assert from "node:assert/strict";
import test from "node:test";
import {
  CboBaselineImportError,
  canonicalJson,
  contentSha256,
  preflightRows,
  readSourceRows,
  sourceConfigFromEnv,
  validateConfig
} from "../src/lib/imports/cbo-baseline.ts";

test("baseline configuration rejects an unqualified table before any database access", () => {
  assert.throws(
    () => sourceConfigFromEnv({
      SOURCE_DATABASE_URL: "postgres://private",
      CBO_SOURCE_NAME: "chicagohealthmap",
      CBO_SOURCE_TABLE: "resources",
      CBO_SOURCE_ID_COLUMN: "id",
      CBO_SOURCE_FIELDS: "name,address"
    }),
    (error: Error) => error instanceof CboBaselineImportError && !error.message.includes("postgres")
  );
});

test("baseline configuration permits only valid, unique public field identifiers", () => {
  assert.throws(
    () => validateConfig({
      databaseUrl: "postgres://private",
      sourceName: "chicagohealthmap",
      table: "public.resources",
      idColumn: "resource_id",
      fields: ["name", "name"]
    }),
    CboBaselineImportError
  );
  assert.throws(
    () => validateConfig({
      databaseUrl: "postgres://private",
      sourceName: "   ",
      table: "public.resources",
      idColumn: "resource_id",
      fields: ["name"]
    }),
    CboBaselineImportError
  );
  assert.throws(
    () => validateConfig({
      databaseUrl: "postgres://private",
      sourceName: "chicagohealthmap",
      table: "pg_catalog.pg_class",
      idColumn: "oid",
      fields: ["relname"]
    }),
    CboBaselineImportError
  );
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
      if (sql.includes("pg_catalog.pg_class")) return [{ is_base_table: true }];
      if (sql.includes("information_schema.columns")) return [{ column_name: "resource_id" }, { column_name: "name" }];
      return [{ source_id: "42", payload: { name: "Example CBO" } }];
    }
  };
  const rows = await readSourceRows({
    databaseUrl: "postgres://private",
    sourceName: "chicagohealthmap",
    table: "public.resources",
    idColumn: "resource_id",
    fields: ["name"]
  }, query as never);
  assert.deepEqual(rows, [{ sourceId: "42", payload: { name: "Example CBO" } }]);
  assert.match(queries[2], /jsonb_build_object\('name', "name"\)/);
});
