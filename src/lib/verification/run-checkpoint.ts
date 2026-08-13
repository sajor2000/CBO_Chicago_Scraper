import type { CapturedObservation } from "../retrieval/types.ts";
import type { RunReport } from "../runs/index.ts";
import { verifyResource, type AiAdvisory, type ReferenceResource, type VerificationResult } from "./index.ts";

export type VerificationStage = (input: {
  kind: "update" | "closure_review";
  beforeValues: Record<string, string>;
  proposedValues: Record<string, string>;
  observations: CapturedObservation[];
}) => Promise<unknown>;

export function referenceResourceFromSnapshot(input: { id: string; payload: Record<string, unknown> }): ReferenceResource {
  const value = (...keys: string[]) => keys.map((key) => input.payload[key]).find((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))?.trim();
  const name = value("organization_name", "location_name", "name");
  if (!name) throw new Error("Seeded CBO snapshot does not contain a public organization or location name.");
  return { id: input.id, name, address: value("full_address", "address"), phone: value("phone", "phone_number"), url: value("website", "url") };
}

export async function processVerificationCheckpoint(input: {
  resource: ReferenceResource;
  observations: CapturedObservation[];
  advisory?: AiAdvisory;
  stage: VerificationStage;
}): Promise<{ result: VerificationResult; report: Partial<Omit<RunReport, "recordsChecked" | "budgetUsed">> }> {
  const result = verifyResource({ resource: input.resource, observations: input.observations, advisory: input.advisory });
  const report = {
    candidatesStaged: result.state === "no_change" ? 0 : 1,
    conflicts: result.state === "conflict" ? 1 : 0,
    unableToVerify: result.state === "unable_to_verify" ? 1 : 0,
    providerFailures: result.observations.filter((observation) => observation.state !== "success" && observation.state !== "no_result").length
  };
  if (result.state !== "no_change") {
    await input.stage({
      kind: result.state === "conflict" ? "closure_review" : "update",
      beforeValues: Object.fromEntries(result.diffs.map((diff) => [diff.field, diff.before ?? ""])),
      proposedValues: Object.fromEntries(Object.entries(result.proposedValues).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
      observations: [...result.observations]
    });
  }
  return { result, report };
}
