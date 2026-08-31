import type { CapturedObservation } from "../retrieval/types.ts";

export type DiscoveryDisposition = "duplicate" | "possible_duplicate" | "out_of_scope" | "not_a_cbo" | "insufficient_evidence" | "provider_failure" | "new_resource";
export type DiscoveryLead = { name?: string; address?: string; phone?: string; url?: string; placeId?: string; county?: string };
export type ExistingLocation = { id: string; name?: string; address?: string; phone?: string; url?: string; placeId?: string };

const normalize = (value?: string) => value?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";
const domain = (value?: string) => { try { return value ? new URL(value).hostname.replace(/^www\./, "").toLowerCase() : ""; } catch { return ""; } };

/** Deterministic service-location matching; model output is intentionally absent. */
export function resolveDiscoveryLead(lead: DiscoveryLead, existing: readonly ExistingLocation[], approvedCounties: readonly string[]): { disposition: DiscoveryDisposition; reasons: string[]; matchedIds: string[] } {
  if (!lead.address || !lead.county || !approvedCounties.includes(lead.county)) return { disposition: "out_of_scope", reasons: ["An exact approved-county service address is required."], matchedIds: [] };
  const name = normalize(lead.name), address = normalize(lead.address), phone = normalize(lead.phone), leadDomain = domain(lead.url);
  for (const item of existing) if (lead.placeId && item.placeId === lead.placeId && normalize(item.address) === address) return { disposition: "duplicate", reasons: ["Matching Google Place ID and service address."], matchedIds: [item.id] };
  const ambiguous = existing.filter((item) => {
    const itemAddress = normalize(item.address);
    if (lead.placeId && item.placeId === lead.placeId) return true;
    if (address && itemAddress === address) return Boolean((name && name === normalize(item.name)) || (leadDomain && leadDomain === domain(item.url)) || (phone && phone === normalize(item.phone)));
    return Boolean((leadDomain && leadDomain === domain(item.url)) || (phone && phone === normalize(item.phone)) || (name && name === normalize(item.name)));
  });
  if (ambiguous.length) return { disposition: "possible_duplicate", reasons: ["Location-level identity is ambiguous."], matchedIds: ambiguous.map(({ id }) => id) };
  return { disposition: "insufficient_evidence", reasons: ["Identity is unmatched; corroborating evidence is still required."], matchedIds: [] };
}

export function discoveryEvidenceGate(lead: DiscoveryLead, observations: readonly CapturedObservation[], independentTrustedSources: number, directServiceEvidence: boolean): DiscoveryDisposition {
  if (!lead.name || !lead.address) return "insufficient_evidence";
  if (observations.some(({ state }) => ["timeout", "rate_limited"].includes(state))) return "provider_failure";
  const official = observations.some(({ provider, state }) => provider === "firecrawl" && state === "success");
  return (official && directServiceEvidence && independentTrustedSources >= 1) || independentTrustedSources >= 2 ? "new_resource" : "insufficient_evidence";
}
