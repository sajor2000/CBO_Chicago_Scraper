export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type CandidateKind = "update" | "new_resource" | "closure_review";
export type ReviewDecision = "approved" | "rejected" | "needs_information";
export type PublishOutcome = "published" | "failed" | "rolled_back";

export interface ResourceSnapshot {
  resourceId: string;
  sourceVersion: string;
  sourcePayload: JsonValue;
}

export interface CandidateRevision {
  resourceId: string | null;
  kind: CandidateKind;
  beforeValues: JsonValue;
  proposedValues: JsonValue;
  provenance: JsonValue;
}
