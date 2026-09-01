export type CandidateStatus = "staged" | "deferred" | "rejected" | "approved" | "eligibility_confirmed" | "publish_pending" | "published" | "publish_failed";
import type { ReviewDecision } from "../domain/review-workspace.ts";
import type { AiAdvisory } from "../verification/index.ts";
import { summarizeCalibration, type CalibrationSummary } from "../verification/calibration.ts";
import { assertReviewWorkspace, requireWorkspaceRole, reviewWorkspaceDb } from "../db.ts";
import { redactEvidence } from "../evidence/redaction.ts";
import { REQUIRED_REVIEW_SCHEMA_VERSION } from "../review-schema.ts";
import type { DiscoveryLead, ExistingLocation } from "../discovery/index.ts";

export type CandidateAction = ReviewDecision;
export type FieldValues = Record<string, string>;

export type ReviewProvenance = {
  observations: Array<{
    provider: string;
    state: string;
    observedAt: string;
    sourceUrl?: string;
    excerpt?: string;
    values?: FieldValues;
  }>;
  advisory?: Pick<AiAdvisory, "promptVersion" | "cboEligibility" | "operationalAssessment" | "evidenceQuality" | "citations" | "suggestedCategory" | "rationale">;
};

export interface ReviewCandidate {
  id: string;
  revision: number;
  status: CandidateStatus;
  resourceName?: string;
  kind?: "update" | "closure_review" | "new_resource" | "eligibility_review";
  proposedValues: FieldValues;
  beforeValues?: FieldValues;
  approvedValues?: FieldValues;
  evidence: string[];
  provenance: ReviewProvenance;
  decisions: ReviewDecisionRecord[];
}

export type SeededResourceSummary = { id: string; name: string };
export type ReviewQueueFilters = { limit?: number; status?: CandidateStatus; kind?: NonNullable<ReviewCandidate["kind"]>; evidenceQuality?: NonNullable<ReviewProvenance["advisory"]>["evidenceQuality"] };
export type DataTeamHandoffRow = {
  sourceRecord: Record<string, unknown>;
  approvedValues: FieldValues;
};

export interface ReviewDecisionRecord {
  revision: number;
  action: CandidateAction | "superseded";
  reviewerSubject: string;
  reason: string;
  fields?: string[];
  cboEligibility?: boolean;
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

