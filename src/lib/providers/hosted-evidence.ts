import { azureOpenAiScorerFromEnv, CBO_AUDIT_PROMPT_VERSION } from "../ai/azure-openai.ts";
import type { CapturedObservation } from "../retrieval/types.ts";
import { matchesIdentity, type ReferenceResource } from "../verification/index.ts";
import { ExaClient, FirecrawlClient, GooglePlacesClient, IrsClient, TavilyClient, TrustedDirectoryClient } from "./index.ts";

const bounded = (value: string | undefined, maximum: number) => value?.slice(0, maximum);

/** Google Text Search can return a nearby but unrelated first result. */
export const observationsForScoring = (resource: ReferenceResource, observations: CapturedObservation[]) => observations.filter((observation) =>
  observation.provider !== "google_places" || !observation.values?.name || matchesIdentity(resource, observation.values)
);

/** Fixed, bounded evidence envelope: model input cannot alter collection scope. */
export function formatAuditEvidence(observations: CapturedObservation[]): string {
  return JSON.stringify(observations.slice(0, 5).map((observation) => ({
    provider: observation.provider,
    state: observation.state,
    observedAt: bounded(observation.observedAt, 40),
    sourceUrl: bounded(observation.sourceUrl, 200),
    excerpt: bounded(observation.excerpt, 300),
    values: observation.values && {
      name: bounded(observation.values.name, 80),
      address: bounded(observation.values.address, 140),
      phone: bounded(observation.values.phone, 40),
      url: bounded(observation.values.url, 200),
      businessStatus: observation.values.businessStatus
    }
  })));
}

export async function collectHostedEvidence(input: {
  resource: ReferenceResource;
  firecrawl: Pick<FirecrawlClient, "scrape">;
  google: Pick<GooglePlacesClient, "search">;
  search: Pick<TavilyClient | ExaClient, "search">;
  irs?: Pick<IrsClient, "search">;
  directory?: Pick<TrustedDirectoryClient, "search">;
}): Promise<CapturedObservation[]> {
  const query = [input.resource.name, input.resource.address].filter(Boolean).join(", ");
  const [google, search, irs, directory] = await Promise.all([
    input.google.search(query), input.search.search(query, { maxResults: 3 }), input.irs?.search(query), input.directory?.search(query)
  ]);
  // Search output is untrusted discovery evidence, never an instruction to expand scrape scope.
  const officialUrl = input.resource.url;
  const firecrawl = officialUrl ? await input.firecrawl.scrape(officialUrl, { allowInteract: true }) : {
    provider: "firecrawl" as const, state: "no_result" as const, observedAt: new Date().toISOString()
  };
  return [firecrawl, google, search, ...(irs ? [irs] : []), ...(directory ? [directory] : [])];
}

export function hostedEvidenceFromEnv() {
  const firecrawlKey = process.env.FIRECRAWL_API_KEY;
  const googleKey = process.env.GOOGLE_MAPS_API_KEY;
  const searchKey = process.env.EXA_API_KEY || process.env.TAVILY_API_KEY;
  if (!firecrawlKey || !googleKey || !searchKey) throw new Error("Firecrawl, Google Places, and one search fallback must be configured before a hosted run can execute.");
  const scorer = azureOpenAiScorerFromEnv();
  const allowlist = (process.env.FIRECRAWL_INTERACT_ALLOWLIST ?? "").split(",").map((domain) => domain.trim()).filter(Boolean);
  return {
    collect: (resource: ReferenceResource) => collectHostedEvidence({
      resource,
      firecrawl: new FirecrawlClient({ apiKey: firecrawlKey, interactAllowlist: allowlist }),
      google: new GooglePlacesClient({ apiKey: googleKey }),
      search: process.env.EXA_API_KEY ? new ExaClient({ apiKey: searchKey }) : new TavilyClient({ apiKey: searchKey }),
      irs: process.env.IRS_SEARCH_ENDPOINT ? new IrsClient({ endpoint: process.env.IRS_SEARCH_ENDPOINT }) : undefined,
      directory: process.env.TRUSTED_DIRECTORY_SEARCH_ENDPOINT ? new TrustedDirectoryClient({ endpoint: process.env.TRUSTED_DIRECTORY_SEARCH_ENDPOINT }) : undefined
    }),
    score: async (resource: ReferenceResource, observations: CapturedObservation[]) => {
      const scoringObservations = observationsForScoring(resource, observations);
      const score = await scorer.score({ name: resource.name, address: resource.address, evidence: formatAuditEvidence(scoringObservations), citationProviders: [...new Set(scoringObservations.map((observation) => observation.provider))] });
      return {
        promptVersion: CBO_AUDIT_PROMPT_VERSION,
        cboEligibility: score.cboEligibility,
        operationalAssessment: score.operationalAssessment,
        evidenceQuality: score.evidenceQuality,
        citations: score.citations,
        suggestedCategory: score.suggestedCategory,
        rationale: score.rationale
      };
    }
  };
}
