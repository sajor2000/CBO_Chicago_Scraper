export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type CandidateKind = "update" | "new_resource" | "closure_review";
export type ReviewDecision = "approved" | "rejected" | "deferred";
export type PublishOutcome = "published" | "failed" | "rolled_back";
export type RunMode = "manual_selected" | "manual_full_cycle" | "discovery_only" | "scheduled_cycle";
export type RunStatus = "queued" | "running" | "paused" | "cancelled" | "completed" | "failed";
export type CheckpointOutcome =
  | "verified_no_change"
  | "candidate_staged"
  | "conflict"
  | "unable_to_verify"
  | "provider_failure"
  | "cancelled"
  | "budget_exhausted";

export interface FrozenCycleMembership {
  resourceId: string;
  snapshotId: string;
}

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
