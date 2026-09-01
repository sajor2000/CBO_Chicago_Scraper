import { randomUUID } from "node:crypto";
import { assertReviewWorkspace, reviewWorkspaceDb } from "../db.ts";
import type { CheckpointOutcome, FrozenCycleMembership, RunMode, RunStatus } from "../domain/review-workspace.ts";
import { DISCOVERY_MAX_PROVIDER_CALLS, DISCOVERY_MAX_QUERY_CELLS, DISCOVERY_MAX_UNIQUE_LEADS, DISCOVERY_POLICY_VERSION, type DiscoveryQueryCell } from "../discovery/query-matrix.ts";
import type { CapturedObservation } from "../retrieval/types.ts";

export interface VerificationRun {
  id: string;
  idempotencyKey: string;
  selection: string[];
  budget: number;
  checkpoint: number;
  status: RunStatus;
  mode: RunMode;
  manifestId?: string;
  memberships: FrozenCycleMembership[];
  report: RunReport;
}

export type CheckpointClaim = {
  checkpoint: number;
  leaseToken: string;
  attempt: number;
  resourceId?: string;
  snapshotId?: string;
  discoveryQueryCellId?: string;
  discoveryLeadId?: string;
};

export type DiscoveryRunLaunch = {
  idempotencyKey: string;
  cells: readonly DiscoveryQueryCell[];
  uniqueLeadCap: number;
  providerCallBudget: number;
  dailyProviderCallCeiling: number;
};

export type DurableDiscoveryQueryCell = DiscoveryQueryCell & { id: string; runId: string; resultCap: number };

export interface RunReport {
  recordsChecked: number;
  candidatesStaged: number;
  conflicts: number;
  unableToVerify: number;
  providerFailures: number;
  budgetUsed: number;
}

export interface SiteVerificationReport {
  runId: string;
  resourceId: string;
  resourceName: string;
  outcome: CheckpointOutcome;
  verificationState?: string;
  completedAt: string;
  reasons: string[];
  providerIssues: string[];
  candidateId?: string;
  evidence: {
    observations: Array<{ provider: string; state: string; observedAt: string; sourceUrl?: string; excerpt?: string; values?: Record<string, string> }>;
    advisory?: { cboEligibility?: string; operationalAssessment?: string; evidenceQuality?: string; suggestedCategory?: string; rationale?: string };
  };
}

export type SiteReportPayload = Omit<SiteVerificationReport, "runId" | "resourceId" | "outcome" | "completedAt" | "candidateId">;

export class RunLockError extends Error {
  constructor() {
    super("A checkpoint is already claimed.");
    this.name = "RunLockError";
  }
}

const blankReport = (): RunReport => ({ recordsChecked: 0, candidatesStaged: 0, conflicts: 0, unableToVerify: 0, providerFailures: 0, budgetUsed: 0 });
const copy = (run: VerificationRun) => structuredClone(run);
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const publicSourceUrl = (value?: string) => {
  try {
    if (!value) return undefined;
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    url.username = ""; url.password = ""; url.search = ""; url.hash = "";
    return url.toString();
  } catch { return undefined; }
};
export const scheduledRunKey = () => `scheduled:${randomUUID()}`;

/** Fixture-only synchronous registry. */
export class InMemoryRunRegistry {
  #runs = new Map<string, VerificationRun>();
  #byIdempotency = new Map<string, string>();
  #claims = new Map<string, string>();
  #attempts = new Map<string, number>();
  #nextDue = new Map<string, string>();
  #nextId = 1;

