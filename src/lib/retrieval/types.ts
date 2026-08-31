export type Provider = "firecrawl" | "google_places" | "local_directory" | "irs" | "search_fallback" | "tavily" | "trusted_directory";
export type RetrievalState = "success" | "no_result" | "blocked" | "timeout" | "rate_limited" | "malformed";

export interface EvidenceValues {
  name?: string;
  address?: string;
  phone?: string;
  url?: string;
  businessStatus?: "open" | "closed" | "unknown";
  placeId?: string;
}

export interface CapturedObservation {
  provider: Provider;
  state: RetrievalState;
  observedAt: string;
  sourceUrl?: string;
  excerpt?: string;
  values?: EvidenceValues;
}

export const normalizeEvidenceText = (value?: string) => value?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";

/** An adapter input is captured by a caller; no adapter performs network I/O. */
export interface RetrievalAdapter {
  provider: Provider;
  capture(observation: Omit<CapturedObservation, "provider">): CapturedObservation;
}

export const capturedAdapter = (provider: Provider): RetrievalAdapter => ({
  provider,
  capture: (observation) => ({ ...observation, provider })
});
