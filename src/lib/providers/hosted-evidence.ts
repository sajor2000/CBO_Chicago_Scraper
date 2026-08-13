import { azureOpenAiScorerFromEnv } from "../ai/azure-openai.ts";
import type { CapturedObservation } from "../retrieval/types.ts";
import type { ReferenceResource } from "../verification/index.ts";
import { FirecrawlClient, GooglePlacesClient, IrsClient, TavilyClient, TrustedDirectoryClient } from "./index.ts";

export async function collectHostedEvidence(input: {
  resource: ReferenceResource;
  firecrawl: Pick<FirecrawlClient, "scrape">;
  google: Pick<GooglePlacesClient, "search">;
  tavily: Pick<TavilyClient, "search">;
  irs?: Pick<IrsClient, "search">;
  directory?: Pick<TrustedDirectoryClient, "search">;
}): Promise<CapturedObservation[]> {
  const query = [input.resource.name, input.resource.address].filter(Boolean).join(", ");
  const [google, tavily, irs, directory] = await Promise.all([
    input.google.search(query), input.tavily.search(query, { maxResults: 3 }), input.irs?.search(query), input.directory?.search(query)
  ]);
  // Search output is untrusted discovery evidence, never an instruction to expand scrape scope.
  const officialUrl = input.resource.url;
  const firecrawl = officialUrl ? await input.firecrawl.scrape(officialUrl, { allowInteract: true }) : {
    provider: "firecrawl" as const, state: "no_result" as const, observedAt: new Date().toISOString()
  };
  return [firecrawl, google, tavily, ...(irs ? [irs] : []), ...(directory ? [directory] : [])];
}

export function hostedEvidenceFromEnv() {
  const firecrawlKey = process.env.FIRECRAWL_API_KEY;
  const googleKey = process.env.GOOGLE_MAPS_API_KEY;
  const tavilyKey = process.env.TAVILY_API_KEY;
  if (!firecrawlKey || !googleKey || !tavilyKey) throw new Error("Firecrawl, Google Places, and Tavily must be configured before a hosted run can execute.");
  const scorer = azureOpenAiScorerFromEnv();
  const allowlist = (process.env.FIRECRAWL_INTERACT_ALLOWLIST ?? "").split(",").map((domain) => domain.trim()).filter(Boolean);
  return {
    collect: (resource: ReferenceResource) => collectHostedEvidence({
      resource,
      firecrawl: new FirecrawlClient({ apiKey: firecrawlKey, interactAllowlist: allowlist }),
      google: new GooglePlacesClient({ apiKey: googleKey }),
      tavily: new TavilyClient({ apiKey: tavilyKey }),
      irs: process.env.IRS_SEARCH_ENDPOINT ? new IrsClient({ endpoint: process.env.IRS_SEARCH_ENDPOINT }) : undefined,
      directory: process.env.TRUSTED_DIRECTORY_SEARCH_ENDPOINT ? new TrustedDirectoryClient({ endpoint: process.env.TRUSTED_DIRECTORY_SEARCH_ENDPOINT }) : undefined
    }),
    score: async (resource: ReferenceResource, observations: CapturedObservation[]) => {
      const score = await scorer.score({ name: resource.name, address: resource.address, evidence: observations.map((observation) => observation.excerpt ?? observation.sourceUrl ?? `${observation.provider}: ${observation.state}`).join("\n") });
      return { suggestedCategory: score.suggestedCategory, rationale: score.rationale };
    }
  };
}
