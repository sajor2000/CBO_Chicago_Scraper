import { ExaClient, FirecrawlClient, GooglePlacesClient, IrsClient, TavilyClient, TrustedDirectoryClient } from "../providers/index.ts";
import { hostedEvidenceFromEnv } from "../providers/hosted-evidence.ts";
import { reviewRepository } from "../repositories/review.ts";
import { assertSafeOutboundUrl, UnsafeOutboundUrlError } from "../security/outbound-url.ts";
import type { CapturedObservation } from "../retrieval/types.ts";
import { evaluateDiscoveryLead, normalizeDiscoveryLead, resolveLocationIdentity, type CorroboratingEvidence, type DiscoveryDisposition } from "./index.ts";
import { discoveryRepository } from "./repository.ts";

const retryable = new Set(["timeout", "rate_limited", "unavailable"]);
const serviceTerms: Record<string, readonly string[]> = {
  food_access: ["food pantry", "food assistance", "groceries"], clinic_fqhc: ["health center", "clinic", "primary care"],
  shelter_housing: ["shelter", "housing assistance"], mental_health: ["mental health", "counseling"], substance_use: ["substance use", "addiction treatment"],
  benefits: ["benefits assistance", "public benefits"], transportation: ["transportation"], domestic_violence_crisis: ["domestic violence", "crisis"],
  immigrant_refugee_support: ["immigrant", "refugee"], wic: ["wic", "women infants children"]
};

const publicDomain = (value?: string) => { try { return value ? new URL(value).hostname.toLowerCase().replace(/^www\./, "") : ""; } catch { return ""; } };
const sanitizedUrl = (value?: string) => { try { const url=value?new URL(value):undefined;if(!url||!['http:','https:'].includes(url.protocol)||url.username||url.password)return undefined;url.search='';url.hash='';return url.toString().slice(0,500); } catch{return undefined;} };
const evidenceFor = (lead: ReturnType<typeof normalizeDiscoveryLead>, observations: CapturedObservation[]): CorroboratingEvidence[] => observations.flatMap((observation) => {
  if (observation.state !== "success") return [];
  const source = `${observation.excerpt ?? ""} ${observation.values?.address ?? ""} ${observation.values?.name ?? ""}`.toLowerCase();
  const normalizedSourceAddress = normalizeDiscoveryLead({ address: source }).normalizedAddress;
  const publisher = publicDomain(observation.publisherUrl ?? observation.sourceUrl ?? observation.values?.url);
  if (!publisher) return [];
  const terms = lead.category ? serviceTerms[lead.category] ?? [] : [];
  const official = observation.provider === "firecrawl" && Boolean(lead.canonicalDomain && publicDomain(observation.sourceUrl) === lead.canonicalDomain);
  const trusted = observation.provider === "trusted_directory";
  const negativeEligibility = /for[- ]profit|worship service|advocacy only/.test(source);
  const eligibilityAuthority = trusted || observation.provider === "irs" || (official && /nonprofit|not[- ]for[- ]profit|501\s*\(?c\)?\s*\(?3\)?|community[- ]based organization/.test(source));
  return [{ publisher, official, trusted, eligibilityAuthority, exactAddress: Boolean(lead.normalizedAddress && normalizedSourceAddress.includes(lead.normalizedAddress)), directService: terms.some((term) => source.includes(term)), cboEligible: eligibilityAuthority && !negativeEligibility, category: lead.category }];
});

function clientsFromEnv() {
  const googleKey = process.env.GOOGLE_MAPS_API_KEY;
  const searchKey = process.env.EXA_API_KEY || process.env.TAVILY_API_KEY;
  const firecrawlKey = process.env.FIRECRAWL_API_KEY;
  const directoryEndpoint = process.env.TRUSTED_DIRECTORY_SEARCH_ENDPOINT;
  if (!googleKey || !searchKey || !firecrawlKey || !directoryEndpoint) throw new Error("Discovery providers and the approved trusted-directory endpoint are not configured.");
  return {
    google: new GooglePlacesClient({ apiKey: googleKey }),
    search: process.env.EXA_API_KEY ? new ExaClient({ apiKey: searchKey }) : new TavilyClient({ apiKey: searchKey }),
    firecrawl: new FirecrawlClient({ apiKey: firecrawlKey, interactAllowlist: (process.env.FIRECRAWL_INTERACT_ALLOWLIST ?? "").split(",").map((value) => value.trim()).filter(Boolean) }),
    irs: process.env.IRS_SEARCH_ENDPOINT ? new IrsClient({ endpoint: process.env.IRS_SEARCH_ENDPOINT }) : undefined,
    directory: new TrustedDirectoryClient({ endpoint: directoryEndpoint })
  };
}

