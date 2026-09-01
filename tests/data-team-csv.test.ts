import assert from "node:assert/strict";
import test from "node:test";
import { createDataTeamCsv } from "../src/lib/export/data-team-csv.ts";

test("CBO handoff preserves the source schema and applies only approved aliases safely", () => {
  const csv = createDataTeamCsv("community_resource_locations", [{ sourceRecord: { id: 4, organization_name: "Original", full_address: "Old", phone: "312", categories: ["food"] }, approvedValues: { address: " =formula", phone: '"new"\nline' } }]);
  assert.match(csv, /^"id","organization_name","location_type","full_address","hyperlink","latitude","longitude","categories","status","capacity","phone","email","hours","languages","description","confidence","sources","last_verified","last_enriched","geom","created_at","updated_at"/);
  assert.match(csv, /^.*\r\n"4","Original","","' =formula"/s);
  assert.match(csv, /"""new""\nline"/);
  assert.doesNotMatch(csv, /candidate_id|AZURE_EXPORT_MAPPING_JSON/);
});

test("handoff rejects an approved field absent from the selected source schema", () => {
  assert.throws(() => createDataTeamCsv("wic_locations", [{ sourceRecord: { wic_id: 7 }, approvedValues: { status: "closed" } }]), /not part of wic_locations/);
});
