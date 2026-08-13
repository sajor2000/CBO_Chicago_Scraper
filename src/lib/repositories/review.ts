export type CandidateStatus = "staged" | "deferred" | "rejected" | "approved" | "publish_pending" | "published" | "publish_failed";
export type CandidateAction = "approved" | "rejected" | "deferred";
export type FieldValues = Record<string, string>;

export interface ReviewCandidate {
  id: string;
  revision: number;
  status: CandidateStatus;
  proposedValues: FieldValues;
  approvedValues?: FieldValues;
  evidence: string[];
  decisions: ReviewDecisionRecord[];
}

export interface ReviewDecisionRecord {
  revision: number;
  action: CandidateAction | "superseded";
  reviewerEmail: string;
  reason: string;
  fields?: string[];
  at: string;
}

export class RevisionConflictError extends Error {
  constructor() {
    super("Candidate revision has changed; refresh before deciding.");
    this.name = "RevisionConflictError";
  }
}

const clone = (candidate: ReviewCandidate): ReviewCandidate => structuredClone(candidate);
const requiredReason = (reason: string) => {
  if (!reason.trim()) throw new Error("A review reason is required.");
};

/** Test-sized repository contract; the review database will provide the durable implementation. */
export class InMemoryReviewRepository {
  #candidates = new Map<string, ReviewCandidate>();
  #history = new Map<string, ReviewCandidate[]>();

  stage(input: { id: string; proposedValues: FieldValues; evidence?: string[] }): ReviewCandidate {
    if (this.#candidates.has(input.id)) throw new Error("Candidate already exists.");
    const candidate: ReviewCandidate = { id: input.id, revision: 1, status: "staged", proposedValues: { ...input.proposedValues }, evidence: [...(input.evidence ?? [])], decisions: [] };
    this.#candidates.set(input.id, candidate);
    this.#history.set(input.id, [clone(candidate)]);
    return clone(candidate);
  }

  get(candidateId: string): ReviewCandidate | undefined {
    const candidate = this.#candidates.get(candidateId);
    return candidate && clone(candidate);
  }

  list(): ReviewCandidate[] {
    return [...this.#candidates.values()].map(clone);
  }

  history(candidateId: string): ReviewCandidate[] {
    return (this.#history.get(candidateId) ?? []).map(clone);
  }

  decide(input: { candidateId: string; expectedRevision: number; reviewerEmail: string; action: CandidateAction; fields?: string[]; reason: string }): ReviewCandidate {
    requiredReason(input.reason);
    const candidate = this.#current(input.candidateId, input.expectedRevision);
    if (input.action === "approved") {
      if (!input.fields?.length) throw new Error("Approval requires at least one proposed field.");
      if (input.fields.some((field) => !(field in candidate.proposedValues))) throw new Error("Approved fields must be proposed fields.");
      candidate.approvedValues = Object.fromEntries(input.fields.map((field) => [field, candidate.proposedValues[field]!])) as FieldValues;
    } else {
      candidate.approvedValues = undefined;
    }
    candidate.status = input.action;
    candidate.decisions.push({ revision: candidate.revision, action: input.action, reviewerEmail: input.reviewerEmail, reason: input.reason.trim(), fields: input.fields && [...input.fields], at: new Date().toISOString() });
    candidate.revision += 1;
    this.#record(candidate);
    return clone(candidate);
  }

  supersede(input: { candidateId: string; expectedRevision: number; proposedValues: FieldValues; actorEmail: string; reason: string }): ReviewCandidate {
    requiredReason(input.reason);
    const previous = this.#current(input.candidateId, input.expectedRevision);
    previous.decisions.push({ revision: previous.revision, action: "superseded", reviewerEmail: input.actorEmail, reason: input.reason.trim(), at: new Date().toISOString() });
    this.#record(previous);
    const next: ReviewCandidate = { ...previous, revision: previous.revision + 1, status: "staged", proposedValues: { ...input.proposedValues }, approvedValues: undefined, decisions: [...previous.decisions] };
    this.#candidates.set(next.id, next);
    this.#record(next);
    return clone(next);
  }

  #current(candidateId: string, expectedRevision: number): ReviewCandidate {
    const candidate = this.#candidates.get(candidateId);
    if (!candidate || candidate.revision !== expectedRevision) throw new RevisionConflictError();
    return candidate;
  }

  #record(candidate: ReviewCandidate) {
    const history = [...(this.#history.get(candidate.id) ?? [])];
    const index = history.findIndex((entry) => entry.revision === candidate.revision);
    if (index >= 0) history[index] = clone(candidate);
    else history.push(clone(candidate));
    this.#history.set(candidate.id, history);
  }
}

export const reviewRepository = new InMemoryReviewRepository();