export function assertDiscoveryProvidersConfigured():void { void clientsFromEnv(); }

async function charged<T>(runId: string, work: () => Promise<T>): Promise<T> {
  if (!(await discoveryRepository.consumeProviderCall(runId))) throw new Error("DISCOVERY_BUDGET_EXHAUSTED");
  return work();
}

export async function executeDiscoveryCheckpoint(runId: string): Promise<{ done: boolean; state?: string; message?: string }> {
  const claim = await discoveryRepository.claimNext(runId);
  if (!claim) return { done: true, message: "No discovery checkpoint is currently claimable." };
  try {
    const clients = clientsFromEnv();
    if (claim.kind === "query_cell") {
      const query = claim.query!;
      const captures = await charged(runId, () => query.provider === "google_places" ? clients.google.searchDiscovery(query.query, { maxResults: query.resultCap }) : clients.search.searchDiscovery(query.query, { maxResults: query.resultCap }));
      const failure = captures.find((capture) => capture.state !== "success" && capture.state !== "no_result");
      if (failure && retryable.has(failure.state) && claim.attempt < 3) {
        await discoveryRepository.recordQueryAttempt({runId,queryCellId:claim.queryCellId!,leaseToken:claim.leaseToken,attempt:claim.attempt,requestId:failure.requestId,resultProvenance:captures.map(({provider,state,rank,sourceUrl})=>({provider,state,rank,sourceUrl:sanitizedUrl(sourceUrl)}))});
        await discoveryRepository.retry(runId, claim.leaseToken, claim.attempt); return { done: false, state: failure.state };
      }
      if (failure) { await discoveryRepository.completeQuery({ runId, queryCellId: claim.queryCellId!, leaseToken: claim.leaseToken, attempt: claim.attempt, outcome: "provider_failure", leadCount: 0, requestId: failure.requestId, resultProvenance: captures.map(({provider,state,rank,sourceUrl})=>({provider,state,rank,sourceUrl})) }); return { done: false, state: "provider_failure" }; }
      const comparisons = await discoveryRepository.comparisonLocations();
      let leadCount = 0;
      for (const capture of captures.filter((item) => item.state === "success")) {
        let website=capture.values?.url;
        if(website){try{await assertSafeOutboundUrl(website);website=sanitizedUrl(website);}catch{website=undefined;}}
        const lead = normalizeDiscoveryLead({ name: capture.values?.name, address: capture.values?.address, county: capture.values?.county, placeId: capture.values?.placeId, phone: capture.values?.phone, website, category: query.category });
        leadCount += 1;
        const identity = resolveLocationIdentity(lead, comparisons);
        let disposition: DiscoveryDisposition | undefined;
        let reasons: string[] = [];
        if (identity.outcome !== "unmatched") { disposition = identity.outcome; reasons = identity.reasons; }
        else if (!lead.normalizedAddress || !lead.county) { disposition = "insufficient_evidence"; reasons = [!lead.normalizedAddress ? "missing_exact_service_address" : "missing_structured_county"]; }
        const persisted = await discoveryRepository.appendLead({ runId, queryCellId: claim.queryCellId!, lead, observation: capture, disposition, reasons, evidenceSummary: identity.outcome === "unmatched" ? {} : { identityPolicyVersion: "service-location-v1", matchedLocationIds: identity.matches } });
        comparisons.push({ ...lead, comparisonId: `evaluation:${persisted.evaluationId}` });
      }
      await discoveryRepository.completeQuery({ runId, queryCellId: claim.queryCellId!, leaseToken: claim.leaseToken, attempt: claim.attempt, outcome: "query_expanded", leadCount, requestId: captures.find((capture)=>capture.requestId)?.requestId, resultProvenance: captures.map(({provider,state,rank,sourceUrl,values})=>({provider,state,rank,sourceUrl:sanitizedUrl(sourceUrl),placeId:values?.placeId,address:values?.address,name:values?.name})) });
      return { done: false, state: leadCount ? "query_expanded" : "zero_yield" };
    }

    const lead = claim.lead!;
    const observations: CapturedObservation[] = [];
    if (lead.website) {
      try { observations.push(await charged(runId, () => clients.firecrawl.scrape(lead.website!, { allowInteract: true }))); }
      catch (error) {
        if (!(error instanceof UnsafeOutboundUrlError)) throw error;
        observations.push({ provider: "firecrawl", state: "blocked", observedAt: new Date().toISOString() });
      }
    }
    const corroborationQuery = [lead.name, lead.address].filter(Boolean).join(", ");
    observations.push(...await charged(runId, () => clients.search.searchDiscovery(corroborationQuery, { maxResults: 3 })));
    if (clients.directory) observations.push(await charged(runId, () => clients.directory!.search(corroborationQuery)));
    if (clients.irs) observations.push(await charged(runId, () => clients.irs!.search(corroborationQuery)));
    for(const observation of observations){if(observation.sourceUrl){try{await assertSafeOutboundUrl(observation.sourceUrl);observation.sourceUrl=sanitizedUrl(observation.sourceUrl);}catch{observation.sourceUrl=undefined;}}}
    await discoveryRepository.recordLeadObservations({runId,evaluationId:claim.evaluationId!,leaseToken:claim.leaseToken,observations});
    const retryableFailure=observations.find((observation)=>retryable.has(observation.state));
    if(retryableFailure){
      if(claim.attempt<3){await discoveryRepository.retry(runId,claim.leaseToken,claim.attempt);return{done:false,state:retryableFailure.state};}
      await discoveryRepository.recordDisposition({runId,evaluationId:claim.evaluationId!,leaseToken:claim.leaseToken,disposition:"provider_failure",reasons:[`${retryableFailure.provider}:${retryableFailure.state}`]});
      return{done:false,state:"provider_failure"};
    }
    const deterministic = evaluateDiscoveryLead({ lead, identity: { outcome: "unmatched", reasons: [], matches: [] }, evidence: evidenceFor(lead, observations) });
    if (deterministic.disposition !== "candidate_staged") {
      await discoveryRepository.recordDisposition({ runId, evaluationId: claim.evaluationId!, leaseToken: claim.leaseToken, disposition: deterministic.disposition, reasons: deterministic.reasons, evidenceSummary: { providers: observations.map((item) => ({ provider: item.provider, state: item.state })) } });
      return { done: false, state: deterministic.disposition };
    }
    let advisory;
    let advisoryUnavailable = false;
    try {
      if (!(await discoveryRepository.consumeProviderCall(runId))) throw new Error("DISCOVERY_BUDGET_EXHAUSTED");
      advisory = await hostedEvidenceFromEnv().score({ id: claim.evaluationId!, name: lead.name ?? "", address: lead.address, phone: lead.phone, url: lead.website }, observations);
    } catch { advisoryUnavailable = true; }
    const proposedValues = Object.fromEntries(Object.entries({ organization_name: lead.name, address: lead.address, county: lead.county, phone: lead.phone, website: lead.website, category: lead.category }).filter((entry): entry is [string, string] => typeof entry[1] === "string" && Boolean(entry[1])));
    const candidate = await reviewRepository.stageDiscoveryCandidate({ runId, evaluationId: claim.evaluationId!, leaseToken: claim.leaseToken, proposedValues, observations, advisory, advisoryUnavailable, duplicateScreen: { outcome: "unmatched", policyVersion: "service-location-v1", evaluationId: claim.evaluationId } });
    await discoveryRepository.recordDisposition({ runId, evaluationId: claim.evaluationId!, leaseToken: claim.leaseToken, disposition: "candidate_staged", reasons: deterministic.reasons, advisoryState: advisoryUnavailable ? "advisory_unavailable" : "available", candidateId: candidate.id });
    return { done: false, state: "candidate_staged" };
  } catch (error) {
    if (error instanceof Error && error.message === "DISCOVERY_BUDGET_EXHAUSTED") {
      await discoveryRepository.pauseForBudget(runId, claim.leaseToken);
      return { done: false, state: "budget_exhausted" };
    }
    await discoveryRepository.retry(runId, claim.leaseToken, claim.attempt);
    throw error;
  }
}