  launch(input: { idempotencyKey: string; selection?: string[]; memberships?: FrozenCycleMembership[]; manifestId?: string; mode?: RunMode; budget: number }): VerificationRun {
    const existingId = this.#byIdempotency.get(input.idempotencyKey);
    if (existingId) return copy(this.#runs.get(existingId)!);
    const mode = input.mode ?? "manual_selected";
    if (mode === "manual_full_cycle" || mode === "scheduled_cycle") {
      const active = [...this.#runs.values()].find((run) => (run.mode === "manual_full_cycle" || run.mode === "scheduled_cycle") && ["queued", "running", "paused"].includes(run.status));
      if (active) return copy(active);
    }
    const memberships = input.memberships ?? (input.selection ?? []).map((resourceId) => ({ resourceId, snapshotId: "" }));
    const selection = memberships.map(({ resourceId }) => resourceId);
    if (!input.idempotencyKey || input.budget < 1 || input.budget > selection.length || selection.length > 100) throw new Error("A positive budget, idempotency key, and at most 100 selected resources are required.");
    if ((mode === "manual_full_cycle" || mode === "scheduled_cycle") && (!input.manifestId || memberships.some(({ snapshotId }) => !snapshotId))) throw new Error("Full cycles require a promoted manifest and frozen snapshots.");
    const run: VerificationRun = { id: `run-${this.#nextId++}`, idempotencyKey: input.idempotencyKey, selection, memberships: structuredClone(memberships), manifestId: input.manifestId, mode, budget: input.budget, checkpoint: 0, status: "queued", report: blankReport() };
    this.#runs.set(run.id, run);
    this.#byIdempotency.set(run.idempotencyKey, run.id);
    return copy(run);
  }

  get(runId: string): VerificationRun | undefined {
    const run = this.#runs.get(runId);
    return run && copy(run);
  }

  claimNext(runId: string): CheckpointClaim | undefined {
    const run = this.#require(runId);
    if (["paused", "cancelled", "completed", "failed"].includes(run.status)) return undefined;
    if (this.#claims.has(run.id)) throw new RunLockError();
    if (run.checkpoint >= run.selection.length) {
      run.status = "completed";
      return undefined;
    }
    if (run.report.budgetUsed >= run.budget) {
      run.status = "paused";
      return undefined;
    }
    run.status = "running";
    const leaseToken = `lease-${run.id}-${run.checkpoint}-${run.report.budgetUsed}`;
    const attemptKey = `${run.id}:${run.checkpoint}`;
    const attempt = (this.#attempts.get(attemptKey) ?? 0) + 1;
    this.#attempts.set(attemptKey, attempt);
    this.#claims.set(run.id, leaseToken);
    return { resourceId: run.selection[run.checkpoint]!, snapshotId: run.memberships[run.checkpoint]?.snapshotId || undefined, checkpoint: run.checkpoint, leaseToken, attempt };
  }

  completeCheckpoint(runId: string, leaseToken: string, report: Partial<Omit<RunReport, "recordsChecked" | "budgetUsed">>, outcome: CheckpointOutcome, now = new Date()) {
    const run = this.#require(runId);
    if (this.#claims.get(run.id) !== leaseToken) throw new RunLockError();
    const paused = run.status === "paused";
    run.checkpoint += 1;
    run.report.recordsChecked += 1;
    run.report.budgetUsed += 1;
    for (const key of ["candidatesStaged", "conflicts", "unableToVerify", "providerFailures"] as const) run.report[key] += report[key] ?? 0;
    this.#claims.delete(run.id);
    if ((run.mode === "manual_full_cycle" || run.mode === "scheduled_cycle") && ["verified_no_change", "candidate_staged", "conflict"].includes(outcome)) {
      const resourceId = run.selection[run.checkpoint - 1]!;
      this.#nextDue.set(resourceId, new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString());
    }
    if (outcome === "budget_exhausted" || (run.report.budgetUsed >= run.budget && run.checkpoint < run.selection.length)) run.status = "paused";
    else if (run.checkpoint >= run.selection.length) run.status = "completed";
    else if (paused) run.status = "paused";
    else run.status = "queued";
  }

  releaseLease(runId: string) {
    const run = this.#require(runId);
    if (!this.#claims.has(run.id)) return;
    this.#claims.delete(run.id);
    if (run.status === "running") run.status = "queued";
  }

  cancel(runId: string) {
    const run = this.#require(runId);
    this.#claims.delete(run.id);
    run.status = "cancelled";
  }

  pause(runId: string) {
    const run = this.#require(runId);
    if (run.status === "cancelled" || run.status === "completed") return;
    run.status = "paused";
  }

  resume(runId: string, additionalBudget = 0): VerificationRun {
    const run = this.#require(runId);
    if (run.status === "cancelled") throw new Error("A cancelled run is terminal.");
    if (run.status === "completed") return copy(run);
    const remaining = run.selection.length - run.budget;
    if (!Number.isInteger(additionalBudget) || additionalBudget < 0 || additionalBudget > remaining) throw new Error("Additional budget must fit the remaining frozen scope.");
    if (run.report.budgetUsed >= run.budget && additionalBudget === 0) throw new Error("Additional budget is required to continue this run.");
    run.budget += additionalBudget;
    run.status = "queued";
    return copy(run);
  }

  nextDueAt(resourceId: string): string | undefined {
    return this.#nextDue.get(resourceId);
  }

  #require(runId: string): VerificationRun {
    const run = this.#runs.get(runId);
    if (!run) throw new Error("Run not found.");
    return run;
  }
}

type Sql = ReturnType<typeof reviewWorkspaceDb>;

type RunRow = {
  id: string;
  idempotency_key: string;
  selection: string[];
  budget: number;
  checkpoint: number;
  status: RunStatus;
  run_mode: RunMode;
  refresh_manifest_id: string | null;
  memberships: FrozenCycleMembership[];
  report: RunReport;
};

const dbReport = (report: Partial<RunReport> = {}): RunReport => ({ ...blankReport(), ...report });
const fromRow = (row: RunRow): VerificationRun => ({
  id: row.id,
  idempotencyKey: row.idempotency_key,
  selection: row.selection ?? [],
  budget: Number(row.budget),
  checkpoint: Number(row.checkpoint),
  status: row.status,
  mode: row.run_mode ?? "manual_selected",
  manifestId: row.refresh_manifest_id ?? undefined,
  memberships: row.memberships ?? (row.selection ?? []).map((resourceId) => ({ resourceId, snapshotId: "" })),
  report: dbReport(row.report)
});

const runSelect = (memberships = "'[]'::jsonb") => `
  select run.id, run.idempotency_key,
    coalesce(run.run_parameters->'selection', '[]'::jsonb) as selection,
    coalesce((run.run_parameters->>'budget')::integer, 0) as budget,
    state.next_checkpoint_ordinal as checkpoint, state.status, run.run_mode,
    manifest.id as refresh_manifest_id,
    ${memberships} as memberships,
    coalesce(report.report, '{}'::jsonb) as report
  from review_workspace.verification_runs run
  join review_workspace.run_current_state state on state.run_id = run.id
  left join review_workspace.verification_cycles cycle on cycle.id = run.cycle_id
  left join review_workspace.refresh_manifests manifest on manifest.id = cycle.refresh_manifest_id
  left join review_workspace.run_reports report on report.run_id = run.id
`;

/** Durable production registry. The synchronous in-memory registry above stays for fixture tests. */
export class NeonRunRegistry {
  #client?: Sql;
  #createClient: () => Sql;

  constructor(createClient: () => Sql = reviewWorkspaceDb) {
    this.#createClient = createClient;
  }

  async launch(input: { idempotencyKey: string; selection: string[]; budget: number }): Promise<VerificationRun> {
    return this.#launch({ ...input, mode: "manual_selected", triggerKind: "manual", maximumSelection: 100 });
  }

  async launchDiscovery(input: DiscoveryRunLaunch): Promise<VerificationRun> {
    const cells = [...input.cells];
    if (!input.idempotencyKey || !cells.length || cells.length > DISCOVERY_MAX_QUERY_CELLS) throw new Error(`Discovery requires between 1 and ${DISCOVERY_MAX_QUERY_CELLS} approved query cells.`);
    if (input.uniqueLeadCap < 1 || input.uniqueLeadCap > DISCOVERY_MAX_UNIQUE_LEADS) throw new Error(`Discovery unique-lead cap must be between 1 and ${DISCOVERY_MAX_UNIQUE_LEADS}.`);
    if (input.providerCallBudget < cells.length || input.providerCallBudget > DISCOVERY_MAX_PROVIDER_CALLS || input.providerCallBudget > input.dailyProviderCallCeiling) throw new Error("Discovery provider-call budget is outside the approved cap.");
    if (cells.some((cell) => !cell.query.trim() || cell.query.length > 500)) throw new Error("Discovery query cells must contain bounded query text.");
    const rows = await this.#query<{ id: string }>(`
      with locked as (
        select pg_advisory_xact_lock(hashtextextended('discovery_launch', 0))
      ), activation as (
        select activation.active, activation.daily_provider_call_ceiling
        from review_workspace.discovery_activation_current current
        join review_workspace.discovery_activations activation on activation.id = current.activation_id
        where current.singleton and current.active
      ), active as (
        select run.id
        from locked cross join review_workspace.verification_runs run
        join review_workspace.run_current_state state on state.run_id = run.id
        where run.run_mode = 'discovery_only' and state.status in ('queued', 'running', 'paused')
      ), budget as (
        insert into review_workspace.discovery_provider_budget_days (budget_day, reserved_calls)
        select current_date, $3::integer from activation cross join locked
        where $3::integer <= activation.daily_provider_call_ceiling
          and not exists (select 1 from active)
          and not exists (select 1 from review_workspace.verification_runs where idempotency_key = $1)
        on conflict (budget_day) do update
          set reserved_calls = review_workspace.discovery_provider_budget_days.reserved_calls + excluded.reserved_calls,
              updated_at = now()
          where review_workspace.discovery_provider_budget_days.reserved_calls + excluded.reserved_calls <=
            (select daily_provider_call_ceiling from activation)
        returning budget_day
      ), inserted_run as (
        insert into review_workspace.verification_runs (idempotency_key, trigger_kind, run_mode, run_parameters)
        select $1, 'manual', 'discovery_only', jsonb_build_object(
          'budget', $3::integer,
          'reservedCalls', $3::integer,
          'usedCalls', 0,
          'uniqueLeadCap', $2::integer,
          'policyVersion', $6,
          'budgetDay', (select budget_day from budget)
        )
        where exists (select 1 from budget)
        on conflict (idempotency_key) do nothing
        returning id
      ), inserted_state as (
        insert into review_workspace.run_current_state (run_id, status)
        select id, 'queued' from inserted_run
      ), inserted_report as (
        insert into review_workspace.run_reports (run_id, report)
        select id, $5::jsonb from inserted_run
      ), cells as (
        insert into review_workspace.discovery_query_cells (run_id, ordinal, category_code, county, provider, query_text, policy_version, result_cap)
        select run.id, entry.ordinal - 1, entry.value->>'category', entry.value->>'county', entry.value->>'provider', entry.value->>'query', $6, 5
        from inserted_run run cross join jsonb_array_elements($7::jsonb) with ordinality entry(value, ordinal)
        returning id, run_id, ordinal
      )
      insert into review_workspace.run_checkpoints (run_id, ordinal, discovery_query_cell_id)
      select run_id, ordinal, id from cells
      on conflict (run_id, ordinal) do nothing
      returning run_id as id
    `, [input.idempotencyKey, input.uniqueLeadCap, input.providerCallBudget, input.dailyProviderCallCeiling, JSON.stringify(blankReport()), DISCOVERY_POLICY_VERSION, JSON.stringify(cells)]);
    const runId = rows[0]?.id ?? (await this.#query<{ id: string }>("select id from review_workspace.verification_runs where idempotency_key = $1", [input.idempotencyKey]))[0]?.id;
    if (!runId) throw new Error("Discovery is disabled, already active, or lacks provider-call budget.");
    return (await this.get(runId))!;
  }

  async discoveryQueryCell(queryCellId: string): Promise<DurableDiscoveryQueryCell | undefined> {
    const rows = await this.#query<{ id: string; run_id: string; category_code: DurableDiscoveryQueryCell["category"]; county: DurableDiscoveryQueryCell["county"]; provider: DurableDiscoveryQueryCell["provider"]; query_text: string; result_cap: number }>(`
      select id, run_id, category_code, county, provider, query_text, result_cap
      from review_workspace.discovery_query_cells where id = $1::uuid
    `, [queryCellId]);
    const row = rows[0];
    return row && { id: row.id, runId: row.run_id, category: row.category_code, county: row.county, provider: row.provider, query: row.query_text, resultCap: Number(row.result_cap) };
  }

  async completeDiscoveryQueryCell(input: { runId: string; queryCellId: string; leaseToken: string; observations: CapturedObservation[] }): Promise<void> {
    const observations = input.observations.slice(0, 5).map(({ provider, state, observedAt, sourceUrl, values }) => ({
      provider, state, observedAt, sourceUrl: publicSourceUrl(sourceUrl), values
    }));
    const rows = await this.#query<{ completed: boolean }>(`
      with locked as (
        select pg_advisory_xact_lock(hashtextextended($1::text, 0))
      ), checkpoint as (
        select checkpoint.ordinal
        from locked cross join review_workspace.run_checkpoints checkpoint
        join review_workspace.discovery_query_cells cell on cell.id = checkpoint.discovery_query_cell_id
        where checkpoint.run_id = $1::uuid and cell.id = $2::uuid
          and checkpoint.lease_token = $3::uuid and checkpoint.state = 'leased'
          and checkpoint.lease_expires_at > now()
        for update of checkpoint
      ), normalized as (
        select entry.value, entry.ordinal
        from jsonb_array_elements($4::jsonb) with ordinality entry(value, ordinal)
        where exists (select 1 from checkpoint)
      ), observations as (
        insert into review_workspace.source_observations
          (run_id, provider, observation_key, observed_at, extracted_values, retrieval_metadata)
        select $1::uuid, value->>'provider', $2 || ':' || ordinal,
          (value->>'observedAt')::timestamptz, coalesce(value->'values', '{}'::jsonb),
          jsonb_build_object('state', value->>'state', 'sourceUrl', value->>'sourceUrl', 'discoveryQueryCellId', $2)
        from normalized
        on conflict (provider, observation_key, observed_at) do nothing
        returning id, observation_key
      ), lineages as (
        insert into review_workspace.discovery_lineages
          (display_name, display_address, display_phone, normalized_name, normalized_address, place_id, canonical_domain, normalized_phone)
        select value->'values'->>'name', value->'values'->>'address', value->'values'->>'phone',
          lower(regexp_replace(value->'values'->>'name', '[^a-zA-Z0-9]+', '', 'g')),
          lower(regexp_replace(value->'values'->>'address', '[^a-zA-Z0-9]+', '', 'g')),
          value->'values'->>'placeId',
          lower(regexp_replace(coalesce(value->'values'->>'url', ''), '^https?://(www\\.)?', '')),
          regexp_replace(coalesce(value->'values'->>'phone', ''), '[^0-9]+', '', 'g')
        from normalized
        where value->>'state' = 'success'
          and nullif(value->'values'->>'name', '') is not null
          and nullif(value->'values'->>'address', '') is not null
        on conflict (normalized_name, normalized_address) do nothing
        returning id
      ), linked_observations as (
        insert into review_workspace.discovery_observations (lineage_id, source_observation_id)
        select lineage.id, source.id
        from normalized
        join review_workspace.discovery_lineages lineage
          on lineage.normalized_name = lower(regexp_replace(normalized.value->'values'->>'name', '[^a-zA-Z0-9]+', '', 'g'))
         and lineage.normalized_address = lower(regexp_replace(normalized.value->'values'->>'address', '[^a-zA-Z0-9]+', '', 'g'))
        join review_workspace.source_observations source
          on source.run_id = $1::uuid and source.observation_key = $2 || ':' || normalized.ordinal
        where normalized.value->>'state' = 'success'
        on conflict do nothing
      ), inserted_leads as (
        insert into review_workspace.discovery_leads (run_id, lineage_id, first_query_cell_id, disposition)
        select $1::uuid, lineage.id, $2::uuid, 'pending'
        from normalized
        join review_workspace.discovery_lineages lineage
          on lineage.normalized_name = lower(regexp_replace(normalized.value->'values'->>'name', '[^a-zA-Z0-9]+', '', 'g'))
         and lineage.normalized_address = lower(regexp_replace(normalized.value->'values'->>'address', '[^a-zA-Z0-9]+', '', 'g'))
        where normalized.value->>'state' = 'success'
        on conflict (run_id, lineage_id) do nothing
        returning id
      ), ranked_leads as (
        select lead.id, row_number() over (order by lead.created_at, lead.id) as ordinal
        from review_workspace.discovery_leads lead
        where lead.run_id = $1::uuid and lead.disposition = 'pending'
          and not exists (
            select 1 from review_workspace.run_checkpoints checkpoint
            where checkpoint.discovery_lead_id = lead.id
          )
      ), over_budget_leads as (
        update review_workspace.discovery_leads lead
        set disposition = 'not_processed_budget', reasons = '["Unique-lead cap reached."]'::jsonb
        from ranked_leads ranked
        where lead.id = ranked.id
          and ranked.ordinal > coalesce((select (run_parameters->>'uniqueLeadCap')::integer from review_workspace.verification_runs where id = $1::uuid), 0)
        returning lead.id
      ), allowed_leads as (
        select ranked.id, ranked.ordinal
        from ranked_leads ranked
        where ranked.ordinal <= coalesce((select (run_parameters->>'uniqueLeadCap')::integer from review_workspace.verification_runs where id = $1::uuid), 0)
      ), checkpoints as (
        insert into review_workspace.run_checkpoints (run_id, ordinal, discovery_lead_id)
        select $1::uuid,
          (select coalesce(max(ordinal), -1) + 1 from review_workspace.run_checkpoints where run_id = $1::uuid) + allowed.ordinal - 1,
          allowed.id
        from allowed_leads allowed cross join locked
        on conflict (run_id, ordinal) do nothing
      )
      select review_workspace.complete_run_checkpoint($1::uuid, $3::uuid, 'query_completed',
        jsonb_build_object(
          'recordsChecked', 0,
          'budgetUsed', 0,
          'queryCellId', $2,
          'returnedResults', jsonb_array_length($4::jsonb),
          'providerFailures', case when jsonb_array_length($4::jsonb) > 0
            and not exists (select 1 from jsonb_array_elements($4::jsonb) item where item->>'state' in ('success', 'no_result'))
            then 1 else 0 end
        )) as completed
      from checkpoint
    `, [input.runId, input.queryCellId, input.leaseToken, JSON.stringify(observations)]);
    if (!rows[0]?.completed) throw new RunLockError();
  }

  async completeDiscoveryLead(input: { runId: string; leadId: string; leaseToken: string; outcome: Extract<CheckpointOutcome, "candidate_staged" | "duplicate" | "possible_duplicate" | "out_of_scope" | "not_a_cbo" | "insufficient_evidence" | "provider_failure">; reasons: string[] }): Promise<void> {
    const rows = await this.#query<{ completed: boolean }>(`
      with checkpoint as (
        select checkpoint.run_id, lead.lineage_id
        from review_workspace.run_checkpoints checkpoint
        join review_workspace.discovery_leads lead on lead.id = checkpoint.discovery_lead_id
        where checkpoint.run_id = $1::uuid and checkpoint.discovery_lead_id = $2::uuid
          and checkpoint.lease_token = $3::uuid and checkpoint.state = 'leased'
          and checkpoint.lease_expires_at > now()
        for update of checkpoint
      ), updated_lead as (
        update review_workspace.discovery_leads lead
        set disposition = $4, reasons = $5::jsonb
        from checkpoint
        where lead.id = $2::uuid and lead.run_id = checkpoint.run_id
        returning lead.lineage_id
      ), evaluation as (
        insert into review_workspace.discovery_evaluations (lineage_id, identity_policy_version, disposition, reasons)
        select lineage_id, 'discovery-v1', $4, $5::jsonb from updated_lead
      )
      select review_workspace.complete_run_checkpoint($1::uuid, $3::uuid, $4,
        jsonb_build_object(
          'recordsChecked', 1,
          'candidatesStaged', case when $4 = 'candidate_staged' then 1 else 0 end,
          'conflicts', case when $4 = 'possible_duplicate' then 1 else 0 end,
          'unableToVerify', case when $4 = 'insufficient_evidence' then 1 else 0 end,
          'providerFailures', case when $4 = 'provider_failure' then 1 else 0 end,
          'budgetUsed', 1,
          'discoveryLeadId', $2,
          'reasons', $5::jsonb
        )) as completed
      from checkpoint
    `, [input.runId, input.leadId, input.leaseToken, input.outcome, JSON.stringify(input.reasons.slice(0, 10).map((reason) => reason.slice(0, 500)))]);
    if (!rows[0]?.completed) throw new RunLockError();
  }

  async launchFullCycle(input: { idempotencyKey: string; manifestId: string; budget: number }): Promise<VerificationRun> {
    const active = await this.#query<{ id: string }>(`
      select run.id from review_workspace.verification_runs run
      join review_workspace.run_current_state state on state.run_id = run.id
      where run.run_mode in ('manual_full_cycle', 'scheduled_cycle') and state.status in ('queued', 'running', 'paused')
      order by run.started_at limit 1
    `);
    if (active[0]) return (await this.get(active[0].id))!;
    const rows = await this.#query<{ resource_id: string; resource_snapshot_id: string }>(`
      select membership.resource_id, membership.resource_snapshot_id
      from review_workspace.refresh_snapshot_memberships membership
      join review_workspace.refresh_manifests manifest on manifest.id = membership.manifest_id
      left join review_workspace.resource_verification_due due on due.resource_id = membership.resource_id
      where manifest.id = $1::uuid and manifest.status = 'reconciled'
        and (due.next_due_at is null or due.next_due_at <= now())
      order by membership.resource_id
    `, [input.manifestId]);
    if (!rows.length) throw new Error("A promoted reconciled refresh with due resources is required.");
    return this.#launch({
      idempotencyKey: input.idempotencyKey,
      manifestId: input.manifestId,
      memberships: rows.map((row) => ({ resourceId: row.resource_id, snapshotId: row.resource_snapshot_id })),
      selection: rows.map((row) => row.resource_id),
      budget: input.budget,
      mode: "manual_full_cycle",
      triggerKind: "manual",
      maximumSelection: 10_000
    });
  }

  /** Derives the current due cohort from the latest promoted manifest; callers never submit its IDs. */
  async launchCurrentFullCycle(input: { idempotencyKey: string; budget: number }): Promise<VerificationRun> {
    const manifest = await this.#query<{ id: string }>(`
      select id
      from review_workspace.refresh_manifests
      where status = 'reconciled'
      order by promoted_at desc
      limit 1
    `);
    if (!manifest[0]?.id) throw new Error("A promoted reconciled refresh is required before a full cycle can start.");
    return this.launchFullCycle({ ...input, manifestId: manifest[0].id });
  }

  async fullCyclePreview(): Promise<{ dueCount: number } | undefined> {
    const rows = await this.#query<{ due_count: number }>(`
      select count(*)::integer as due_count
      from review_workspace.refresh_snapshot_memberships membership
      join review_workspace.refresh_manifests manifest on manifest.id = membership.manifest_id
      left join review_workspace.resource_verification_due due on due.resource_id = membership.resource_id
      where manifest.status = 'reconciled'
        and manifest.id = (
          select id from review_workspace.refresh_manifests
          where status = 'reconciled'
          order by promoted_at desc
          limit 1
        )
        and (due.next_due_at is null or due.next_due_at <= now())
    `);
    return rows[0] ? { dueCount: Number(rows[0].due_count) } : undefined;
  }

  /** Starts or resumes the active scheduled cohort over every due seeded resource. */
  async launchScheduled(now = new Date()): Promise<VerificationRun | undefined> {
    const active = await this.#query<{ id: string }>(`
      select run.id
      from review_workspace.verification_runs run
      join review_workspace.run_current_state state on state.run_id = run.id
      where (run.run_mode = 'manual_selected' and state.status in ('queued', 'running'))
         or (run.run_mode in ('manual_full_cycle', 'scheduled_cycle') and state.status in ('queued', 'running', 'paused'))
      order by run.started_at asc limit 1
    `);
    if (active[0]?.id) return (await this.get(active[0].id))!;
    const memberships = await this.#query<{ resource_id: string; resource_snapshot_id: string; manifest_id: string }>(`
      select membership.resource_id, membership.resource_snapshot_id, membership.manifest_id
      from review_workspace.refresh_snapshot_memberships membership
      join review_workspace.refresh_manifests manifest on manifest.id = membership.manifest_id
      left join review_workspace.resource_verification_due due on due.resource_id = membership.resource_id
      where manifest.status = 'reconciled'
        and manifest.id = (select id from review_workspace.refresh_manifests where status = 'reconciled' order by promoted_at desc limit 1)
        and (due.next_due_at is null or due.next_due_at <= $1)
      order by membership.resource_id
    `, [now.toISOString()]);
    if (!memberships.length) {
      const discovery = await this.#query<{ id: string }>(`
        select run.id
        from review_workspace.verification_runs run
        join review_workspace.run_current_state state on state.run_id = run.id
        where run.run_mode = 'discovery_only' and state.status in ('queued', 'running')
          and exists (
            select 1 from review_workspace.discovery_activation_current activation
            where activation.singleton and activation.active
          )
        order by run.started_at asc limit 1
      `);
      return discovery[0]?.id ? (await this.get(discovery[0].id)) : undefined;
    }
    const key = scheduledRunKey();
    return this.#launch({ idempotencyKey: key, selection: memberships.map(({ resource_id }) => resource_id), memberships: memberships.map(({ resource_id, resource_snapshot_id }) => ({ resourceId: resource_id, snapshotId: resource_snapshot_id })), manifestId: memberships[0]!.manifest_id, budget: memberships.length, mode: "scheduled_cycle", triggerKind: "scheduled", maximumSelection: 10_000 });
  }

  async #launch(input: { idempotencyKey: string; selection: string[]; memberships?: FrozenCycleMembership[]; manifestId?: string; budget: number; mode: RunMode; triggerKind: "manual" | "scheduled"; maximumSelection: number }): Promise<VerificationRun> {
    const selection = [...new Set(input.selection)];
    if (!input.idempotencyKey || !selection.length || input.budget < 1 || input.budget > selection.length || selection.length > input.maximumSelection) {
      throw new Error(`A positive budget, idempotency key, and at most ${input.maximumSelection} selected resources are required.`);
    }
    if (selection.some((resourceId) => !isUuid(resourceId))) throw new Error("Selected resource IDs must be UUIDs.");
    const missing = await this.#query<{ resource_id: string }>(`
      select selected.resource_id
      from unnest($1::uuid[]) selected(resource_id)
      where not exists (
        select 1 from review_workspace.resource_snapshots snapshot
        where snapshot.resource_id = selected.resource_id
      )
    `, [selection]);
    if (missing.length) throw new Error("Selected resources must have seeded public snapshots.");
    const rows = await this.#query<{ id: string }>(`
      with active_cycle as (
        select cycle.id from review_workspace.verification_cycles cycle
        where $6 in ('manual_full_cycle', 'scheduled_cycle') and cycle.status in ('queued', 'running', 'paused')
        order by cycle.created_at limit 1
      ), eligible_manifest as (
        select id from review_workspace.refresh_manifests
        where id = $8::uuid and status = 'reconciled'
      ), inserted_cycle as (
        insert into review_workspace.verification_cycles (refresh_manifest_id, status, due_anchor_at)
        select id, 'queued', now() from eligible_manifest
        where $6 in ('manual_full_cycle', 'scheduled_cycle') and not exists (select 1 from active_cycle)
        on conflict do nothing returning id
      ), selected_cycle as (
        select id from inserted_cycle
      ), inserted_run as (
        insert into review_workspace.verification_runs (idempotency_key, trigger_kind, run_mode, cycle_id, run_parameters)
        select $1, $7, $6, case when $6 in ('manual_full_cycle', 'scheduled_cycle') then (select id from selected_cycle) else null end,
          jsonb_build_object('selection', $2::jsonb, 'budget', $3::integer)
        where $6 not in ('manual_full_cycle', 'scheduled_cycle') or exists (select 1 from selected_cycle)
        on conflict (idempotency_key) do nothing
        returning id
      ), inserted_state as (
        insert into review_workspace.run_current_state (run_id, status)
        select id, 'queued' from inserted_run on conflict (run_id) do nothing
      ), inserted_report as (
        insert into review_workspace.run_reports (run_id, report)
        select id, $4::jsonb from inserted_run on conflict (run_id) do nothing
      ), requested_memberships as (
        select entry->>'resourceId' as resource_id, entry->>'snapshotId' as snapshot_id, ordinal
        from jsonb_array_elements($5::jsonb) with ordinality requested(entry, ordinal)
      ), frozen_memberships as (
        insert into review_workspace.cycle_memberships (cycle_id, resource_id, resource_snapshot_id, refresh_manifest_id)
        select selected_cycle.id, requested.resource_id::uuid, requested.snapshot_id::uuid, $8::uuid
        from selected_cycle cross join requested_memberships requested
        join review_workspace.refresh_snapshot_memberships frozen
          on frozen.manifest_id = $8::uuid and frozen.resource_id = requested.resource_id::uuid
          and frozen.resource_snapshot_id = requested.snapshot_id::uuid
        on conflict (cycle_id, resource_id) do nothing
        returning id, resource_id
      ), inserted_checkpoints as (
        insert into review_workspace.run_checkpoints (run_id, ordinal, resource_id, cycle_membership_id)
        select run.id, requested.ordinal - 1, requested.resource_id::uuid, membership.id
        from inserted_run run cross join requested_memberships requested
        left join frozen_memberships membership
          on membership.resource_id = requested.resource_id::uuid
        on conflict (run_id, ordinal) do nothing
      )
      select id from inserted_run
      union all
      select id from review_workspace.verification_runs where idempotency_key = $1
      limit 1
    `, [input.idempotencyKey, JSON.stringify(selection), input.budget, JSON.stringify(blankReport()), JSON.stringify(input.memberships ?? selection.map((resourceId) => ({ resourceId, snapshotId: "" }))), input.mode, input.triggerKind, input.manifestId ?? null]);
    let runId = rows[0]?.id ?? (await this.#query<{ id: string }>(
      "select id from review_workspace.verification_runs where idempotency_key = $1",
      [input.idempotencyKey]
    ))[0]?.id;
    if (!runId && (input.mode === "manual_full_cycle" || input.mode === "scheduled_cycle")) {
      runId = (await this.#query<{ id: string }>(`
        select run.id from review_workspace.verification_runs run
        join review_workspace.run_current_state state on state.run_id = run.id
        where run.run_mode in ('manual_full_cycle', 'scheduled_cycle') and state.status in ('queued', 'running', 'paused')
        order by run.started_at limit 1
      `))[0]?.id;
    }
    if (!runId) throw new Error("Run launch did not return a durable run.");
    return (await this.get(runId))!;
  }

  async get(runId: string): Promise<VerificationRun | undefined> {
    if (!isUuid(runId)) return undefined;
    const memberships = `coalesce((select jsonb_agg(jsonb_build_object('resourceId', membership.resource_id, 'snapshotId', membership.resource_snapshot_id) order by checkpoint.ordinal)
      from review_workspace.run_checkpoints checkpoint
      join review_workspace.cycle_memberships membership on membership.id = checkpoint.cycle_membership_id
      where checkpoint.run_id = run.id), '[]'::jsonb)`;
    const rows = await this.#query<RunRow>(`${runSelect(memberships)} where run.id = $1::uuid`, [runId]);
    return rows[0] && fromRow(rows[0]);
  }

  async listRecent(limit = 10): Promise<VerificationRun[]> {
    const rows = await this.#query<RunRow>(`${runSelect()} order by run.started_at desc limit $1`, [Math.max(1, Math.min(limit, 25))]);
    return rows.map(fromRow);
  }

  async listRecentSiteReports(limit = 50, runId?: string, offset = 0): Promise<SiteVerificationReport[]> {
    const rows = await this.#query<{
      run_id: string;
      resource_id: string;
      resource_name: string;
      outcome: CheckpointOutcome;
      completed_at: string;
      site_report: SiteReportPayload | null;
      candidate_id: string | null;
    }>(`
      select outcome.run_id, coalesce(checkpoint.resource_id, lead.id, cell.id) as resource_id,
        coalesce(
          nullif(snapshot.source_payload->>'organization_name', ''),
          nullif(snapshot.source_payload->>'location_name', ''),
          nullif(snapshot.source_payload->>'name', ''),
          resource.reference_source_id,
          lineage.display_name,
          cell.query_text
        ) as resource_name,
        outcome.outcome, outcome.completed_at, outcome.report_delta->'siteReport' as site_report,
        candidate.candidate_id
      from review_workspace.run_checkpoint_outcomes outcome
      join review_workspace.run_checkpoints checkpoint on checkpoint.run_id = outcome.run_id and checkpoint.ordinal = outcome.ordinal
      left join review_workspace.resources resource on resource.id = checkpoint.resource_id
      left join lateral (
        select source_payload from review_workspace.resource_snapshots
        where resource_id = checkpoint.resource_id order by imported_at desc limit 1
      ) snapshot on true
      left join review_workspace.discovery_query_cells cell on cell.id = checkpoint.discovery_query_cell_id
      left join review_workspace.discovery_leads lead on lead.id = checkpoint.discovery_lead_id
      left join review_workspace.discovery_lineages lineage on lineage.id = lead.lineage_id
      left join lateral (
        select state.candidate_id
        from review_workspace.candidate_current_state state
        join review_workspace.candidate_revisions current_revision on current_revision.id = state.candidate_revision_id
        where current_revision.resource_id = checkpoint.resource_id
           or exists (
             select 1 from review_workspace.candidate_revision_discovery_lineages link
             where link.candidate_revision_id = current_revision.id and link.lineage_id = lead.lineage_id
           )
          and exists (
            select 1 from review_workspace.candidate_revisions run_revision
            where run_revision.run_id = outcome.run_id and (
              run_revision.resource_id = checkpoint.resource_id
              or exists (
                select 1 from review_workspace.candidate_revision_discovery_lineages run_link
                where run_link.candidate_revision_id = run_revision.id and run_link.lineage_id = lead.lineage_id
              )
            )
          )
        order by state.updated_at desc limit 1
      ) candidate on true
      where ($2::uuid is null or outcome.run_id = $2::uuid)
      order by outcome.completed_at desc limit $1 offset $3
    `, [Math.max(1, Math.min(limit, 100)), runId ?? null, Math.max(0, offset)]);
    return rows.map((row) => ({
      runId: row.run_id,
      resourceId: row.resource_id,
      resourceName: row.site_report?.resourceName ?? row.resource_name,
      outcome: row.outcome,
      verificationState: row.site_report?.verificationState,
      completedAt: row.completed_at,
      reasons: row.site_report?.reasons ?? (row.outcome === "query_completed" ? ["Discovery query cell completed."] : ["This run predates detailed per-resource reports."]),
      providerIssues: row.site_report?.providerIssues ?? [],
      candidateId: row.candidate_id ?? undefined,
      evidence: row.site_report?.evidence ?? { observations: [] }
    }));
  }

  async status(runId: string): Promise<RunStatus | undefined> {
    const rows = await this.#query<{ status: RunStatus }>(
      "select status from review_workspace.run_current_state where run_id = $1::uuid",
      [runId]
    );
    return rows[0]?.status;
  }

  async claimNext(runId: string): Promise<CheckpointClaim | undefined> {
    const rows = await this.#query<{ resource_id: string | null; resource_snapshot_id: string | null; discovery_query_cell_id: string | null; discovery_lead_id: string | null; ordinal: number; lease_token: string; attempt: number }>(`
      with deactivated_discovery as (
        update review_workspace.run_current_state state
        set status = 'paused', updated_at = now(), revision = revision + 1
        from review_workspace.verification_runs run
        where state.run_id = run.id and state.run_id = $1::uuid
          and run.run_mode = 'discovery_only' and state.status in ('queued', 'running')
          and not exists (
            select 1 from review_workspace.discovery_activation_current activation
            where activation.singleton and activation.active
          )
        returning state.run_id
      ), terminal_state as (
        update review_workspace.run_current_state state
        set status = case
              when state.next_checkpoint_ordinal >= (select count(*) from review_workspace.run_checkpoints where run_id = state.run_id) then 'completed'
              else 'paused'
            end,
            updated_at = now(), revision = revision + 1
        from review_workspace.verification_runs run
        where state.run_id = run.id and state.run_id = $1::uuid
          and state.status in ('queued', 'running')
          and (state.next_checkpoint_ordinal >= (select count(*) from review_workspace.run_checkpoints where run_id = state.run_id)
            or coalesce((select (report->>'budgetUsed')::integer from review_workspace.run_reports where run_id = state.run_id), 0)
              >= (run.run_parameters->>'budget')::integer)
        returning state.run_id
      ), claimed as (
        update review_workspace.run_checkpoints checkpoint
        set state = 'leased', lease_token = gen_random_uuid(),
            lease_expires_at = now() + interval '5 minutes', attempt = attempt + 1
        from review_workspace.run_current_state state
        where checkpoint.run_id = state.run_id and checkpoint.run_id = $1::uuid
          and state.status in ('queued', 'running')
          and checkpoint.ordinal = state.next_checkpoint_ordinal
          and (checkpoint.state = 'pending' or (checkpoint.state = 'retry_wait' and checkpoint.next_attempt_at <= now()) or (checkpoint.state = 'leased' and checkpoint.lease_expires_at <= now()))
          and not exists (select 1 from deactivated_discovery)
          and not exists (select 1 from terminal_state)
        returning checkpoint.resource_id, checkpoint.cycle_membership_id, checkpoint.discovery_query_cell_id, checkpoint.discovery_lead_id, checkpoint.ordinal, checkpoint.lease_token, checkpoint.attempt
      ), started as (
        update review_workspace.run_current_state state
        set status = 'running', updated_at = now(), revision = revision + 1
        where state.run_id = $1::uuid and exists (select 1 from claimed)
        returning state.run_id
      ), started_cycle as (
        update review_workspace.verification_cycles cycle
        set status = 'running'
        from review_workspace.verification_runs run
        where run.id in (select run_id from started) and cycle.id = run.cycle_id and cycle.status <> 'running'
      )
      select claimed.resource_id, membership.resource_snapshot_id, claimed.discovery_query_cell_id, claimed.discovery_lead_id, claimed.ordinal, claimed.lease_token, claimed.attempt
      from claimed left join review_workspace.cycle_memberships membership on membership.id = claimed.cycle_membership_id
    `, [runId]);
    if (!rows[0]) {
      const run = await this.get(runId);
      if (!run || run.status === "cancelled" || run.status === "completed" || run.status === "paused") return undefined;
      throw new RunLockError();
    }
    return {
      ...(rows[0].resource_id ? { resourceId: rows[0].resource_id } : {}),
      ...(rows[0].resource_snapshot_id ? { snapshotId: rows[0].resource_snapshot_id } : {}),
      ...(rows[0].discovery_query_cell_id ? { discoveryQueryCellId: rows[0].discovery_query_cell_id } : {}),
      ...(rows[0].discovery_lead_id ? { discoveryLeadId: rows[0].discovery_lead_id } : {}),
      checkpoint: Number(rows[0].ordinal), leaseToken: rows[0].lease_token, attempt: Number(rows[0].attempt)
    };
  }

  async completeCheckpoint(runId: string, leaseToken: string, report: Partial<Omit<RunReport, "recordsChecked" | "budgetUsed">>, outcome: CheckpointOutcome, siteReport?: SiteReportPayload): Promise<void> {
    const delta = { ...dbReport({ ...report, recordsChecked: 1, budgetUsed: 1 }), ...(siteReport ? { siteReport } : {}) };
    const rows = await this.#query<{ completed: boolean }>(
      "select review_workspace.complete_run_checkpoint($1::uuid, $2::uuid, $3, $4::jsonb) as completed",
      [runId, leaseToken, outcome, JSON.stringify(delta)]
    );
    if (!rows[0]?.completed) throw new RunLockError();
  }

  /** Returns a leased checkpoint to pending so a failed worker cannot strand the run. */
  async releaseLease(runId: string, leaseToken: string): Promise<void> {
    await this.#query(`
      with released as (
        update review_workspace.run_checkpoints
        set state = 'pending', lease_token = null, lease_expires_at = null
        where run_id = $1::uuid and lease_token = $2::uuid and state = 'leased'
        returning run_id
      )
      update review_workspace.run_current_state state
      set status = case when status in ('cancelled', 'completed', 'paused') then status else 'queued' end,
          updated_at = now(), revision = revision + 1
      where state.run_id = $1::uuid and exists (select 1 from released)
    `, [runId, leaseToken]);
  }

  /** Persists the only retry windows permitted for discovery provider failures. */
  async retryDiscoveryCheckpoint(runId: string, leaseToken: string): Promise<boolean> {
    const rows = await this.#query<{ run_id: string }>(`
      with retried as (
        update review_workspace.run_checkpoints checkpoint
        set state = 'retry_wait', lease_token = null, lease_expires_at = null,
            next_attempt_at = now() + case when checkpoint.attempt = 1 then interval '1 minute' else interval '5 minutes' end
        where checkpoint.run_id = $1::uuid and checkpoint.lease_token = $2::uuid
          and checkpoint.state = 'leased' and checkpoint.lease_expires_at > now()
          and checkpoint.attempt < 3
          and (checkpoint.discovery_query_cell_id is not null or checkpoint.discovery_lead_id is not null)
        returning checkpoint.run_id
      )
      update review_workspace.run_current_state state
      set status = 'queued', updated_at = now(), revision = revision + 1
      where state.run_id in (select run_id from retried)
      returning state.run_id
    `, [runId, leaseToken]);
    return Boolean(rows[0]);
  }

  /** Charges one bounded provider attempt against the launch-time reservation. */
  async consumeDiscoveryProviderCall(runId: string): Promise<boolean> {
    const rows = await this.#query<{ id: string }>(`
      with eligible as (
        select run.id, day.budget_day
        from review_workspace.verification_runs run
        join review_workspace.discovery_provider_budget_days day
          on day.budget_day = (run.run_parameters->>'budgetDay')::date
        where run.id = $1::uuid and run.run_mode = 'discovery_only'
          and day.used_calls < day.reserved_calls
          and coalesce((run.run_parameters->>'usedCalls')::integer, 0)
            < coalesce((run.run_parameters->>'reservedCalls')::integer, 0)
        for update of run, day
      ), charged_run as (
        update review_workspace.verification_runs run
        set run_parameters = jsonb_set(
          run.run_parameters,
          '{usedCalls}',
          to_jsonb(coalesce((run.run_parameters->>'usedCalls')::integer, 0) + 1)
        )
        from eligible
        where run.id = eligible.id
        returning run.id, (run.run_parameters->>'budgetDay')::date as budget_day
      )
      update review_workspace.discovery_provider_budget_days day
      set used_calls = used_calls + 1, updated_at = now()
      from charged_run run
      where day.budget_day = run.budget_day and day.used_calls < day.reserved_calls
      returning run.id
    `, [runId]);
    return Boolean(rows[0]);
  }

  async failCheckpoint(runId: string, leaseToken: string): Promise<void> {
    const rows = await this.#query<{ run_id: string }>(`
      with checkpoint as (
        update review_workspace.run_checkpoints
        set state = 'failed', lease_token = null, lease_expires_at = null,
            report_delta = jsonb_build_object('providerFailures', 1), completed_at = now()
        where run_id = $1::uuid and lease_token = $2::uuid and state = 'leased'
          and lease_expires_at > now()
        returning run_id
      ), report as (
        update review_workspace.run_reports current
        set report = jsonb_set(
          current.report,
          '{providerFailures}',
          to_jsonb(coalesce((current.report->>'providerFailures')::integer, 0) + 1)
        ), updated_at = now()
        where current.run_id in (select run_id from checkpoint)
      ), failed_cycle as (
        update review_workspace.verification_cycles cycle
        set status = 'failed', completed_at = now()
        from review_workspace.verification_runs run
        where run.id in (select run_id from checkpoint) and cycle.id = run.cycle_id
        returning cycle.id
      )
      update review_workspace.run_current_state state
      set status = 'failed', updated_at = now(), revision = revision + 1
      where state.run_id in (select run_id from checkpoint)
        and (not exists (
          select 1 from review_workspace.verification_runs run
          where run.id = state.run_id and run.cycle_id is not null
        ) or exists (select 1 from failed_cycle))
        returning state.run_id
    `, [runId, leaseToken]);
    if (!rows[0]) throw new RunLockError();
  }

  async cancel(runId: string): Promise<void> {
    await this.#query(`
      with released as (
        update review_workspace.run_checkpoints
        set state = 'pending', lease_token = null, lease_expires_at = null
        where run_id = $1::uuid and state = 'leased'
      )
      , cancelled as (
        update review_workspace.run_current_state
        set status = 'cancelled', updated_at = now(), revision = revision + 1
        where run_id = $1::uuid and status not in ('completed', 'cancelled')
        returning run_id
      ), released_discovery_budget as (
        update review_workspace.discovery_provider_budget_days day
        set reserved_calls = greatest(
              day.used_calls,
              day.reserved_calls - greatest(
                0,
                coalesce((run.run_parameters->>'reservedCalls')::integer, 0)
                  - coalesce((run.run_parameters->>'usedCalls')::integer, 0)
              )
            ),
            updated_at = now()
        from review_workspace.verification_runs run
        where run.id in (select run_id from cancelled)
          and run.run_mode = 'discovery_only'
          and day.budget_day = (run.run_parameters->>'budgetDay')::date
      )
      update review_workspace.verification_cycles cycle
      set status = 'cancelled', cancelled_at = now()
      from review_workspace.verification_runs run
      where run.id in (select run_id from cancelled) and cycle.id = run.cycle_id
    `, [runId]);
  }

  async pause(runId: string): Promise<void> {
    await this.#query(`
      with paused as (
      update review_workspace.run_current_state
      set status = 'paused', updated_at = now(), revision = revision + 1
      where run_id = $1::uuid and status in ('queued', 'running')
      returning run_id
      )
      update review_workspace.verification_cycles cycle
      set status = 'paused'
      from review_workspace.verification_runs run
      where run.id in (select run_id from paused) and cycle.id = run.cycle_id
    `, [runId]);
  }

  async resume(runId: string, additionalBudget = 0): Promise<VerificationRun> {
    if (!Number.isInteger(additionalBudget) || additionalBudget < 0) throw new Error("Additional budget must be a non-negative integer.");
    const rows = await this.#query<{ id: string }>(`
      with eligible as (
        select run.id,
          (run.run_parameters->>'budget')::integer as budget,
          jsonb_array_length(run.run_parameters->'selection') as selection_count,
          coalesce((report.report->>'budgetUsed')::integer, 0) as used
        from review_workspace.verification_runs run
        join review_workspace.run_current_state state on state.run_id = run.id
        join review_workspace.run_reports report on report.run_id = run.id
        where run.id = $1::uuid and state.status = 'paused'
        for update of run, state
      ), updated_run as (
        update review_workspace.verification_runs run
        set run_parameters = jsonb_set(run.run_parameters, '{budget}', to_jsonb(eligible.budget + $2::integer)),
            budget_state = case when $2::integer > 0 then 'approved_continuation' else run.budget_state end
        from eligible
        where run.id = eligible.id
          and eligible.budget + $2::integer <= eligible.selection_count
          and (eligible.used < eligible.budget or $2::integer > 0)
        returning run.id
      ), resumed as (
      update review_workspace.run_current_state
      set status = 'queued', updated_at = now(), revision = revision + 1
      where run_id in (select id from updated_run) and status = 'paused'
      returning run_id as id
      ), resumed_cycle as (
        update review_workspace.verification_cycles cycle
        set status = 'queued'
        from review_workspace.verification_runs run
        where run.id in (select id from resumed) and cycle.id = run.cycle_id and cycle.status = 'paused'
      ) select id from resumed
    `, [runId, additionalBudget]);
    if (!rows[0]) {
      const current = await this.get(runId);
      if (!current) throw new Error("Run not found.");
      if (current.status === "cancelled") throw new Error("A cancelled run is terminal.");
      if (current.status === "paused") throw new Error("Additional budget does not fit the remaining frozen scope.");
      return current;
    }
    const resumed = await this.get(rows[0].id);
    return resumed!;
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

export const runRegistry = new NeonRunRegistry();