  stage(input: { id: string; proposedValues: FieldValues; beforeValues?: FieldValues; evidence?: string[]; provenance?: ReviewProvenance; kind?: ReviewCandidate["kind"] }): ReviewCandidate {
    if (this.#candidates.has(input.id)) throw new Error("Candidate already exists.");
    const candidate: ReviewCandidate = { id: input.id, revision: 1, status: "staged", kind: input.kind, proposedValues: { ...input.proposedValues }, beforeValues: input.beforeValues && { ...input.beforeValues }, evidence: [...(input.evidence ?? [])], provenance: structuredClone(input.provenance ?? { observations: [] }), decisions: [] };
    this.#candidates.set(input.id, candidate);
    this.#history.set(input.id, [clone(candidate)]);
    return clone(candidate);
  }

  get(candidateId: string): ReviewCandidate | undefined {
    const candidate = this.#candidates.get(candidateId);
    return candidate && clone(candidate);
  }

  list(input: number | ReviewQueueFilters = 50): ReviewCandidate[] {
    const filters = typeof input === "number" ? { limit: input } : input;
    const candidates: ReviewCandidate[] = [];
    for (const candidate of this.#candidates.values()) {
      if (filters.status && candidate.status !== filters.status) continue;
      if (filters.kind && candidate.kind !== filters.kind) continue;
      if (filters.evidenceQuality && candidate.provenance.advisory?.evidenceQuality !== filters.evidenceQuality) continue;
      candidates.push(clone(candidate));
      if (candidates.length >= Math.max(1, Math.min(filters.limit ?? 50, 100))) break;
    }
    return candidates;
  }

  history(candidateId: string): ReviewCandidate[] {
    return (this.#history.get(candidateId) ?? []).map(clone);
  }

  decide(input: { candidateId: string; expectedRevision: number; reviewerSubject: string; action: CandidateAction; fields?: string[]; reason: string; reviewerCboEligibility?: boolean }): ReviewCandidate {
    requiredReason(input.reason);
    const candidate = this.#current(input.candidateId, input.expectedRevision);
    if (candidate.status !== "staged" && candidate.status !== "deferred") throw new RevisionConflictError();
    if (input.reviewerCboEligibility !== undefined && input.action !== "approved" && input.action !== "rejected" && input.action !== "eligibility_confirmed") throw new Error("CBO eligibility can only accompany a terminal decision.");
    if (input.action === "eligibility_confirmed") {
      if (candidate.kind !== "eligibility_review" || input.reviewerCboEligibility === undefined) throw new Error("Eligibility confirmation requires an eligibility review and an explicit label.");
      candidate.status = "eligibility_confirmed";
      candidate.approvedValues = undefined;
    } else if (input.action === "approved") {
      if (!input.fields?.length) throw new Error("Approval requires at least one proposed field.");
      if (input.fields.some((field) => !(field in candidate.proposedValues))) throw new Error("Approved fields must be proposed fields.");
      candidate.approvedValues = Object.fromEntries(input.fields.map((field) => [field, candidate.proposedValues[field]!])) as FieldValues;
    } else {
      candidate.approvedValues = undefined;
    }
    candidate.status = input.action;
    candidate.decisions.push({ revision: candidate.revision, action: input.action, reviewerSubject: input.reviewerSubject, reason: input.reason.trim(), fields: input.fields && [...input.fields], cboEligibility: input.reviewerCboEligibility, at: new Date().toISOString() });
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
  status: "staged" | "deferred" | "rejected" | "approved_for_future_export" | "eligibility_confirmed";
  resource_name: string | null;
  kind: "update" | "closure_review" | "new_resource" | "eligibility_review" | null;
  proposed_values: FieldValues;
  before_values: FieldValues;
  approved_field_paths: string[];
  evidence: string[];
  provenance: unknown;
  decisions: Array<{
    revision: number;
    action: CandidateAction;
    reviewerSubject: string;
    reason: string;
    fields: string[];
    at: string;
  }>;
};

const stringValue = (value: unknown) => typeof value === "string" ? redactEvidence(value).slice(0, 6000) : undefined;
const publicHttpUrl = (value: unknown): string | undefined => {
  const candidate = stringValue(value);
  try {
    if (!candidate) return undefined;
    const url = new URL(candidate);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch { return undefined; }
};
const fieldValues = (value: unknown): FieldValues | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).flatMap(([key, entry]) => {
    const redacted = stringValue(entry);
    return redacted === undefined ? [] : [[key, redacted] as const];
  });
  return entries.length ? Object.fromEntries(entries) : undefined;
};

/** Safe projection of immutable JSON provenance for the reviewer surface. */
export const reviewProvenance = (value: unknown): ReviewProvenance => {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const observations = Array.isArray(source.observations) ? source.observations.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const observation = entry as Record<string, unknown>;
    const provider = stringValue(observation.provider);
    const state = stringValue(observation.state);
    const observedAt = stringValue(observation.observedAt);
    if (!provider || !state || !observedAt) return [];
    const values = fieldValues(observation.values);
    return [{ provider, state, observedAt, sourceUrl: publicHttpUrl(observation.sourceUrl), excerpt: stringValue(observation.excerpt), ...(values ? { values } : {}) }];
  }) : [];
  const rawAdvisory = source.advisory && typeof source.advisory === "object" && !Array.isArray(source.advisory) ? source.advisory as Record<string, unknown> : undefined;
  if (!rawAdvisory) return { observations };
  const citations = Array.isArray(rawAdvisory.citations) ? rawAdvisory.citations.flatMap((citation) => {
    const redacted = stringValue(citation);
    return redacted ? [redacted] : [];
  }) : undefined;
  return {
    observations,
    advisory: {
      promptVersion: stringValue(rawAdvisory.promptVersion),
      cboEligibility: rawAdvisory.cboEligibility === "confirmed_cbo" || rawAdvisory.cboEligibility === "likely_cbo" || rawAdvisory.cboEligibility === "not_a_cbo" || rawAdvisory.cboEligibility === "insufficient_evidence" ? rawAdvisory.cboEligibility : undefined,
      operationalAssessment: rawAdvisory.operationalAssessment === "open" || rawAdvisory.operationalAssessment === "closure_suspected" || rawAdvisory.operationalAssessment === "unknown" ? rawAdvisory.operationalAssessment : undefined,
      evidenceQuality: rawAdvisory.evidenceQuality === "high" || rawAdvisory.evidenceQuality === "medium" || rawAdvisory.evidenceQuality === "low" ? rawAdvisory.evidenceQuality : undefined,
      citations,
      suggestedCategory: stringValue(rawAdvisory.suggestedCategory),
      rationale: stringValue(rawAdvisory.rationale)
    }
  };
};

