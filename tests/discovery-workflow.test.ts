import assert from "node:assert/strict";
import test from "node:test";
import { evaluateDiscoveryLead, normalizeDiscoveryLead, resolveLocationIdentity } from "../src/lib/discovery/index.ts";

test("identity rules distinguish exact locations from organization-level ambiguity", () => {
  const current = { name: "Community Pantry", address: "1 Main St, Chicago, IL 60601", placeId: "p1", phone: "312-555-0100", website: "https://pantry.org" };
  assert.equal(resolveLocationIdentity(normalizeDiscoveryLead(current), [normalizeDiscoveryLead(current)]).outcome, "duplicate");
  assert.deepEqual(resolveLocationIdentity(normalizeDiscoveryLead(current), [normalizeDiscoveryLead({ ...current, comparisonId: "resource:known" })]).matches, ["resource:known"]);
  assert.equal(resolveLocationIdentity(normalizeDiscoveryLead({ ...current, placeId: undefined, address: "2 Main St, Chicago, IL 60601" }), [normalizeDiscoveryLead(current)]).outcome, "possible_duplicate");
  assert.equal(resolveLocationIdentity(normalizeDiscoveryLead({ name: "Other Pantry", address: "3 Main St, Chicago, IL 60601" }), [normalizeDiscoveryLead(current)]).outcome, "unmatched");
});

test("only corroborated exact in-scope direct service leads qualify", () => {
  const lead = normalizeDiscoveryLead({ name: "South Pantry", address: "10 State St, Chicago, IL 60605", county: "Cook", website: "https://south.example", category: "food_access" });
  const qualified = evaluateDiscoveryLead({ lead, identity: { outcome: "unmatched", reasons: [], matches: [] }, evidence: [
    { publisher: "south.example", official: true, trusted: false, eligibilityAuthority: false, exactAddress: true, directService: true, cboEligible: false, category: "food_access" },
    { publisher: "cookcountyil.gov", official: false, trusted: true, eligibilityAuthority: true, exactAddress: true, directService: true, cboEligible: true, category: "food_access" }
  ] });
  assert.equal(qualified.disposition, "candidate_staged");
  assert.equal(evaluateDiscoveryLead({ lead: { ...lead, county: "Lake County, IN" }, identity: { outcome: "unmatched", reasons: [], matches: [] }, evidence: [] }).disposition, "out_of_scope");
  assert.equal(evaluateDiscoveryLead({ lead: { ...lead, address: undefined, normalizedAddress: "" }, identity: { outcome: "unmatched", reasons: [], matches: [] }, evidence: [] }).disposition, "insufficient_evidence");
  assert.equal(evaluateDiscoveryLead({ lead, identity: { outcome: "unmatched", reasons: [], matches: [] }, evidence: [{ publisher: "south.example", official: true, trusted: false, eligibilityAuthority: true, exactAddress: true, directService: true, cboEligible: true, category: "food_access" }] }).disposition, "insufficient_evidence");
  assert.equal(evaluateDiscoveryLead({ lead, identity: { outcome: "unmatched", reasons: [], matches: [] }, evidence: [
    { publisher: "search-one.example", official: false, trusted: false, eligibilityAuthority: false, exactAddress: true, directService: true, cboEligible: false, category: "food_access" },
    { publisher: "search-two.example", official: false, trusted: false, eligibilityAuthority: false, exactAddress: true, directService: true, cboEligible: false, category: "food_access" }
  ] }).disposition, "insufficient_evidence");
});
