import assert from "node:assert/strict";
import test from "node:test";
import { createAzureSqlPatch, ExportContractError } from "../src/lib/export/azure-sql.ts";

const mapping = {
  table: "public.community_resource_locations",
  idColumn: "id",
  versionColumn: "updated_at",
  fields: { address: "full_address", phone: "phone" }
};

test("creates a transactional, field-allowlisted Azure PostgreSQL patch", () => {
  const patch = createAzureSqlPatch({
    mapping,
    changes: [{
      candidateId: "candidate-1",
      targetId: "42",
      expectedVersion: "2026-08-13T00:00:00.000Z",
      approvedValues: { address: "123 W Lake St" },
      evidenceIds: ["observation-1"],
      decisionId: "decision-1"
    }]
  });

  assert.match(patch.sql, /^begin;/m);
  assert.match(patch.sql, /update public\.community_resource_locations/);
  assert.match(patch.sql, /full_address = '123 W Lake St'/);
  assert.match(patch.sql, /updated_at = '2026-08-13T00:00:00\.000Z'/);
  assert.match(patch.sql, /commit;/m);
  assert.equal(patch.manifest.changeCount, 1);
});

test("refuses unknown approved fields or missing production mapping", () => {
  assert.throws(() => createAzureSqlPatch({ mapping, changes: [{ candidateId: "c", targetId: "1", expectedVersion: "v", approvedValues: { status: "closed" }, evidenceIds: [], decisionId: "d" }] }), ExportContractError);
  assert.throws(() => createAzureSqlPatch({ mapping: undefined, changes: [] }), ExportContractError);
});
