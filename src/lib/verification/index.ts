import { normalizeEvidenceText, type CapturedObservation, type EvidenceValues } from "../retrieval/types.ts";
import { scoreEvidence, type Scores } from "../scoring/index.ts";
import { approvedCategory } from "../taxonomy/categories.ts";

export type VerificationState = "no_change" | "candidate_update" | "conflict" | "unable_to_verify" | "potential_new_resource";

export interface ReferenceResource {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  url?: string;
  status?: "open" | "closed" | "unknown";
  sourcePayload?: Record<string, unknown>;
}

export interface AiAdvisory {
  promptVersion?: string;
  cboEligibility?: "confirmed_cbo" | "likely_cbo" | "not_a_cbo" | "insufficient_evidence";
  operationalAssessment?: "open" | "closure_suspected" | "unknown";
  evidenceQuality?: "high" | "medium" | "low";
  citations?: string[];
  suggestedCategory?: string;
  mergeWithResourceId?: string;
  close?: boolean;
  rationale?: string;
  officialValues?: Pick<EvidenceValues, "name" | "address" | "phone">;
}

export interface FieldDiff {
  field: keyof EvidenceValues;
  before: string | undefined;
  after: string;
  citedBy: string[];
}

export interface VerificationResult {
  state: VerificationState;
  resourceId: string | null;
  diffs: FieldDiff[];
  proposedValues: EvidenceValues;
  observations: readonly CapturedObservation[];
  scores: Scores;
  reasons: string[];
  advisory: AiAdvisory | undefined;
}

const same = (left?: string, right?: string) => Boolean(left && right && normalizeEvidenceText(left) === normalizeEvidenceText(right));
const unavailable = new Set(["blocked", "timeout", "rate_limited"]);
const requiredProviders = new Set(["firecrawl", "google_places"]);

export const matchesIdentity = (resource: ReferenceResource, values?: EvidenceValues): boolean =>
  same(resource.name, values?.name) && (!values?.address || !resource.address || same(resource.address, values.address));

const agreedValue = (observations: readonly CapturedObservation[], field: keyof EvidenceValues): { value: string; providers: string[] } | undefined => {
  const groups = new Map<string, { value: string; providers: CapturedObservation["provider"][] }>();
  for (const observation of observations) {
    const value = observation.state === "success" ? observation.values?.[field] : undefined;
    if (!value) continue;
    const key = normalizeEvidenceText(value);
    const group = groups.get(key) ?? { value, providers: [] };
    group.providers.push(observation.provider);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    if (group.providers.includes("firecrawl") && group.providers.includes("google_places")) return group;
  }
  return undefined;
};

export const verifyResource = (input: {
  resource?: ReferenceResource;
  lead?: CapturedObservation;
  observations: readonly CapturedObservation[];
  advisory?: AiAdvisory;
}): VerificationResult => {
  const observations = input.lead ? [...input.observations, input.lead] : input.observations;
  const resource = input.resource;
  const scores = scoreEvidence(resource ?? { name: input.lead?.values?.name ?? "" }, observations);
  const advisory = input.advisory && { ...input.advisory, suggestedCategory: approvedCategory(input.advisory.suggestedCategory) };
  const base = {
    resourceId: resource?.id ?? null,
    diffs: [] as FieldDiff[],
    proposedValues: {} as EvidenceValues,
    observations,
    scores,
    advisory
  };

  if (observations.some((observation) => requiredProviders.has(observation.provider) && unavailable.has(observation.state))) {
    return { ...base, state: "unable_to_verify", reasons: ["A required source was blocked, timed out, or rate limited; no status delta was staged."] };
  }

  if (!resource && (input.lead?.provider === "local_directory" || input.lead?.provider === "trusted_directory") && input.lead.state === "success") {
    return { ...base, state: "potential_new_resource", proposedValues: input.lead.values ?? {}, reasons: ["Trusted directory lead did not match a known resource identity."] };
  }

  if (!resource) {
    return { ...base, state: "unable_to_verify", reasons: ["No reference resource was supplied for identity matching."] };
  }

  if ((input.lead?.provider === "local_directory" || input.lead?.provider === "trusted_directory") && !matchesIdentity(resource, input.lead.values)) {
    return { ...base, state: "potential_new_resource", proposedValues: input.lead.values ?? {}, reasons: ["Trusted directory lead did not match the known resource identity."] };
  }

  const googleClosed = observations.some((observation) => observation.provider === "google_places" && observation.values?.businessStatus === "closed" && (!observation.values.name || matchesIdentity(resource, observation.values)));
  if (googleClosed) {
    return { ...base, state: "conflict", reasons: ["Google closure is corroboration only and cannot stage a closed status."] };
  }

  const address = agreedValue(observations, "address");
  if (address && !same(address.value, resource.address)) {
    const diff: FieldDiff = { field: "address", before: resource.address, after: address.value, citedBy: address.providers };
    return { ...base, state: "candidate_update", diffs: [diff], proposedValues: { address: address.value }, reasons: ["Official-site and Google address evidence agree."] };
  }

  return { ...base, state: "no_change", reasons: ["No deterministic, corroborated field difference was found."] };
};
