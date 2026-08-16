import type { CapturedObservation } from "../retrieval/types.ts";
import type { CheckpointOutcome } from "../domain/review-workspace.ts";
import type { RunReport } from "../runs/index.ts";
import { verifyResource, type AiAdvisory, type ReferenceResource, type VerificationResult } from "./index.ts";

export type VerificationStage = (input: {
  kind: "update" | "closure_review" | "eligibility_review";
  beforeValues: Record<string, string>;
  proposedValues: Record<string, string>;
  observations: CapturedObservation[];
  advisory?: AiAdvisory;
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
}): Promise<{ result: VerificationResult; report: Partial<Omit<RunReport, "recordsChecked" | "budgetUsed">>; outcome: CheckpointOutcome }> {
  const result = verifyResource({ resource: input.resource, observations: input.observations, advisory: input.advisory });
  const report = {
    candidatesStaged: result.state === "candidate_update" || result.state === "conflict" || (result.state === "no_change" && result.advisory?.cboEligibility === "not_a_cbo") ? 1 : 0,
    conflicts: result.state === "conflict" ? 1 : 0,
    unableToVerify: result.state === "unable_to_verify" ? 1 : 0,
    providerFailures: result.observations.filter((observation) => observation.state !== "success" && observation.state !== "no_result").length
  };
  const eligibilityReview = result.state === "no_change" && result.advisory?.cboEligibility === "not_a_cbo";
  if (result.state === "candidate_update" || result.state === "conflict" || eligibilityReview) {
    await input.stage({
      kind: eligibilityReview ? "eligibility_review" : result.state === "conflict" ? "closure_review" : "update",
      beforeValues: eligibilityReview ? { cbo_eligibility: "not assessed" } : Object.fromEntries(result.diffs.map((diff) => [diff.field, diff.before ?? ""])),
      proposedValues: eligibilityReview ? { cbo_eligibility: "not a CBO" } : Object.fromEntries(Object.entries(result.proposedValues).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
      observations: [...result.observations],
      advisory: result.advisory
    });
  }
  const outcome: CheckpointOutcome = result.state === "candidate_update" || eligibilityReview ? "candidate_staged"
    : result.state === "conflict" ? "conflict"
      : result.state === "unable_to_verify" ? "unable_to_verify"
        : report.providerFailures ? "provider_failure" : "verified_no_change";
  return { result, report, outcome };
}
