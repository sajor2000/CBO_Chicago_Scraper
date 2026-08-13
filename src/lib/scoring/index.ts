import type { CapturedObservation } from "../retrieval/types.ts";

export interface Scores {
  fit: number;
  identity: number;
  operationalEvidence: number;
  rationale: string[];
}

const normal = (value?: string) => value?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";

export const scoreEvidence = (
  resource: { name: string; address?: string },
  observations: readonly CapturedObservation[]
): Scores => {
  const successful = observations.filter((observation) => observation.state === "success");
  const names = successful.filter((o) => normal(o.values?.name) === normal(resource.name)).length;
  const addresses = successful.filter((o) => resource.address && normal(o.values?.address) === normal(resource.address)).length;
  const official = successful.some((o) => o.provider === "firecrawl");
  const google = successful.some((o) => o.provider === "google_places");

  return {
    fit: Math.min(100, successful.length * 25),
    identity: Math.min(100, names * 50 + addresses * 25),
    operationalEvidence: (official ? 60 : 0) + (google ? 40 : 0),
    rationale: [
      `${successful.length} successful captured source(s)`,
      `${names} name match(es)`,
      `${addresses} address match(es)`
    ]
  };
};
