import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CboSourceProfileError,
  profileCboSource,
  sourceProfileConfigFromEnv
} from "../src/lib/imports/cbo-source-profile.ts";

const config = {
  databaseUrl: "postgres://private-source",
  table: "public.resources",
  idColumn: "resource_id"
};

test("profiles a base relation with metadata and aggregate ID checks only", async () => {
  const queries: string[] = [];
  const query = {
    query: async (sql: string) => {
      queries.push(sql);
      if (sql.includes("pg_catalog.pg_class")) return [{ relkind: "r" }];
      if (sql.includes("information_schema.columns")) {
        return [{ column_name: "resource_id", data_type: "uuid", udt_name: "uuid", is_nullable: "NO", ordinal_position: 1 }];
      }
      return [{ total_rows: "12", null_id_rows: "1", duplicate_id_rows: "2" }];
    }
  };

  const report = await profileCboSource(config, query as never);

  assert.deepEqual(report, {
    relation: "public.resources",
    relationKind: "base_table",
    idColumn: "resource_id",
    columns: [{ name: "resource_id", dataType: "uuid", nullable: false }],
    idCandidates: ["resource_id"],
    totalRows: 12,
    nullIdRows: 1,
    duplicateIdRows: 2
  });
  assert.equal(queries.length, 3);
  assert.match(queries[2]!, /count\(\*\)/i);
  assert.doesNotMatch(queries[2]!, /select\s+\*/i);
});

test("rejects system schemas and missing relations before aggregate data queries", async () => {
  assert.throws(
    () => sourceProfileConfigFromEnv({ SOURCE_DATABASE_URL: "postgres://private-source", CBO_SOURCE_TABLE: "pg_catalog.pg_class", CBO_SOURCE_ID_COLUMN: "oid" }),
    (error: Error) => error instanceof CboSourceProfileError && !error.message.includes("postgres")
  );

  const queries: string[] = [];
  await assert.rejects(
    () => profileCboSource(config, { query: async (sql: string) => { queries.push(sql); return []; } } as never),
    CboSourceProfileError
  );
  assert.equal(queries.length, 1);
});

test("profiles only the approved normalized view and never includes source details in failures", async () => {
  const viewConfig = { ...config, table: "public.cbo_public_directory_v1", idColumn: "source_id" };
  const approvedQuery = {
    query: async (sql: string) => {
      if (sql.includes("pg_catalog.pg_class")) return [{ relkind: "v" }];
      if (sql.includes("information_schema.columns")) return [{ column_name: "source_id", data_type: "text", udt_name: "text", is_nullable: "NO", ordinal_position: 1 }];
      return [{ total_rows: "0", null_id_rows: "0", duplicate_id_rows: "0" }];
    }
  };
  assert.equal((await profileCboSource(viewConfig, approvedQuery as never)).relationKind, "normalized_view");

  const query = {
    query: async (sql: string) => {
      if (sql.includes("pg_catalog.pg_class")) return [{ relkind: "v" }];
      if (sql.includes("information_schema.columns")) return [];
      throw new Error("Example CBO, 1 Main St, postgres://private-source");
    }
  };
  await assert.rejects(
    () => profileCboSource(viewConfig, query as never),
    (error: Error) => error instanceof CboSourceProfileError && !error.message.includes("private-source") && !error.message.includes("Example CBO")
  );

  await assert.rejects(
    () => profileCboSource({ ...config, table: "public.unapproved_view" }, { query: async () => [{ relkind: "v" }] } as never),
    CboSourceProfileError
  );
});

test("source-profile documentation links to the checked-in view SQL", () => {
  const profile = readFileSync(new URL("../docs/data/cbo-source-profile.md", import.meta.url), "utf8");
  assert.match(profile, /\.\.\/\.\.\/sql\/source\/cbo_public_directory_v1\.sql/);
});
