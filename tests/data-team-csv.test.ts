import assert from "node:assert/strict";
import test from "node:test";
import { createDataTeamCsv, validateDataTeamCsv } from "../src/lib/export/data-team-csv.ts";
import { directSourceColumns } from "../src/lib/imports/cbo-source-schema.ts";

test("CBO handoff preserves the source schema and applies only approved aliases safely", () => {
  const csv = createDataTeamCsv("community_resource_locations", [{ sourceRecord: { id: 4, organization_name: "Original", full_address: "Old", phone: "312", categories: ["food"] }, approvedValues: { address: " =formula", name: "Renamed", website: "https://example.test", phone: '"new"\nline' } }]);
  assert.match(csv, /^"id","organization_name","location_type","full_address","hyperlink","latitude","longitude","categories","status","capacity","phone","email","hours","languages","description","confidence","sources","last_verified","last_enriched","geom","created_at","updated_at"/);
  assert.match(csv, /^.*\r\n"4","Renamed","","' =formula"/s);
  assert.match(csv, /"""new""\nline"/);
  assert.match(csv, /"Renamed"/);
  assert.match(csv, /"https:\/\/example\.test"/);
  assert.doesNotMatch(csv, /candidate_id|AZURE_EXPORT_MAPPING_JSON/);
});

test("handoff rejects an approved field absent from the selected source schema", () => {
  assert.throws(() => createDataTeamCsv("wic_locations", [{ sourceRecord: { wic_id: 7 }, approvedValues: { status: "closed" } }]), /not part of wic_locations/);
});

test("WIC handoff has every exact source column and accepts only its approved aliases", () => {
  const csv = createDataTeamCsv("wic_locations", [{
    sourceRecord: { wic_id: 7, location_name: "WIC, North", longitude: -87.6, latitude: 41.9, website: "https://old.example" },
    approvedValues: { address: "1 Main\nChicago", name: "WIC \"North\"" }
  }]);
  assert.match(csv, new RegExp(`^${directSourceColumns.wic_locations.map((column) => `"${column}"`).join(",")}`));
  assert.match(csv, /"https:\/\/old\.example","-87.6","41.9","","","",""/);
  assert.match(csv, /WIC ""North""/);
  assert.match(csv, /1 Main\nChicago/);
});

test("handoff refuses missing source keys, populated geometry, and malformed final CSV", () => {
  assert.throws(() => createDataTeamCsv("community_resource_locations", [{ sourceRecord: {}, approvedValues: {} }]), /required source key/);
  assert.throws(() => createDataTeamCsv("wic_locations", [{ sourceRecord: { wic_id: 7, location_name: "WIC", longitude: 0, latitude: 0, geom: "POINT(0 0)" }, approvedValues: {} }]), /geom must remain blank/);
  assert.throws(() => validateDataTeamCsv("wic_locations", '"wic_id"\r\n', 0), /header or row count/);
});
