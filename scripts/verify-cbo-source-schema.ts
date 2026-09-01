import { CboSourceSchemaError, verifyCboSourceSchema } from "../src/lib/imports/cbo-source-schema.ts";

try {
  const rows = await verifyCboSourceSchema(process.env.SOURCE_DATABASE_URL);
  console.log(`CBO source schema verified (${new Set(rows.map((row) => row.table_name)).size} relations; ${rows.length} columns).`);
} catch (error) {
  console.error(error instanceof CboSourceSchemaError ? error.message : "CBO source-schema verification failed.");
  process.exitCode = 1;
}
