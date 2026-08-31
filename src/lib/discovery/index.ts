import type { CategoryCode } from "../taxonomy/categories.ts";
import type { DiscoveryCounty } from "./query-matrix.ts";

export type DiscoveryDisposition = "candidate_staged" | "duplicate" | "possible_duplicate" | "out_of_scope" | "not_a_cbo" | "insufficient_evidence" | "provider_failure" | "not_processed_budget";
export interface DiscoveryLeadInput { name?: string; address?: string; county?: string; placeId?: string; phone?: string; website?: string; category?: CategoryCode; comparisonId?: string }
export interface NormalizedDiscoveryLead extends DiscoveryLeadInput { normalizedName: string; normalizedAddress: string; normalizedPhone: string; canonicalDomain: string }
export interface IdentityResolution { outcome: "duplicate" | "possible_duplicate" | "unmatched"; reasons: string[]; matches: string[] }
export interface CorroboratingEvidence { publisher: string; official: boolean; trusted: boolean; eligibilityAuthority: boolean; exactAddress: boolean; directService: boolean; cboEligible: boolean; category?: CategoryCode }

const compact = (value?: string) => value?.normalize("NFKD").toLowerCase().replace(/\b(inc|llc|nfp|nonprofit|organization|the)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim() ?? "";
const address = (value?: string) => compact(value).replace(/\b(street|st)\b/g, "st").replace(/\b(avenue|ave)\b/g, "ave").replace(/\b(road|rd)\b/g, "rd");
const phone = (value?: string) => (value ?? "").replace(/\D/g, "").slice(-10);
const domain = (value?: string) => { try { return value ? new URL(value).hostname.toLowerCase().replace(/^www\./, "") : ""; } catch { return ""; } };

export const normalizeDiscoveryLead = (lead: DiscoveryLeadInput): NormalizedDiscoveryLead => ({ ...lead, normalizedName: compact(lead.name), normalizedAddress: address(lead.address), normalizedPhone: phone(lead.phone), canonicalDomain: domain(lead.website) });

export function resolveLocationIdentity(lead: NormalizedDiscoveryLead, locations: readonly NormalizedDiscoveryLead[]): IdentityResolution {
  const exact: string[] = [];
  const ambiguous: string[] = [];
  const reasons = new Set<string>();
  locations.forEach((candidate, index) => {
    const samePlace = Boolean(lead.placeId && candidate.placeId && lead.placeId === candidate.placeId);
    const sameAddress = Boolean(lead.normalizedAddress && lead.normalizedAddress === candidate.normalizedAddress);
    const sameName = Boolean(lead.normalizedName && lead.normalizedName === candidate.normalizedName);
    const sameDomain = Boolean(lead.canonicalDomain && lead.canonicalDomain === candidate.canonicalDomain);
    const samePhone = Boolean(lead.normalizedPhone && lead.normalizedPhone === candidate.normalizedPhone);
    const comparisonId = candidate.comparisonId ?? `comparison:${index}`;
    if (samePlace && (!lead.normalizedAddress || !candidate.normalizedAddress || sameAddress)) { exact.push(comparisonId); reasons.add("same_place_id"); return; }
    if (sameAddress && (sameName || sameDomain || samePhone)) { exact.push(comparisonId); reasons.add("same_address_and_identity"); return; }
    if ((samePlace && !sameAddress) || (sameAddress && !sameName) || sameDomain || samePhone || sameName) { ambiguous.push(comparisonId); reasons.add(samePlace ? "place_address_conflict" : sameAddress ? "address_identity_conflict" : sameDomain || samePhone ? "organization_signal_without_location_match" : "similar_name"); }
  });
  if (exact.length) return { outcome: "duplicate", reasons: [...reasons], matches: exact };
  if (ambiguous.length) return { outcome: "possible_duplicate", reasons: [...reasons], matches: ambiguous };
  return { outcome: "unmatched", reasons: [], matches: [] };
}

const inScope = new Set<DiscoveryCounty>(["Cook", "DuPage", "Kane", "Kendall", "Lake", "McHenry", "Will"]);
export function evaluateDiscoveryLead(input: { lead: NormalizedDiscoveryLead; identity: IdentityResolution; evidence: readonly CorroboratingEvidence[] }): { disposition: DiscoveryDisposition; reasons: string[] } {
  if (input.identity.outcome !== "unmatched") return { disposition: input.identity.outcome, reasons: input.identity.reasons };
  if (!input.lead.county || !inScope.has(input.lead.county.replace(/\s+County$/i, "") as DiscoveryCounty)) return { disposition: "out_of_scope", reasons: ["structured_county_not_in_scope"] };
  if (!input.lead.normalizedAddress) return { disposition: "insufficient_evidence", reasons: ["missing_exact_service_address"] };
  const qualified = input.evidence.filter((item) => (item.official || item.trusted) && item.exactAddress && item.directService && (!input.lead.category || item.category === input.lead.category));
  if (input.evidence.some((item) => (item.official || item.trusted || item.eligibilityAuthority) && item.exactAddress && item.directService && item.eligibilityAuthority && !item.cboEligible)) return { disposition: "not_a_cbo", reasons: ["location_linked_eligibility_evidence_failed"] };
  if (!input.evidence.some((item) => item.eligibilityAuthority && item.exactAddress && item.cboEligible)) return { disposition: "insufficient_evidence", reasons: ["eligibility_gate_failed"] };
  const officialPublishers = new Set(qualified.filter((item) => item.official).map((item) => item.publisher.toLowerCase()));
  const trustedPublishers = new Set(qualified.filter((item) => item.trusted).map((item) => item.publisher.toLowerCase()));
  const independentOfficialAndTrusted = officialPublishers.size > 0 && [...trustedPublishers].some((publisher) => !officialPublishers.has(publisher));
  if (!independentOfficialAndTrusted && trustedPublishers.size < 2) return { disposition: "insufficient_evidence", reasons: ["corroboration_gate_failed"] };
  return { disposition: "candidate_staged", reasons: ["deterministic_gates_passed"] };
}
