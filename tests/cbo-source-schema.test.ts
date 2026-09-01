import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertSourceSchema, sourceRelations, sourceSchemaContract, verifyCboSourceSchema, type SourceColumnMetadata } from "../src/lib/imports/cbo-source-schema.ts";

const fixture = (): SourceColumnMetadata[] => sourceRelations.flatMap((table_name) => sourceSchemaContract[table_name].map((column) => ({ table_name, ...column })));

test("source inspector verifies the complete metadata-only contract", async () => {
  let sql = "";
  const query = { query: async (statement: string) => {
    sql = statement;
    return fixture();
  } };
  await verifyCboSourceSchema("postgresql://reader@example.test/db", query as never);
  assert.match(sql, /information_schema\.columns/);
  assert.match(sql, /pg_catalog\.format_type/);
  assert.match(sql, /any\(\$1::text\[\]\)/);
});

for (const [name, change] of Object.entries({
  case: (rows: SourceColumnMetadata[]) => { rows[0]!.name = "ID"; },
  order: (rows: SourceColumnMetadata[]) => { [rows[0]!.ordinal, rows[1]!.ordinal] = [2, 1]; },
  missing: (rows: SourceColumnMetadata[]) => { rows.pop(); },
  extra: (rows: SourceColumnMetadata[]) => { rows.push({ ...rows[0]!, name: "unexpected", ordinal: 99 }); },
  type: (rows: SourceColumnMetadata[]) => { rows[0]!.type = "bigint"; },
  nullability: (rows: SourceColumnMetadata[]) => { rows[0]!.nullable = true; },
  geometry_srid: (rows: SourceColumnMetadata[]) => { rows.find((row) => row.name === "geom")!.type = "geometry(Point,3857)"; }
})) {
  test(`source inspector rejects ${name} drift`, () => {
    const rows = fixture();
    change(rows);
    assert.throws(() => assertSourceSchema(rows), /schema drift/);
  });
}

test("schema reference contains every checked-in source field and type", () => {
  const reference = readFileSync(new URL("../docs/data/cbo-source-schema.md", import.meta.url), "utf8");
  for (const relation of sourceRelations) for (const column of sourceSchemaContract[relation]) {
    assert.match(reference, new RegExp("\\| " + column.ordinal + " \\| `" + column.name + "` \\| `" + column.type.replace(/[()]/g, "\\$&") + "`"));
  }
});
