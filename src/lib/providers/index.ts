import type { CapturedObservation, Provider, RetrievalState } from "../retrieval/types.ts";
import { assertSafeOutboundUrl } from "../security/outbound-url.ts";

export type ProviderName = Provider;
export type CaptureState = RetrievalState;

export type ProviderCapture = CapturedObservation;

type Fetch = typeof fetch;
type Json = Record<string, unknown>;
const MAX_EXCERPT = 6_000;
const REQUEST_TIMEOUT_MS = 15_000;

const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim().slice(0, 1_000) : undefined;
const record = (value: unknown): Json | undefined => value && typeof value === "object" && !Array.isArray(value) ? value as Json : undefined;
const first = (value: unknown): Json | undefined => Array.isArray(value) ? record(value[0]) : undefined;
const records = (value: unknown): Json[] => Array.isArray(value) ? value.flatMap((entry) => record(entry) ? [record(entry)!] : []) : [];
const excerpt = (value: unknown) => text(value)?.slice(0, MAX_EXCERPT);
const now = () => new Date().toISOString();

const stateFor = (status: number): CaptureState => {
  if (status === 404) return "no_result";
  if (status === 401 || status === 403) return "blocked";
  if (status === 408 || status === 504) return "timeout";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "unavailable";
  return "malformed";
};

const failureFor = (error: unknown): CaptureState => error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError") ? "timeout" : "malformed";

const captured = (provider: ProviderName, state: CaptureState, input: Omit<ProviderCapture, "provider" | "state" | "observedAt"> = {}): ProviderCapture => ({ provider, state, observedAt: now(), ...input });

async function requestJson(fetcher: Fetch, url: string, init: RequestInit): Promise<{ payload?: Json; state?: CaptureState }> {
  try {
    const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) return { state: stateFor(response.status) };
    return { payload: record(await response.json()) };
  } catch (error) {
    return { state: failureFor(error) };
  }
}

function secureUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Provider endpoints must use HTTPS.");
  return url;
}

export class FirecrawlClient {
  #apiKey: string;
  #fetch: Fetch;
  #interactAllowlist: Set<string>;
  #urlGuard: (value: string) => Promise<URL>;

  constructor(input: { apiKey: string; fetch?: Fetch; interactAllowlist?: readonly string[]; urlGuard?: (value: string) => Promise<URL> }) {
    if (!input.apiKey) throw new Error("Firecrawl is not configured.");
    this.#apiKey = input.apiKey;
    this.#fetch = input.fetch ?? fetch;
    this.#interactAllowlist = new Set(input.interactAllowlist ?? []);
    // Test adapters own their network; production always performs DNS-aware validation.
    this.#urlGuard = input.urlGuard ?? (input.fetch ? async (value) => secureUrl(value) : assertSafeOutboundUrl);
  }

  async scrape(url: string, options: { allowInteract?: boolean } = {}): Promise<ProviderCapture> {
    const target = await this.#urlGuard(url);
    const scrape = await requestJson(this.#fetch, "https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: { authorization: `Bearer ${this.#apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ url: target.toString(), formats: ["markdown"], onlyMainContent: true, timeout: REQUEST_TIMEOUT_MS, maxAge: 0 })
    });
    const data = record(scrape.payload?.data);
    const markdown = excerpt(data?.markdown);
    const reportedSource = text(record(data?.metadata)?.sourceURL);
    if (reportedSource) await this.#urlGuard(reportedSource);
    const sourceUrl = reportedSource ?? target.toString();
    if (markdown) return captured("firecrawl", "success", { sourceUrl, excerpt: markdown });
    const scrapeId = text(scrape.payload?.id) ?? text(data?.id);
    if (!options.allowInteract || !this.#interactAllowlist.has(target.hostname) || !scrapeId) return captured("firecrawl", scrape.state ?? "malformed", { sourceUrl });

    return this.#interact(scrapeId, sourceUrl);
  }

