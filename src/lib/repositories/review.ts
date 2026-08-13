export type CandidateStatus = "staged" | "deferred" | "rejected" | "approved" | "publish_pending" | "published" | "publish_failed";
import type { ReviewDecision } from "../domain/review-workspace.ts";
import { assertReviewWorkspace, requireWorkspaceRole, reviewWorkspaceDb } from "../db.ts";

export type CandidateAction = ReviewDecision;
export type FieldValues = Record<string, string>;

export interface ReviewCandidate {
  id: string;
  revision: number;
  status: CandidateStatus;
  proposedValues: FieldValues;
  beforeValues?: FieldValues;
  approvedValues?: FieldValues;
  evidence: string[];
  decisions: ReviewDecisionRecord[];
}

export interface ReviewDecisionRecord {
  revision: number;
  action: CandidateAction | "superseded";
  reviewerSubject: string;
  reason: string;
  fields?: string[];
  at: string;
}

export type BaselineReceipt = { outcome: "succeeded" | "failed"; sourceRows: number; insertedSnapshots: number; unchanged: number; skipped: number; failed: number };

export const isReconciledBaseline = (receipt: BaselineReceipt) => receipt.outcome === "succeeded"
  && receipt.failed === 0
  && receipt.skipped === 0
  && receipt.sourceRows === receipt.insertedSnapshots + receipt.unchanged;

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

  stage(input: { id: string; proposedValues: FieldValues; beforeValues?: FieldValues; evidence?: string[] }): ReviewCandidate {
    if (this.#candidates.has(input.id)) throw new Error("Candidate already exists.");
    const candidate: ReviewCandidate = { id: input.id, revision: 1, status: "staged", proposedValues: { ...input.proposedValues }, beforeValues: input.beforeValues && { ...input.beforeValues }, evidence: [...(input.evidence ?? [])], decisions: [] };
    this.#candidates.set(input.id, candidate);
    this.#history.set(input.id, [clone(candidate)]);
    return clone(candidate);
  }

  get(candidateId: string): ReviewCandidate | undefined {
    const candidate = this.#candidates.get(candidateId);
    return candidate && clone(candidate);
  }

  list(limit = 50): ReviewCandidate[] {
    const candidates: ReviewCandidate[] = [];
    for (const candidate of this.#candidates.values()) {
      candidates.push(clone(candidate));
      if (candidates.length >= Math.max(1, Math.min(limit, 100))) break;
    }
    return candidates;
  }

  history(candidateId: string): ReviewCandidate[] {
    return (this.#history.get(candidateId) ?? []).map(clone);
  }

  decide(input: { candidateId: string; expectedRevision: number; reviewerSubject: string; action: CandidateAction; fields?: string[]; reason: string }): ReviewCandidate {
    requiredReason(input.reason);
    const candidate = this.#current(input.candidateId, input.expectedRevision);
    if (candidate.status !== "staged" && candidate.status !== "deferred") throw new RevisionConflictError();
    if (input.action === "approved") {
      if (!input.fields?.length) throw new Error("Approval requires at least one proposed field.");
      if (input.fields.some((field) => !(field in candidate.proposedValues))) throw new Error("Approved fields must be proposed fields.");
      candidate.approvedValues = Object.fromEntries(input.fields.map((field) => [field, candidate.proposedValues[field]!])) as FieldValues;
    } else {
      candidate.approvedValues = undefined;
    }
    candidate.status = input.action;
    candidate.decisions.push({ revision: candidate.revision, action: input.action, reviewerSubject: input.reviewerSubject, reason: input.reason.trim(), fields: input.fields && [...input.fields], at: new Date().toISOString() });
    candidate.revision += 1;
    this.#record(candidate);
    return clone(candidate);
  }

  supersede(input: { candidateId: string; expectedRevision: number; proposedValues: FieldValues; actorSubject: string; reason: string }): ReviewCandidate {
    requiredReason(input.reason);
    const previous = this.#current(input.candidateId, input.expectedRevision);
    previous.decisions.push({ revision: previous.revision, action: "superseded", reviewerSubject: input.actorSubject, reason: input.reason.trim(), at: new Date().toISOString() });
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
    const history = this.#history.get(candidate.id) ?? [];
    const index = history.findIndex((entry) => entry.revision === candidate.revision);
    if (index >= 0) history[index] = clone(candidate);
    else history.push(clone(candidate));
    this.#history.set(candidate.id, history);
  }
}

type Sql = ReturnType<typeof reviewWorkspaceDb>;

type CandidateRow = {
  id: string;
  revision: number;
  status: "staged" | "deferred" | "rejected" | "approved_for_future_export";
  proposed_values: FieldValues;
  before_values: FieldValues;
  approved_field_paths: string[];
  evidence: string[];
  decisions: Array<{
    revision: number;
    action: CandidateAction;
    reviewerSubject: string;
    reason: string;
    fields: string[];
    at: string;
  }>;
};

const fromRow = (row: CandidateRow): ReviewCandidate => ({
  id: row.id,
  revision: row.revision,
  status: row.status === "approved_for_future_export" ? "approved" : row.status,
  proposedValues: row.proposed_values,
  beforeValues: row.before_values,
  approvedValues: row.status === "approved_for_future_export"
    ? Object.fromEntries(row.approved_field_paths.map((field) => [field, row.proposed_values[field]!]))
    : undefined,
  evidence: row.evidence ?? [],
  decisions: (row.decisions ?? []).map((decision) => ({
    revision: decision.revision,
    action: decision.action,
    reviewerSubject: decision.reviewerSubject,
    reason: decision.reason,
    fields: decision.fields.length ? decision.fields : undefined,
    at: decision.at
  }))
});

const candidateSelect = `
  select
    state.candidate_id as id,
    state.revision,
    state.status,
    revision.proposed_values,
    revision.before_values,
    state.approved_field_paths,
    coalesce(revision.provenance->'evidence', '[]'::jsonb) as evidence,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'revision', decision_state.revision,
        'action', decision.decision,
        'reviewerSubject', decision.reviewer_subject,
        'reason', coalesce(decision.rationale, ''),
        'fields', decision.approved_field_paths,
        'at', decision.decided_at
      ) order by decision.decided_at)
      from review_workspace.review_decisions decision
      join review_workspace.candidate_current_state decision_state
        on decision_state.candidate_revision_id = decision.candidate_revision_id
      where decision.candidate_revision_id = state.candidate_revision_id
    ), '[]'::jsonb) as decisions
  from review_workspace.candidate_current_state state
  join review_workspace.candidate_revisions revision on revision.id = state.candidate_revision_id
`;

/** Durable production repository. In-memory fixtures above remain intentionally synchronous. */
export class NeonReviewRepository {
  #client?: Sql;
  #createClient: () => Sql;

  constructor(createClient: () => Sql = reviewWorkspaceDb) {
    this.#createClient = createClient;
  }

  async get(candidateId: string): Promise<ReviewCandidate | undefined> {
    const rows = await this.#query<CandidateRow>(`${candidateSelect} where state.candidate_id = $1::uuid`, [candidateId]);
    return rows[0] && fromRow(rows[0]);
  }

  async list(limit = 50): Promise<ReviewCandidate[]> {
    const rows = await this.#query<CandidateRow>(`${candidateSelect} order by state.updated_at desc limit $1`, [Math.max(1, Math.min(limit, 100))]);
    return rows.map(fromRow);
  }

  async seededResource(resourceId: string): Promise<{ id: string; payload: Record<string, unknown> } | undefined> {
    const rows = await this.#query<{ id: string; source_payload: Record<string, unknown> }>(`
      select resource.id, snapshot.source_payload
      from review_workspace.resources resource
      join lateral (
        select source_payload from review_workspace.resource_snapshots
        where resource_id = resource.id order by imported_at desc limit 1
      ) snapshot on true
      where resource.id = $1::uuid
    `, [resourceId]);
    const row = rows[0];
    return row && { id: row.id, payload: row.source_payload };
  }

  async assertBaselineReady(): Promise<void> {
    const rows = await this.#query<{
      outcome: "succeeded" | "failed";
      source_row_count: number;
      inserted_snapshot_count: number;
      unchanged_count: number;
      skipped_count: number;
      failed_count: number;
    }>(`select outcome, source_row_count, inserted_snapshot_count, unchanged_count, skipped_count, failed_count
        from review_workspace.baseline_import_receipts order by recorded_at desc limit 1`);
    const row = rows[0];
    if (!row || !isReconciledBaseline({ outcome: row.outcome, sourceRows: Number(row.source_row_count), insertedSnapshots: Number(row.inserted_snapshot_count), unchanged: Number(row.unchanged_count), skipped: Number(row.skipped_count), failed: Number(row.failed_count) })) {
      throw new Error("A reconciled baseline-import receipt is required before web verification.");
    }
  }

  async decide(input: { candidateId: string; expectedRevision: number; reviewerSubject: string; action: CandidateAction; fields?: string[]; reason: string }): Promise<ReviewCandidate> {
    requiredReason(input.reason);
    if (input.action === "approved" && !input.fields?.length) throw new Error("Approval requires at least one proposed field.");
    const fields = input.action === "approved" ? input.fields! : [];
    const rows = await this.#query<{ id: string }>(`
      with authorized as (
        select 1 from review_workspace.reviewer_access
        where subject = $5 and role = 'reviewer' and revoked_at is null
      ), current as (
        update review_workspace.candidate_current_state state
        set revision = state.revision + 1,
            status = case when $1 = 'approved' then 'approved_for_future_export' else $1 end,
            approved_field_paths = $2::jsonb,
            updated_at = now()
        from review_workspace.candidate_revisions revision
        where state.candidate_id = $3::uuid
          and state.candidate_revision_id = revision.id
          and state.revision = $4
          and state.status in ('staged', 'deferred')
          and exists (select 1 from authorized)
          and ($1 <> 'approved' or (
            jsonb_typeof(revision.proposed_values) = 'object'
            and (select bool_and(revision.proposed_values ? field)
                 from jsonb_array_elements_text($2::jsonb) field)
          ))
        returning state.candidate_id, state.candidate_revision_id
      ), decision as (
        insert into review_workspace.review_decisions
          (candidate_revision_id, reviewer_subject, decision, approved_field_paths, rationale)
        select candidate_revision_id, $5, $1, $2::jsonb, $6 from current
      )
      select candidate_id as id from current
    `, [input.action, JSON.stringify(fields), input.candidateId, input.expectedRevision, input.reviewerSubject, input.reason.trim()]);
    if (!rows[0]) {
      await requireWorkspaceRole(input.reviewerSubject, "reviewer");
      throw new RevisionConflictError();
    }
    return (await this.get(rows[0].id))!;
  }

  async stageVerification(input: {
    resourceId: string;
    runId: string;
    kind: "update" | "closure_review" | "new_resource";
    beforeValues: FieldValues;
    proposedValues: FieldValues;
    observations: Array<{ provider: string; state: string; observedAt: string; sourceUrl?: string; excerpt?: string; values?: unknown }>;
  }): Promise<ReviewCandidate> {
    const provenance = {
      evidence: input.observations.map((observation) => observation.sourceUrl ?? `${observation.provider}: ${observation.state}`),
      observations: input.observations.map(({ excerpt, ...observation }) => ({ ...observation, excerpt: excerpt?.slice(0, 6000) }))
    };
    const rows = await this.#query<{ id: string }>(`
      with snapshot as (
        select id from review_workspace.resource_snapshots
        where resource_id = $1::uuid order by imported_at desc limit 1
      ), previous as (
        select state.candidate_id, state.candidate_revision_id, state.revision
        from review_workspace.candidate_current_state state
        join review_workspace.candidate_revisions revision on revision.id = state.candidate_revision_id
        where revision.resource_id = $1::uuid
        order by state.updated_at desc limit 1
      ), observations as (
        insert into review_workspace.source_observations
          (resource_id, run_id, provider, observation_key, observed_at, extracted_values, retrieval_metadata)
        select $1::uuid, $2::uuid, entry->>'provider',
          coalesce(entry->>'sourceUrl', entry->>'provider') || ':' || (entry->>'observedAt'),
          (entry->>'observedAt')::timestamptz,
          coalesce(entry->'values', '{}'::jsonb),
          jsonb_build_object('state', entry->>'state', 'excerpt', entry->>'excerpt', 'sourceUrl', entry->>'sourceUrl')
        from jsonb_array_elements($6::jsonb) entry
        on conflict (provider, observation_key, observed_at) do nothing
      ), inserted_revision as (
        insert into review_workspace.candidate_revisions
          (resource_id, run_id, kind, before_values, proposed_values, provenance, supersedes_candidate_revision_id)
        select $1::uuid, $2::uuid, $3, $4::jsonb, $5::jsonb, $7::jsonb, previous.candidate_revision_id
        from snapshot left join previous on true
        returning id
      ), linked_snapshot as (
        insert into review_workspace.candidate_revision_snapshot_links (candidate_revision_id, resource_snapshot_id)
        select inserted_revision.id, snapshot.id from inserted_revision cross join snapshot
      ), updated_state as (
        update review_workspace.candidate_current_state state
        set candidate_revision_id = inserted_revision.id, revision = state.revision + 1,
            status = 'staged', approved_field_paths = '[]'::jsonb, updated_at = now()
        from inserted_revision
        where state.candidate_id = (select candidate_id from previous)
        returning state.candidate_id as id
      ), inserted_state as (
        insert into review_workspace.candidate_current_state
          (candidate_revision_id, external_id, revision, status)
        select id, $1, 1, 'staged' from inserted_revision
        where not exists (select 1 from previous)
        returning candidate_id as id
      )
      select id from updated_state union all select id from inserted_state
    `, [input.resourceId, input.runId, input.kind, JSON.stringify(input.beforeValues), JSON.stringify(input.proposedValues), JSON.stringify(input.observations), JSON.stringify(provenance)]);
    if (!rows[0]) throw new Error("A seeded resource snapshot is required before staging review evidence.");
    return (await this.get(rows[0].id))!;
  }

  #sql(): Sql {
    return this.#client ??= this.#createClient();
  }

  async #query<T>(query: string, params: unknown[] = []): Promise<T[]> {
    const sql = this.#sql();
    await assertReviewWorkspace(sql);
    return await sql.query(query, params) as T[];
  }
}

export const reviewRepository = new NeonReviewRepository();