const snapshotNameExpression = `
  coalesce(
    nullif(snapshot.source_payload->>'organization_name', ''),
    nullif(snapshot.source_payload->>'location_name', ''),
    nullif(snapshot.source_payload->>'name', ''),
    resource.reference_source_id
  )
`;

const fromRow = (row: CandidateRow): ReviewCandidate => ({
  id: row.id,
  revision: row.revision,
  status: row.status === "approved_for_future_export" ? "approved" : row.status,
  resourceName: row.resource_name ?? undefined,
  kind: row.kind ?? undefined,
  proposedValues: row.proposed_values,
  beforeValues: row.before_values,
  approvedValues: row.status === "approved_for_future_export"
    ? Object.fromEntries(row.approved_field_paths.map((field) => [field, row.proposed_values[field]!]))
    : undefined,
  evidence: row.evidence ?? [],
  provenance: reviewProvenance(row.provenance),
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
    revision.kind,
    coalesce(${snapshotNameExpression}, revision.proposed_values->>'name', revision.proposed_values->>'organization_name') as resource_name,
    revision.proposed_values,
    revision.before_values,
    state.approved_field_paths,
    coalesce(revision.provenance->'evidence', '[]'::jsonb) as evidence,
    revision.provenance,
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
  left join review_workspace.resources resource on resource.id = revision.resource_id
  left join review_workspace.candidate_revision_snapshot_links snapshot_link
    on snapshot_link.candidate_revision_id = revision.id
  left join review_workspace.resource_snapshots snapshot
    on snapshot.id = snapshot_link.resource_snapshot_id
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
    const row = rows[0];
    if (!row) return undefined;
    return { ...fromRow(row), decisions: await this.#decisionHistory(candidateId) };
  }

  async list(input: number | ReviewQueueFilters = 50): Promise<ReviewCandidate[]> {
    const filters = typeof input === "number" ? { limit: input } : input;
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters.status) {
      where.push(`state.status = $${params.length + 1}`);
      params.push(filters.status === "approved" ? "approved_for_future_export" : filters.status);
    }
    if (filters.kind) {
      where.push(`revision.kind = $${params.length + 1}`);
      params.push(filters.kind);
    }
    if (filters.evidenceQuality) {
      where.push(`revision.provenance->'advisory'->>'evidenceQuality' = $${params.length + 1}`);
      params.push(filters.evidenceQuality);
    }
    params.push(Math.max(1, Math.min(filters.limit ?? 50, 100)));
    const rows = await this.#query<CandidateRow>(`${candidateSelect}${where.length ? ` where ${where.join(" and ")}` : ""} order by case state.status when 'staged' then 0 when 'deferred' then 1 else 2 end, case revision.kind when 'closure_review' then 0 else 1 end, state.updated_at desc limit $${params.length}`, params);
    return rows.map(fromRow);
  }

  /** Current approved updates projected from their immutable source snapshot. */
  async dataTeamHandoff(sourceRelation: "community_resource_locations" | "wic_locations"): Promise<DataTeamHandoffRow[]> {
    const rows = await this.#query<{
      source_record: unknown; proposed_values: FieldValues; approved_field_paths: string[];
    }>(`
      select snapshot.source_payload->'source_record' as source_record,
        revision.proposed_values, state.approved_field_paths
      from review_workspace.candidate_current_state state
      join review_workspace.candidate_revisions revision on revision.id = state.candidate_revision_id
      join review_workspace.candidate_revision_snapshot_links snapshot_link on snapshot_link.candidate_revision_id = revision.id
      join review_workspace.resource_snapshots snapshot on snapshot.id = snapshot_link.resource_snapshot_id
      where state.status = 'approved_for_future_export'
        and revision.kind in ('update', 'closure_review')
        and revision.resource_id is not null
        and snapshot.source_payload->>'source_relation' = $1
      order by state.updated_at, state.candidate_id
    `, [sourceRelation]);
    return rows.flatMap((row) => row.source_record && typeof row.source_record === "object" && !Array.isArray(row.source_record)
      ? [{ sourceRecord: row.source_record as Record<string, unknown>, approvedValues: Object.fromEntries(row.approved_field_paths.flatMap((field) => row.proposed_values[field] === undefined ? [] : [[field, row.proposed_values[field]!]])) }]
      : []);
  }

  async seededResource(resourceId: string, snapshotId?: string): Promise<{ id: string; payload: Record<string, unknown> } | undefined> {
    const rows = await this.#query<{ id: string; source_payload: Record<string, unknown> }>(`
      select resource.id, snapshot.source_payload
      from review_workspace.resources resource
      join lateral (
        select source_payload from review_workspace.resource_snapshots
        where resource_id = resource.id
          and ($2::uuid is null or id = $2::uuid)
        order by imported_at desc limit 1
      ) snapshot on true
      where resource.id = $1::uuid
    `, [resourceId, snapshotId ?? null]);
    const row = rows[0];
    return row && { id: row.id, payload: row.source_payload };
  }

  async listSeededResources(limit = 100): Promise<SeededResourceSummary[]> {
    const rows = await this.#query<{ id: string; name: string }>(`
      select resource.id, ${snapshotNameExpression} as name
      from review_workspace.refresh_snapshot_memberships membership
      join review_workspace.resources resource on resource.id = membership.resource_id
      join review_workspace.resource_snapshots snapshot on snapshot.id = membership.resource_snapshot_id
      where membership.manifest_id = (
        select id from review_workspace.refresh_manifests
        where status = 'reconciled'
        order by promoted_at desc
        limit 1
      )
      order by name asc
      limit $1
    `, [Math.max(1, Math.min(limit, 100))]);
    return rows.map((row) => ({ id: row.id, name: row.name }));
  }

  async discoveryExistingLocations(): Promise<ExistingLocation[]> {
    const rows = await this.#query<{ id: string; name: string | null; address: string | null; phone: string | null; url: string | null }>(`
      select resource.id,
        coalesce(nullif(snapshot.source_payload->>'organization_name', ''), nullif(snapshot.source_payload->>'location_name', ''), nullif(snapshot.source_payload->>'name', '')) as name,
        coalesce(nullif(snapshot.source_payload->>'full_address', ''), nullif(snapshot.source_payload->>'address', '')) as address,
        coalesce(nullif(snapshot.source_payload->>'phone', ''), nullif(snapshot.source_payload->>'phone_number', '')) as phone,
        coalesce(nullif(snapshot.source_payload->>'website', ''), nullif(snapshot.source_payload->>'url', '')) as url
      from review_workspace.resources resource
      join lateral (
        select source_payload from review_workspace.resource_snapshots
        where resource_id = resource.id order by imported_at desc limit 1
      ) snapshot on true
    `);
    return rows.map((row) => ({ id: row.id, ...(row.name ? { name: row.name } : {}), ...(row.address ? { address: row.address } : {}), ...(row.phone ? { phone: row.phone } : {}), ...(row.url ? { url: row.url } : {}) }));
  }

  async discoveryActivation(): Promise<{ active: boolean; dailyProviderCallCeiling?: number; acceptedCycles: Array<{ id: string; completedAt: string }> }> {
    const [current, cycles] = await Promise.all([
      this.#query<{ active: boolean; daily_provider_call_ceiling: number }>(`
        select current.active, activation.daily_provider_call_ceiling
        from review_workspace.discovery_activation_current current
        join review_workspace.discovery_activations activation on activation.id = current.activation_id
        where current.singleton
      `),
      this.#query<{ id: string; completed_at: string }>(`
        select id, completed_at from review_workspace.verification_cycles
        where status = 'completed' and completed_at is not null
        order by completed_at desc limit 10
      `)
    ]);
    return {
      active: current[0]?.active ?? false,
      dailyProviderCallCeiling: current[0] ? Number(current[0].daily_provider_call_ceiling) : undefined,
      acceptedCycles: cycles.map((cycle) => ({ id: cycle.id, completedAt: cycle.completed_at }))
    };
  }

  async discoveryLead(leadId: string): Promise<{ id: string; runId: string; lineageId: string; queryCellId: string; lead: DiscoveryLead } | undefined> {
    const rows = await this.#query<{ id: string; run_id: string; lineage_id: string; first_query_cell_id: string; display_name: string; display_address: string | null; display_phone: string | null; canonical_domain: string | null; place_id: string | null; county: string }>(`
      select lead.id, lead.run_id, lead.lineage_id, lead.first_query_cell_id,
        lineage.display_name, lineage.display_address, lineage.display_phone, lineage.canonical_domain, lineage.place_id,
        cell.county
      from review_workspace.discovery_leads lead
      join review_workspace.discovery_lineages lineage on lineage.id = lead.lineage_id
      join review_workspace.discovery_query_cells cell on cell.id = lead.first_query_cell_id
      where lead.id = $1::uuid
    `, [leadId]);
    const row = rows[0];
    if (!row) return undefined;
    return {
      id: row.id, runId: row.run_id, lineageId: row.lineage_id, queryCellId: row.first_query_cell_id,
      lead: {
        name: row.display_name,
        ...(row.display_address ? { address: row.display_address } : {}),
        ...(row.canonical_domain ? { url: `https://${row.canonical_domain}` } : {}),
        ...(row.display_phone ? { phone: row.display_phone } : {}),
        ...(row.place_id ? { placeId: row.place_id } : {}), county: row.county
      }
    };
  }

  async calibrationSummary(): Promise<CalibrationSummary[]> {
    const rows = await this.#query<{ promptVersion: string | null; cboEligibility: AiAdvisory["cboEligibility"] | null; decision: "approved" | "rejected"; reviewerCboEligibility: boolean | null }>(`
      select revision.provenance->'advisory'->>'promptVersion' as "promptVersion",
        revision.provenance->'advisory'->>'cboEligibility' as "cboEligibility",
        case when decision.decision = 'eligibility_confirmed'
          then case when decision.reviewer_cbo_eligibility then 'approved' else 'rejected' end
          else decision.decision end as decision,
        decision.reviewer_cbo_eligibility as "reviewerCboEligibility"
      from review_workspace.candidate_current_state state
      join review_workspace.candidate_revisions revision on revision.id = state.candidate_revision_id
      join lateral (
        select decision, reviewer_cbo_eligibility from review_workspace.review_decisions
        where candidate_revision_id = state.candidate_revision_id and decision in ('approved', 'rejected', 'eligibility_confirmed')
        order by decided_at desc limit 1
      ) decision on true
      where state.status in ('approved_for_future_export', 'rejected', 'eligibility_confirmed')
        and revision.provenance ? 'advisory'
    `);
    return summarizeCalibration(rows.flatMap((row) => row.promptVersion ? [{ promptVersion: row.promptVersion, cboEligibility: row.cboEligibility ?? undefined, decision: row.decision, reviewerCboEligibility: row.reviewerCboEligibility ?? undefined }] : []));
  }

  async assertBaselineReady(): Promise<void> {
    const rows = await this.#query<{
      schema_ready: boolean;
      outcome: "succeeded" | "failed";
      source_row_count: number;
      inserted_snapshot_count: number;
      unchanged_count: number;
      skipped_count: number;
      failed_count: number;
    }>(`select exists (
          select 1 from review_workspace.schema_migrations where version = $1
        ) as schema_ready,
        receipt.outcome, receipt.source_row_count, receipt.inserted_snapshot_count,
        receipt.unchanged_count, receipt.skipped_count, receipt.failed_count
        from review_workspace.baseline_import_receipts receipt
        order by receipt.recorded_at desc limit 1`, [REQUIRED_REVIEW_SCHEMA_VERSION]);
    const row = rows[0];
    if (!row?.schema_ready) throw new Error(`Review workspace migration ${REQUIRED_REVIEW_SCHEMA_VERSION} is required before verification.`);
    if (!isReconciledBaseline({ outcome: row.outcome, sourceRows: Number(row.source_row_count), insertedSnapshots: Number(row.inserted_snapshot_count), unchanged: Number(row.unchanged_count), skipped: Number(row.skipped_count), failed: Number(row.failed_count) })) {
      throw new Error("A reconciled baseline-import receipt is required before web verification.");
    }
  }

  async decide(input: { candidateId: string; expectedRevision: number; reviewerSubject: string; action: CandidateAction; fields?: string[]; reason: string; reviewerCboEligibility?: boolean }): Promise<ReviewCandidate> {
    requiredReason(input.reason);
    if (input.action === "approved" && !input.fields?.length) throw new Error("Approval requires at least one proposed field.");
    if (input.reviewerCboEligibility !== undefined && input.action !== "approved" && input.action !== "rejected" && input.action !== "eligibility_confirmed") throw new Error("CBO eligibility can only accompany a terminal decision.");
    if (input.action === "eligibility_confirmed" && input.reviewerCboEligibility === undefined) throw new Error("Eligibility confirmation requires an explicit CBO label.");
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
          and (
            (revision.kind = 'eligibility_review' and $1 in ('eligibility_confirmed', 'deferred')
              and ($1 <> 'eligibility_confirmed' or $7::boolean is not null))
            or (revision.kind <> 'eligibility_review' and $1 <> 'eligibility_confirmed')
          )
        returning state.candidate_id, state.candidate_revision_id
      ), decision as (
        insert into review_workspace.review_decisions
          (candidate_revision_id, reviewer_subject, decision, approved_field_paths, rationale, reviewer_cbo_eligibility)
        select candidate_revision_id, $5, $1, $2::jsonb, $6, $7::boolean from current
      )
      select candidate_id as id from current
    `, [input.action, JSON.stringify(fields), input.candidateId, input.expectedRevision, input.reviewerSubject, input.reason.trim(), input.reviewerCboEligibility ?? null]);
    if (!rows[0]) {
      await requireWorkspaceRole(input.reviewerSubject, "reviewer");
      throw new RevisionConflictError();
    }
    return (await this.get(rows[0].id))!;
  }

  async supersede(input: { candidateId: string; expectedRevision: number; proposedValues: FieldValues; actorSubject: string; reason: string }): Promise<ReviewCandidate> {
    requiredReason(input.reason);
    if (!Object.keys(input.proposedValues).length || Object.values(input.proposedValues).some((value) => !value.trim())) throw new Error("An edited proposal requires non-empty field values.");
    const rows = await this.#query<{ id: string }>(`
      with authorized as (
        select 1 from review_workspace.reviewer_access where subject = $4 and role = 'reviewer' and revoked_at is null
      ), previous as (
        select state.candidate_id, state.candidate_revision_id, revision.resource_id, revision.run_id,
          revision.kind, revision.before_values, revision.provenance
        from review_workspace.candidate_current_state state
        join review_workspace.candidate_revisions revision on revision.id = state.candidate_revision_id
        where state.candidate_id = $1::uuid and state.revision = $2
          and state.status in ('staged', 'deferred') and exists (select 1 from authorized)
      ), inserted_revision as (
        insert into review_workspace.candidate_revisions
          (resource_id, run_id, kind, before_values, proposed_values, provenance, supersedes_candidate_revision_id)
        select resource_id, run_id, kind, before_values, $3::jsonb,
          provenance || jsonb_build_object('reviewerEdit', jsonb_build_object('subject', $4, 'reason', $5)), candidate_revision_id
        from previous returning id
      ), linked_snapshot as (
        insert into review_workspace.candidate_revision_snapshot_links (candidate_revision_id, resource_snapshot_id)
        select inserted_revision.id, link.resource_snapshot_id
        from inserted_revision join previous on true
        join review_workspace.candidate_revision_snapshot_links link on link.candidate_revision_id = previous.candidate_revision_id
      ), linked_discovery_lineage as (
        insert into review_workspace.candidate_revision_discovery_lineages (candidate_revision_id, lineage_id)
        select inserted_revision.id, link.lineage_id
        from inserted_revision join previous on true
        join review_workspace.candidate_revision_discovery_lineages link on link.candidate_revision_id = previous.candidate_revision_id
      ), updated as (
        update review_workspace.candidate_current_state state
        set candidate_revision_id = inserted_revision.id, revision = state.revision + 1,
            status = 'staged', approved_field_paths = '[]'::jsonb, updated_at = now()
        from inserted_revision, previous
        where state.candidate_id = previous.candidate_id and state.candidate_revision_id = previous.candidate_revision_id
        returning state.candidate_id as id
      ) select id from updated
    `, [input.candidateId, input.expectedRevision, JSON.stringify(input.proposedValues), input.actorSubject, input.reason.trim()]);
    if (!rows[0]) {
      await requireWorkspaceRole(input.actorSubject, "reviewer");
      throw new RevisionConflictError();
    }
    return (await this.get(rows[0].id))!;
  }

  async stageVerification(input: {
    resourceId: string;
    runId: string;
    leaseToken: string;
    kind: "update" | "closure_review" | "new_resource" | "eligibility_review";
    beforeValues: FieldValues;
    proposedValues: FieldValues;
    observations: Array<{ provider: string; state: string; observedAt: string; sourceUrl?: string; excerpt?: string; values?: unknown }>;
    advisory?: AiAdvisory;
  }): Promise<ReviewCandidate> {
    const observations = input.observations.map(({ excerpt, ...observation }) => ({ ...observation, excerpt: excerpt && redactEvidence(excerpt).slice(0, 6000) }));
    const provenance = {
      evidence: observations.map((observation) => observation.sourceUrl ?? `${observation.provider}: ${observation.state}`),
      observations,
      advisory: input.advisory
    };
    const rows = await this.#query<{ id: string }>(`
      with locked as (
        select pg_advisory_xact_lock(hashtextextended($1::text, 0))
      ), active_checkpoint as (
        select checkpoint.run_id, checkpoint.cycle_membership_id, membership.resource_snapshot_id
        from review_workspace.run_checkpoints checkpoint
        join review_workspace.run_current_state state on state.run_id = checkpoint.run_id
        left join review_workspace.cycle_memberships membership on membership.id = checkpoint.cycle_membership_id
        where checkpoint.run_id = $2::uuid and checkpoint.resource_id = $1::uuid
          and checkpoint.lease_token = $8::uuid and checkpoint.state = 'leased'
          and checkpoint.lease_expires_at > now()
          and state.status in ('queued', 'running', 'paused')
        for update of state
      ), snapshot as (
        select snapshots.id, active_checkpoint.cycle_membership_id
        from active_checkpoint
        join review_workspace.resource_snapshots snapshots
          on snapshots.id = active_checkpoint.resource_snapshot_id and snapshots.resource_id = $1::uuid
        cross join locked
        union all
        select snapshots.id, null::uuid
        from active_checkpoint
        join review_workspace.resource_snapshots snapshots on snapshots.resource_id = $1::uuid
        cross join locked
        where active_checkpoint.cycle_membership_id is null
          and snapshots.id = (
            select linked.id
            from review_workspace.resource_snapshot_receipts receipt
            join review_workspace.resource_snapshots linked on linked.id = receipt.resource_snapshot_id
            where linked.resource_id = $1::uuid order by linked.imported_at desc limit 1
          )
      ), previous as (
        select state.candidate_id, state.candidate_revision_id, state.revision
        from review_workspace.candidate_current_state state
        join review_workspace.candidate_revisions revision on revision.id = state.candidate_revision_id
        cross join locked
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
        from jsonb_array_elements($6::jsonb) entry cross join active_checkpoint
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
      ), linked_membership as (
        insert into review_workspace.candidate_revision_cycle_memberships (candidate_revision_id, cycle_membership_id)
        select inserted_revision.id, snapshot.cycle_membership_id from inserted_revision cross join snapshot
        where snapshot.cycle_membership_id is not null
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
    `, [input.resourceId, input.runId, input.kind, JSON.stringify(input.beforeValues), JSON.stringify(input.proposedValues), JSON.stringify(observations), JSON.stringify(provenance), input.leaseToken]);
    if (!rows[0]) throw new Error("An active leased checkpoint and seeded resource snapshot are required before staging review evidence.");
    return (await this.get(rows[0].id))!;
  }

  async stageDiscoveryCandidate(input: {
    leadId: string;
    lineageId: string;
    runId: string;
    leaseToken: string;
    proposedValues: FieldValues;
    observations: Array<{ provider: string; state: string; observedAt: string; sourceUrl?: string; excerpt?: string; values?: unknown }>;
    advisory?: AiAdvisory;
    advisoryUnavailable?: boolean;
  }): Promise<ReviewCandidate> {
    const observations = input.observations.map(({ excerpt, ...observation }) => ({ ...observation, excerpt: excerpt && redactEvidence(excerpt).slice(0, 6000) }));
    const provenance = {
      evidence: observations.map((observation) => observation.sourceUrl ?? `${observation.provider}: ${observation.state}`),
      observations,
      ...(input.advisory ? { advisory: input.advisory } : {}),
      ...(input.advisoryUnavailable ? { advisoryUnavailable: true } : {})
    };
    const rows = await this.#query<{ id: string }>(`
      with locked as (
        select pg_advisory_xact_lock(hashtextextended($1::text, 0))
      ), active_checkpoint as (
        select checkpoint.run_id
        from locked cross join review_workspace.run_checkpoints checkpoint
        join review_workspace.run_current_state state on state.run_id = checkpoint.run_id
        where checkpoint.run_id = $2::uuid and checkpoint.discovery_lead_id = $1::uuid
          and checkpoint.lease_token = $7::uuid and checkpoint.state = 'leased'
          and checkpoint.lease_expires_at > now() and state.status in ('queued', 'running', 'paused')
        for update of checkpoint
      ), previous as (
        select state.candidate_id, state.candidate_revision_id
        from review_workspace.candidate_current_state state
        join review_workspace.candidate_revision_discovery_lineages link on link.candidate_revision_id = state.candidate_revision_id
        where link.lineage_id = $3::uuid
        order by state.updated_at desc limit 1
      ), observations as (
        insert into review_workspace.source_observations
          (run_id, provider, observation_key, observed_at, extracted_values, retrieval_metadata)
        select $2::uuid, entry->>'provider', coalesce(entry->>'sourceUrl', entry->>'provider') || ':' || entry->>'observedAt',
          (entry->>'observedAt')::timestamptz, coalesce(entry->'values', '{}'::jsonb),
          jsonb_build_object('state', entry->>'state', 'sourceUrl', entry->>'sourceUrl', 'excerpt', entry->>'excerpt')
        from jsonb_array_elements($5::jsonb) entry cross join active_checkpoint
        on conflict (provider, observation_key, observed_at) do nothing
        returning id
      ), linked_observations as (
        insert into review_workspace.discovery_observations (lineage_id, source_observation_id)
        select $3::uuid, id from observations on conflict do nothing
      ), inserted_revision as (
        insert into review_workspace.candidate_revisions
          (resource_id, run_id, kind, before_values, proposed_values, provenance, supersedes_candidate_revision_id)
        select null, $2::uuid, 'new_resource', '{}'::jsonb, $4::jsonb, $6::jsonb, previous.candidate_revision_id
        from active_checkpoint left join previous on true cross join locked
        returning id
      ), linked_lineage as (
        insert into review_workspace.candidate_revision_discovery_lineages (candidate_revision_id, lineage_id)
        select id, $3::uuid from inserted_revision
      ), updated_state as (
        update review_workspace.candidate_current_state state
        set candidate_revision_id = inserted_revision.id, revision = state.revision + 1,
            status = 'staged', approved_field_paths = '[]'::jsonb, updated_at = now()
        from inserted_revision, previous
        where state.candidate_id = previous.candidate_id
        returning state.candidate_id as id
      ), inserted_state as (
        insert into review_workspace.candidate_current_state
          (candidate_revision_id, external_id, revision, status)
        select id, 'discovery:' || $3::text, 1, 'staged' from inserted_revision
        where not exists (select 1 from previous)
        returning candidate_id as id
      )
      select id from updated_state union all select id from inserted_state
    `, [input.leadId, input.runId, input.lineageId, JSON.stringify(input.proposedValues), JSON.stringify(observations), JSON.stringify(provenance), input.leaseToken]);
    if (!rows[0]) throw new Error("An active leased discovery lead checkpoint is required before staging a candidate.");
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

  async #decisionHistory(candidateId: string): Promise<ReviewDecisionRecord[]> {
    const rows = await this.#query<Omit<ReviewDecisionRecord, "revision"> & { revision: number }>(`
      with recursive lineage as (
        select state.candidate_revision_id as id, 0 as depth
        from review_workspace.candidate_current_state state
        where state.candidate_id = $1::uuid
        union all
        select revision.supersedes_candidate_revision_id, lineage.depth + 1
        from review_workspace.candidate_revisions revision
        join lineage on lineage.id = revision.id
        where revision.supersedes_candidate_revision_id is not null
      ), history as (
        select decision.decision::text as action, decision.reviewer_subject as "reviewerSubject",
          coalesce(decision.rationale, '') as reason, decision.approved_field_paths as fields, decision.reviewer_cbo_eligibility as "cboEligibility", decision.decided_at as at
        from review_workspace.review_decisions decision
        join lineage on lineage.id = decision.candidate_revision_id
        union all
        select 'superseded'::text as action,
          revision.provenance->'reviewerEdit'->>'subject' as "reviewerSubject",
          coalesce(revision.provenance->'reviewerEdit'->>'reason', '') as reason,
          '[]'::jsonb as fields, null::boolean as "cboEligibility", revision.created_at as at
        from review_workspace.candidate_revisions revision
        join lineage on lineage.id = revision.id
        where jsonb_typeof(revision.provenance->'reviewerEdit') = 'object'
      )
      select row_number() over (order by at)::integer as revision, action, "reviewerSubject", reason, fields, "cboEligibility", at
      from history
      order by at
    `, [candidateId]);
    return rows.map((decision) => ({ ...decision, fields: decision.fields?.length ? decision.fields : undefined }));
  }
}

export const reviewRepository = new NeonReviewRepository();