  async #interact(scrapeId: string, sourceUrl: string): Promise<ProviderCapture> {
    const url = `https://api.firecrawl.dev/v2/scrape/${encodeURIComponent(scrapeId)}/interact`;
    try {
      const result = await requestJson(this.#fetch, url, {
        method: "POST",
        headers: { authorization: `Bearer ${this.#apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ timeout: 5_000, actions: [{ type: "wait", milliseconds: 500 }] })
      });
      const markdown = excerpt(record(result.payload?.data)?.markdown);
      return markdown ? captured("firecrawl", "success", { sourceUrl, excerpt: markdown }) : captured("firecrawl", result.state ?? "malformed", { sourceUrl });
    } finally {
      await requestJson(this.#fetch, url, { method: "DELETE", headers: { authorization: `Bearer ${this.#apiKey}` } });
    }
  }
}

export class GooglePlacesClient {
  #apiKey: string;
  #fetch: Fetch;
  constructor(input: { apiKey: string; fetch?: Fetch }) { if (!input.apiKey) throw new Error("Google Places is not configured."); this.#apiKey = input.apiKey; this.#fetch = input.fetch ?? fetch; }
  async search(query: string): Promise<ProviderCapture> {
    const result = await requestJson(this.#fetch, "https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": this.#apiKey, "x-goog-fieldmask": "places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.businessStatus" },
      body: JSON.stringify({ textQuery: query, pageSize: 1 })
    });
    const place = first(result.payload?.places);
    if (!place) return captured("google_places", result.state ?? "no_result");
    const status = text(place.businessStatus);
    return captured("google_places", "success", { sourceUrl: text(place.websiteUri), values: { name: text(record(place.displayName)?.text), address: text(place.formattedAddress), phone: text(place.nationalPhoneNumber), url: text(place.websiteUri), businessStatus: status === "CLOSED_PERMANENTLY" ? "closed" : status === "OPERATIONAL" ? "open" : "unknown" } });
  }

  async searchDiscovery(query: string, options: { maxResults: number }): Promise<ProviderCapture[]> {
    const cap = options.maxResults;
    if (!Number.isInteger(cap) || cap < 1 || cap > 5) throw new Error("Discovery maxResults must be between 1 and 5.");
    const result = await requestJson(this.#fetch, "https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": this.#apiKey, "x-goog-fieldmask": "places.id,places.displayName,places.formattedAddress,places.addressComponents,places.nationalPhoneNumber,places.websiteUri,places.businessStatus,places.types" },
      body: JSON.stringify({ textQuery: query, pageSize: cap })
    });
    const places = records(result.payload?.places).slice(0, cap);
    if (!places.length) return [captured("google_places", result.state ?? "no_result")];
    return places.map((place, index) => {
      const components = records(place.addressComponents);
      const countyText = text(components.find((component) => Array.isArray(component.types) && component.types.includes("administrative_area_level_2"))?.longText)?.replace(/\s+County$/i, "");
      const status = text(place.businessStatus);
      return captured("google_places", "success", {
        rank: index + 1,
        sourceUrl: text(place.websiteUri),
        values: { placeId: text(place.id), name: text(record(place.displayName)?.text), address: text(place.formattedAddress), county: countyText, phone: text(place.nationalPhoneNumber), url: text(place.websiteUri), businessStatus: status === "CLOSED_PERMANENTLY" ? "closed" : status === "OPERATIONAL" ? "open" : "unknown" }
      });
    });
  }
}

export class TavilyClient {
  #apiKey: string; #fetch: Fetch;
  constructor(input: { apiKey: string; fetch?: Fetch }) { if (!input.apiKey) throw new Error("Tavily is not configured."); this.#apiKey = input.apiKey; this.#fetch = input.fetch ?? fetch; }
  async search(query: string, options: { maxResults?: number } = {}): Promise<ProviderCapture> {
    const result = await requestJson(this.#fetch, "https://api.tavily.com/search", { method: "POST", headers: { authorization: `Bearer ${this.#apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ query, search_depth: "basic", max_results: Math.min(Math.max(options.maxResults ?? 3, 1), 5), include_answer: false, include_raw_content: false, safe_search: true }) });
    const hit = first(result.payload?.results);
    return hit ? captured("tavily", "success", { sourceUrl: text(hit.url), excerpt: excerpt(hit.content), values: { name: text(hit.title), url: text(hit.url) } }) : captured("tavily", result.state ?? "no_result");
  }
  async searchDiscovery(query: string, options: { maxResults: number }): Promise<ProviderCapture[]> {
    const cap = options.maxResults;
    if (!Number.isInteger(cap) || cap < 1 || cap > 5) throw new Error("Discovery maxResults must be between 1 and 5.");
    const result = await requestJson(this.#fetch, "https://api.tavily.com/search", { method: "POST", headers: { authorization: `Bearer ${this.#apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ query, search_depth: "basic", max_results: cap, include_answer: false, include_raw_content: false, safe_search: true }) });
    const hits = records(result.payload?.results).slice(0, cap);
    if (!hits.length) return [captured("tavily", result.state ?? "no_result")];
    const requestId = text(result.payload?.request_id);
    return hits.map((hit, index) => captured("tavily", "success", { rank: index + 1, requestId, sourceUrl: text(hit.url), excerpt: excerpt(hit.content), values: { name: text(hit.title), url: text(hit.url) } }));
  }
}

export class ExaClient {
  #apiKey: string; #fetch: Fetch;
  constructor(input: { apiKey: string; fetch?: Fetch }) { if (!input.apiKey) throw new Error("Exa is not configured."); this.#apiKey = input.apiKey; this.#fetch = input.fetch ?? fetch; }
  async search(query: string, options: { maxResults?: number } = {}): Promise<ProviderCapture> {
    const result = await requestJson(this.#fetch, "https://api.exa.ai/search", {
      method: "POST",
      headers: { "x-api-key": this.#apiKey, "content-type": "application/json" },
      body: JSON.stringify({ query, type: "fast", numResults: Math.min(Math.max(options.maxResults ?? 3, 1), 5), moderation: true, contents: { highlights: true } })
    });
    const hit = first(result.payload?.results);
    const highlight = Array.isArray(hit?.highlights) ? hit.highlights.find((value): value is string => typeof value === "string") : undefined;
    return hit ? captured("search_fallback", "success", { sourceUrl: text(hit.url), excerpt: excerpt(highlight) ?? excerpt(hit.text), values: { name: text(hit.title), url: text(hit.url) } }) : captured("search_fallback", result.state ?? "no_result");
  }
  async searchDiscovery(query: string, options: { maxResults: number }): Promise<ProviderCapture[]> {
    const cap = options.maxResults;
    if (!Number.isInteger(cap) || cap < 1 || cap > 5) throw new Error("Discovery maxResults must be between 1 and 5.");
    const result = await requestJson(this.#fetch, "https://api.exa.ai/search", { method: "POST", headers: { "x-api-key": this.#apiKey, "content-type": "application/json" }, body: JSON.stringify({ query, type: "fast", numResults: cap, moderation: true, contents: { highlights: true } }) });
    const hits = records(result.payload?.results).slice(0, cap);
    if (!hits.length) return [captured("search_fallback", result.state ?? "no_result")];
    const requestId = text(result.payload?.requestId) ?? text(result.payload?.request_id);
    return hits.map((hit, index) => {
      const highlight = Array.isArray(hit.highlights) ? hit.highlights.find((value): value is string => typeof value === "string") : undefined;
      return captured("search_fallback", "success", { rank: index + 1, requestId, sourceUrl: text(hit.url), excerpt: excerpt(highlight) ?? excerpt(hit.text), values: { name: text(hit.title), url: text(hit.url) } });
    });
  }
}

class SearchEndpointClient {
  #provider: "irs" | "trusted_directory"; #endpoint: string; #publisherUrl: string; #fetch: Fetch;
  constructor(provider: "irs" | "trusted_directory", input: { endpoint: string; fetch?: Fetch }) { this.#provider = provider; this.#endpoint = secureUrl(input.endpoint).toString(); this.#publisherUrl = new URL(this.#endpoint).origin; this.#fetch = input.fetch ?? fetch; }
  async search(query: string): Promise<ProviderCapture> {
    const url = new URL(this.#endpoint); url.searchParams.set("q", query);
    const result = await requestJson(this.#fetch, url.toString(), { headers: { accept: "application/json" } });
    const hit = first(result.payload?.results) ?? record(result.payload?.result) ?? result.payload;
    if (!hit || !Object.keys(hit).length) return captured(this.#provider, result.state ?? "no_result");
    const website = text(hit.website) ?? text(hit.url);
    return captured(this.#provider, "success", { sourceUrl: website, publisherUrl: this.#publisherUrl, excerpt: excerpt(hit.description) ?? excerpt(hit.name), values: { name: text(hit.name), address: text(hit.address), phone: text(hit.phone), url: website } });
  }
}

export class IrsClient extends SearchEndpointClient { constructor(input: { endpoint: string; fetch?: Fetch }) { super("irs", input); } }
export class TrustedDirectoryClient extends SearchEndpointClient { constructor(input: { endpoint: string; fetch?: Fetch }) { super("trusted_directory", input); } }
