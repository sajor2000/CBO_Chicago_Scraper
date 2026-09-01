import assert from "node:assert/strict";
import test from "node:test";
import { discoveryEvidenceGate, resolveDiscoveryLead } from "../src/lib/discovery/index.ts";

test("exact Place ID and address is a duplicate, while shared organization identity is only possible duplicate", () => {
  const existing = [{ id: "a", name: "Example Pantry", address: "1 Main St", phone: "312 555 0100", url: "https://example.org", placeId: "place-a" }];
  assert.equal(resolveDiscoveryLead({ name: "Example Pantry", address: "1 Main St", county: "Cook", placeId: "place-a" }, existing, ["Cook"]).disposition, "duplicate");
  assert.equal(resolveDiscoveryLead({ name: "Example Pantry", address: "1 Main St", county: "Cook" }, existing, ["Cook"]).disposition, "possible_duplicate");
  assert.equal(resolveDiscoveryLead({ name: "Example Pantry West", address: "9 Lake St", county: "Cook", phone: "312 555 0100" }, existing, ["Cook"]).disposition, "possible_duplicate");
  assert.equal(resolveDiscoveryLead({ name: "New Pantry", address: "9 Lake St", county: "Lake" }, existing, ["Cook"]).disposition, "out_of_scope");
});

test("only corroborated deterministic evidence can stage a new resource", () => {
  const lead = { name: "New Pantry", address: "9 Lake St" };
  assert.equal(discoveryEvidenceGate(lead, [{ provider: "firecrawl", state: "success", observedAt: "2026-08-30T00:00:00Z" }], 1, true), "candidate_staged");
  assert.equal(discoveryEvidenceGate(lead, [{ provider: "tavily", state: "success", observedAt: "2026-08-30T00:00:00Z" }], 1, true), "insufficient_evidence");
  assert.equal(discoveryEvidenceGate(lead, [{ provider: "firecrawl", state: "rate_limited", observedAt: "2026-08-30T00:00:00Z" }], 2, true), "provider_failure");
});
