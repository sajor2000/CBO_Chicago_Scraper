import { createHash } from "node:crypto";
import type { NeonQueryFunction } from "@neondatabase/serverless";
import { assertReviewWorkspace, reviewWorkspaceDb } from "../db.ts";
import type { CapturedObservation } from "../retrieval/types.ts";
import type { DiscoveryDisposition, NormalizedDiscoveryLead } from "./index.ts";
import type { DiscoveryQueryCell } from "./query-matrix.ts";

type Sql = NeonQueryFunction<false, false>;
export type DiscoveryActivation = { active: boolean; eventId: string; acceptedCycleId: string; queryPolicyVersion: string; dailyProviderCallCeiling: number; rationale: string; serviceOwnerApproval: string; recordedAt: string };
export type DiscoveryCheckpoint = { runId: string; ordinal: number; leaseToken: string; attempt: number; kind: "query_cell" | "lead"; queryCellId?: string; evaluationId?: string; query?: DiscoveryQueryCell; lead?: NormalizedDiscoveryLead };
export type DiscoveryReport = { queryCells: number; queryCellsCompleted: number; normalizedLeads: number; deduplicatedLeads: number; candidatesStaged: number; possibleDuplicates: number; providerFailures: number; zeroYieldCells: number; providerCallBudget: number; providerCallsUsed: number; dispositions: Record<string, number> };

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sanitizedSourceUrl = (value?: string) => {
  try {
    const url = value ? new URL(value) : undefined;
    if (!url || !['http:','https:'].includes(url.protocol) || url.username || url.password) return undefined;
    url.search = ""; url.hash = "";
    return url.toString().slice(0,500);
  } catch { return undefined; }
};
const boundedObservation = (observation: CapturedObservation) => ({
  provider: observation.provider,
  state: observation.state,
  observedAt: observation.observedAt.slice(0, 40),
  sourceUrl: sanitizedSourceUrl(observation.sourceUrl),
  publisherUrl: sanitizedSourceUrl(observation.publisherUrl),
  requestId: observation.requestId?.slice(0, 200),
  rank: observation.rank,
  values: observation.values && {
    name: observation.values.name?.slice(0, 200), address: observation.values.address?.slice(0, 300),
    phone: observation.values.phone?.slice(0, 40), url: sanitizedSourceUrl(observation.values.url),
    businessStatus: observation.values.businessStatus, placeId: observation.values.placeId?.slice(0, 300), county: observation.values.county?.slice(0, 100)
  },
  // Search excerpts are not retained for non-candidate discovery leads.
});

export class DiscoveryRepository {
  #client?: Sql;
  #createClient: () => Sql;
  constructor(createClient: () => Sql = reviewWorkspaceDb) { this.#createClient = createClient; }

  async activation(): Promise<DiscoveryActivation | undefined> {
    const rows = await this.#query<Record<string, unknown>>(`
      select state.active, event.id as event_id, event.accepted_cycle_id, event.query_policy_version,
        event.daily_provider_call_ceiling, event.rationale, event.service_owner_approval, event.recorded_at
      from review_workspace.discovery_activation_state state
      join review_workspace.discovery_activation_events event on event.id = state.activation_event_id
      where state.singleton
    `);
    const row = rows[0];
    return row ? { active: Boolean(row.active), eventId: String(row.event_id), acceptedCycleId: String(row.accepted_cycle_id), queryPolicyVersion: String(row.query_policy_version), dailyProviderCallCeiling: Number(row.daily_provider_call_ceiling), rationale: String(row.rationale), serviceOwnerApproval: String(row.service_owner_approval), recordedAt: String(row.recorded_at) } : undefined;
  }

  async completedKnownCycles(limit = 20): Promise<Array<{ id: string; completedAt: string }>> {
    const rows = await this.#query<{ id: string; completed_at: string }>(`select id, completed_at from review_workspace.verification_cycles where status='completed' order by completed_at desc nulls last limit $1`, [Math.max(1, Math.min(limit, 50))]);
    return rows.map((row) => ({ id: row.id, completedAt: row.completed_at }));
  }

  async recordActivation(input: { action: "activated" | "deactivated"; acceptedCycleId: string; queryPolicyVersion: string; dailyProviderCallCeiling: number; rationale: string; serviceOwnerApproval: string; actorSubject: string }): Promise<DiscoveryActivation> {
    if (!input.rationale.trim() || !input.serviceOwnerApproval.trim() || input.dailyProviderCallCeiling < 1) throw new Error("Activation requires a rationale, service-owner approval, and positive daily ceiling.");
    await this.#query(`
      with event as (
        insert into review_workspace.discovery_activation_events
          (action, accepted_cycle_id, query_policy_version, daily_provider_call_ceiling, rationale, service_owner_approval, actor_subject)
        values ($1, $2::uuid, $3, $4, $5, $6, $7) returning id
      )
      insert into review_workspace.discovery_activation_state (singleton, activation_event_id, active)
      select true, id, $1 = 'activated' from event
      on conflict (singleton) do update set activation_event_id = excluded.activation_event_id, active = excluded.active, updated_at = now()
    `, [input.action, input.acceptedCycleId, input.queryPolicyVersion, input.dailyProviderCallCeiling, input.rationale.trim(), input.serviceOwnerApproval.trim(), input.actorSubject]);
    return (await this.activation())!;
  }

  async launch(input: { idempotencyKey: string; cells: DiscoveryQueryCell[]; uniqueLeadCap: number; providerCallBudget: number; actorSubject: string }): Promise<{ id: string }> {
    if (!input.idempotencyKey || !input.cells.length || input.cells.length > 10) throw new Error("Discovery requires 1-10 frozen query cells and an idempotency key.");
    if (!Number.isInteger(input.uniqueLeadCap) || input.uniqueLeadCap < 1 || input.uniqueLeadCap > 50) throw new Error("Unique lead cap must be between 1 and 50.");
    if (!Number.isInteger(input.providerCallBudget) || input.providerCallBudget < input.cells.length || input.providerCallBudget > 250) throw new Error("Provider-call budget must cover query cells and be at most 250.");
    const policy = input.cells[0]!.policyVersion;
    if (input.cells.some((cell) => cell.policyVersion !== policy)) throw new Error("All query cells must use one policy version.");
    const rows = await this.#query<{ id: string }>(`
      with existing_run as (
        select id from review_workspace.verification_runs where idempotency_key=$1
      ), activation as (
        select event.daily_provider_call_ceiling
        from review_workspace.discovery_activation_state state
        join review_workspace.discovery_activation_events event on event.id = state.activation_event_id
        where state.singleton and state.active and event.query_policy_version = $2
      ), rate_limit as (
        select not exists (
          select 1 from review_workspace.verification_runs
          where run_mode = 'discovery_only' and requested_by = $6 and started_at > now() - interval '5 minutes'
            and idempotency_key <> $1
        ) as allowed
      ), reserved as (
        insert into review_workspace.discovery_daily_budgets (budget_date, ceiling_calls, reserved_calls)
        select (now() at time zone 'utc')::date, daily_provider_call_ceiling, $4 from activation, rate_limit where rate_limit.allowed
          and not exists(select 1 from existing_run)
          and not exists (select 1 from review_workspace.discovery_campaigns where status in ('queued', 'running', 'paused'))
        on conflict (budget_date) do update set
          ceiling_calls = least(review_workspace.discovery_daily_budgets.ceiling_calls, excluded.ceiling_calls),
          reserved_calls = review_workspace.discovery_daily_budgets.reserved_calls + excluded.reserved_calls,
          updated_at = now()
        where review_workspace.discovery_daily_budgets.reserved_calls + excluded.reserved_calls <= least(review_workspace.discovery_daily_budgets.ceiling_calls, excluded.ceiling_calls)
        returning budget_date
      ), inserted_run as (
        insert into review_workspace.verification_runs (idempotency_key, trigger_kind, run_mode, requested_by, run_parameters)
        select $1, 'manual', 'discovery_only', $6,
          jsonb_build_object('queryPolicyVersion', $2, 'queryCells', $3::jsonb, 'uniqueLeadCap', $5::integer, 'providerCallBudget', $4::integer, 'budget', $4::integer)
        from reserved
        where not exists (select 1 from review_workspace.discovery_campaigns where status in ('queued', 'running', 'paused'))
        on conflict (idempotency_key) do nothing returning id
      ), inserted_state as (
        insert into review_workspace.run_current_state (run_id, status) select id, 'queued' from inserted_run
      ), inserted_report as (
        insert into review_workspace.run_reports (run_id, report)
        select id, jsonb_build_object('queryCells', jsonb_array_length($3::jsonb), 'queryCellsCompleted', 0, 'normalizedLeads', 0, 'deduplicatedLeads', 0, 'candidatesStaged', 0, 'possibleDuplicates', 0, 'providerFailures', 0, 'zeroYieldCells', 0, 'providerCallBudget', $4::integer, 'providerCallsUsed', 0, 'dispositions', '{}'::jsonb) from inserted_run
      ), campaign as (
        insert into review_workspace.discovery_campaigns (run_id, status, reserved_calls, budget_date)
        select id, 'queued', $4, (now() at time zone 'utc')::date from inserted_run
      ), run_event as (
        insert into review_workspace.discovery_run_events (run_id, action, actor_identity, details)
        select id, 'launched', $6, jsonb_build_object('queryPolicyVersion', $2, 'providerCallBudget', $4::integer, 'uniqueLeadCap', $5::integer) from inserted_run
      ), cells as (
        insert into review_workspace.discovery_query_cells (run_id, cell_key, category, county, provider, query_text, query_policy_version, result_cap)
        select run.id, cell->>'id', cell->>'category', cell->>'county', cell->>'provider', cell->>'query', cell->>'policyVersion', (cell->>'resultCap')::integer
        from inserted_run run cross join jsonb_array_elements($3::jsonb) with ordinality source(cell, ordinal)
        returning id, run_id, cell_key
      ), checkpoints as (
        insert into review_workspace.run_checkpoints (run_id, ordinal, query_cell_id)
        select cells.run_id, source.ordinal - 1, cells.id
        from jsonb_array_elements($3::jsonb) with ordinality source(cell, ordinal)
        join cells on cells.cell_key = source.cell->>'id'
      )
      select id from inserted_run
      union all select id from review_workspace.verification_runs where idempotency_key = $1 limit 1
    `, [input.idempotencyKey, policy, JSON.stringify(input.cells), input.providerCallBudget, input.uniqueLeadCap, input.actorSubject]);
    if (!rows[0]) throw new Error("Discovery is disabled, rate-limited, already active, or exceeds the daily provider-call ceiling.");
    return rows[0];
  }

  async consumeProviderCall(runId: string): Promise<boolean> {
    const rows = await this.#query<{ consumed: boolean }>(`
      with consumed as (
        update review_workspace.discovery_campaigns campaign
        set used_calls = used_calls + 1, updated_at = now()
        where run_id = $1::uuid and status in ('queued', 'running') and used_calls < reserved_calls
          and budget_date = (now() at time zone 'utc')::date
        returning budget_date
      ), daily as (
        update review_workspace.discovery_daily_budgets budget set used_calls = used_calls + 1, updated_at = now()
        where budget_date = (select budget_date from consumed) returning true
      ), report as (
        update review_workspace.run_reports set report = jsonb_set(report, '{providerCallsUsed}', to_jsonb(coalesce((report->>'providerCallsUsed')::integer, 0) + 1)), updated_at = now()
        where run_id = $1::uuid and exists (select 1 from daily)
      ) select exists(select 1 from daily) as consumed
    `, [runId]);
    return Boolean(rows[0]?.consumed);
  }

  async comparisonLocations(): Promise<NormalizedDiscoveryLead[]> {
    const rows = await this.#query<Record<string, unknown>>(`
      select 'resource:'||snapshot.resource_id::text as comparison_id, coalesce(snapshot.source_payload->>'organization_name',snapshot.source_payload->>'location_name',snapshot.source_payload->>'name') as name,
        coalesce(snapshot.source_payload->>'full_address',snapshot.source_payload->>'address') as address,
        coalesce(snapshot.source_payload->>'county','') as county,
        coalesce(snapshot.source_payload->>'google_place_id','') as place_id,
        coalesce(snapshot.source_payload->>'phone','') as phone,
        coalesce(snapshot.source_payload->>'website',snapshot.source_payload->>'url','') as website
      from review_workspace.refresh_snapshot_memberships membership
      join review_workspace.refresh_manifests manifest on manifest.id=membership.manifest_id and manifest.status='reconciled'
      join review_workspace.resource_snapshots snapshot on snapshot.id=membership.resource_snapshot_id
      where manifest.id=(select id from review_workspace.refresh_manifests where status='reconciled' order by promoted_at desc limit 1)
      union all
      select 'lineage:'||lineage_id::text, original_values->>'name', original_values->>'address', original_values->>'county', google_place_id,
        original_values->>'phone', original_values->>'website' from review_workspace.discovery_evaluations
    `);
    const { normalizeDiscoveryLead } = await import("./index.ts");
    return rows.map((row) => normalizeDiscoveryLead({ comparisonId: String(row.comparison_id), name: row.name ? String(row.name) : undefined, address: row.address ? String(row.address) : undefined, county: row.county ? String(row.county) : undefined, placeId: row.place_id ? String(row.place_id) : undefined, phone: row.phone ? String(row.phone) : undefined, website: row.website ? String(row.website) : undefined }));
  }

  async claimNext(runId: string): Promise<DiscoveryCheckpoint | undefined> {
    const rows = await this.#query<Record<string, unknown>>(`
      with claimed as (
        update review_workspace.run_checkpoints checkpoint set state = 'leased', lease_token = gen_random_uuid(), lease_expires_at = now() + interval '5 minutes', attempt = attempt + 1
        from review_workspace.run_current_state state, review_workspace.verification_runs run, review_workspace.discovery_activation_state activation
        join review_workspace.discovery_activation_events activation_event on activation_event.id=activation.activation_event_id
        where checkpoint.run_id = $1::uuid and state.run_id = checkpoint.run_id and run.id = checkpoint.run_id
          and run.run_mode = 'discovery_only' and state.status in ('queued', 'running') and activation.active
          and activation_event.query_policy_version=run.run_parameters->>'queryPolicyVersion'
          and (checkpoint.state = 'pending' or (checkpoint.state = 'retry_wait' and checkpoint.next_attempt_at <= now()) or (checkpoint.state = 'leased' and checkpoint.lease_expires_at <= now()))
          and checkpoint.ordinal = (select min(eligible.ordinal) from review_workspace.run_checkpoints eligible where eligible.run_id = checkpoint.run_id and (eligible.state = 'pending' or (eligible.state = 'retry_wait' and eligible.next_attempt_at <= now()) or (eligible.state = 'leased' and eligible.lease_expires_at <= now())))
        returning checkpoint.*
      ), started as (
        update review_workspace.run_current_state set status = 'running', updated_at = now(), revision = revision + 1 where run_id = $1::uuid and exists (select 1 from claimed)
      ), campaign as (
        update review_workspace.discovery_campaigns set status = 'running', updated_at = now() where run_id = $1::uuid and exists (select 1 from claimed)
      ), run_event as (
        insert into review_workspace.discovery_run_events (run_id, action, actor_identity, details)
        select run_id, 'checkpoint_claimed', 'cron:discovery', jsonb_build_object('ordinal', ordinal, 'attempt', attempt) from claimed
      )
      select claimed.run_id, claimed.ordinal, claimed.lease_token, claimed.attempt, claimed.query_cell_id, claimed.discovery_evaluation_id,
        cell.cell_key, cell.category, cell.county, cell.provider, cell.query_text, cell.query_policy_version, cell.result_cap,
        evaluation.original_values
      from claimed
      left join review_workspace.discovery_query_cells cell on cell.id = claimed.query_cell_id
      left join review_workspace.discovery_evaluations evaluation on evaluation.id = claimed.discovery_evaluation_id
    `, [runId]);
    const row = rows[0];
    if (!row) return undefined;
    return { runId: String(row.run_id), ordinal: Number(row.ordinal), leaseToken: String(row.lease_token), attempt: Number(row.attempt), kind: row.query_cell_id ? "query_cell" : "lead", queryCellId: row.query_cell_id ? String(row.query_cell_id) : undefined, evaluationId: row.discovery_evaluation_id ? String(row.discovery_evaluation_id) : undefined, query: row.query_cell_id ? { id: String(row.cell_key), category: String(row.category) as DiscoveryQueryCell["category"], county: String(row.county) as DiscoveryQueryCell["county"], provider: String(row.provider) as DiscoveryQueryCell["provider"], query: String(row.query_text), policyVersion: String(row.query_policy_version), resultCap: Number(row.result_cap) } : undefined, lead: row.original_values as NormalizedDiscoveryLead | undefined };
  }

  async appendLead(input: { runId: string; queryCellId: string; lead: NormalizedDiscoveryLead; observation: CapturedObservation; disposition?: DiscoveryDisposition; reasons?: string[]; evidenceSummary?: unknown }): Promise<{ evaluationId: string; checkpointCreated: boolean }> {
    const fingerprint = hash({ placeId: input.lead.placeId ?? "", address: input.lead.normalizedAddress, name: input.lead.normalizedName, domain: input.lead.canonicalDomain, phone: input.lead.normalizedPhone });
    const observation = boundedObservation(input.observation);
    const rows = await this.#query<{ evaluation_id: string; checkpoint_created: boolean }>(`
      with lock as (select pg_advisory_xact_lock(hashtextextended($4, 0))), existing as (
        select evaluation.id, evaluation.lineage_id from review_workspace.discovery_evaluations evaluation cross join lock
        where evaluation.material_fingerprint_sha256 = $4 and evaluation.evaluated_at>now()-interval '12 months' order by evaluation.evaluated_at desc limit 1
      ), lineage_match as (
        select evaluation.lineage_id from review_workspace.discovery_evaluations evaluation cross join lock
        where ($7::text is not null and evaluation.google_place_id=$7)
          or ($6<>'' and evaluation.normalized_address=$6 and (evaluation.normalized_name=$5 or ($8<>'' and evaluation.canonical_domain=$8) or ($9<>'' and evaluation.normalized_phone=$9)))
          or evaluation.material_fingerprint_sha256=$4
        order by evaluation.evaluated_at desc limit 1
      ), lineage_seed as (select gen_random_uuid() as id), lineage as (
        insert into review_workspace.discovery_lineages (id, display_identity)
        select id, 'discovery:' || id::text from lineage_seed where not exists (select 1 from existing) and not exists(select 1 from lineage_match) returning id
      ), evaluation as (
        insert into review_workspace.discovery_evaluations (lineage_id, run_id, identity_policy_version, original_values, normalized_name, normalized_address, google_place_id, canonical_domain, normalized_phone, material_fingerprint_sha256)
        select coalesce((select lineage_id from existing),(select lineage_id from lineage_match), (select id from lineage)), $1::uuid, 'service-location-v1', $3::jsonb, $5, $6, $7, $8, $9, $4
        where not exists (select 1 from existing) returning id
      ), selected as (select id from evaluation union all select id from existing limit 1), inserted_observation as (
        insert into review_workspace.source_observations (run_id, provider, observation_key, observed_at, extracted_values, retrieval_metadata)
        select $1::uuid, $10, $2::text || ':' || $4, $11::timestamptz, coalesce($12::jsonb->'values', '{}'::jsonb), jsonb_build_object('state', $12::jsonb->>'state', 'sourceUrl', $12::jsonb->>'sourceUrl', 'requestId', $12::jsonb->>'requestId', 'rank', $12::jsonb->'rank')
        on conflict (provider, observation_key, observed_at) do nothing returning id
      ), observation as (
        select id from inserted_observation union all
        select id from review_workspace.source_observations where provider=$10 and observation_key=$2::text||':'||$4 and observed_at=$11::timestamptz limit 1
      ), linked as (
        insert into review_workspace.discovery_lead_observations (evaluation_id, source_observation_id, query_cell_id)
        select selected.id, observation.id, $2::uuid from selected cross join observation on conflict do nothing
      ), prior as (
        select event.disposition,event.recorded_at,event.run_id from existing join review_workspace.discovery_evaluations evaluation on evaluation.id=existing.id
        join review_workspace.discovery_current_state state on state.lineage_id=evaluation.lineage_id
        join review_workspace.discovery_disposition_events event on event.id=state.disposition_event_id limit 1
      ), capacity as (
        select (select count(*) from review_workspace.run_checkpoints where run_id = $1::uuid and discovery_evaluation_id is not null) < coalesce((run_parameters->>'uniqueLeadCap')::integer, 0) as available,
          coalesce((select max(ordinal) + 1 from review_workspace.run_checkpoints where run_id = $1::uuid), 0) as ordinal
        from review_workspace.verification_runs where id = $1::uuid
      ), checkpoint as (
        insert into review_workspace.run_checkpoints (run_id, ordinal, discovery_evaluation_id)
        select $1::uuid, capacity.ordinal, selected.id from capacity cross join selected
        where capacity.available and $13::text is null and (not exists(select 1 from prior) or exists(select 1 from prior where recorded_at<=now()-interval '12 months'))
          and not exists (select 1 from review_workspace.run_checkpoints where run_id = $1::uuid and discovery_evaluation_id = selected.id)
        on conflict do nothing returning true
      ), disposition as (
        insert into review_workspace.discovery_disposition_events (evaluation_id,run_id, disposition, reasons, evidence_summary, actor_identity)
        select selected.id,$1::uuid, coalesce($13,(select disposition from prior),'not_processed_budget'),
          case when $13::text is null and exists(select 1 from prior where recorded_at>now()-interval '12 months') then '["previously_evaluated_within_12_months"]'::jsonb else $14::jsonb end,
          $15::jsonb,'cron:discovery' from selected cross join capacity
        where ($13::text is not null or not capacity.available or exists(select 1 from prior where recorded_at>now()-interval '12 months'))
          and not exists(select 1 from prior where run_id=$1::uuid) returning id, evaluation_id
      ), current as (
        insert into review_workspace.discovery_current_state (lineage_id, evaluation_id, disposition_event_id)
        select evaluation.lineage_id, disposition.evaluation_id, disposition.id from disposition join review_workspace.discovery_evaluations evaluation on evaluation.id = disposition.evaluation_id
        on conflict (lineage_id) do update set evaluation_id = excluded.evaluation_id, disposition_event_id = excluded.disposition_event_id, updated_at = now()
      ), updated_report as (
        update review_workspace.run_reports report set report=jsonb_set(
          report.report || jsonb_build_object(
            'deduplicatedLeads',coalesce((report.report->>'deduplicatedLeads')::integer,0)+1,
            'possibleDuplicates',coalesce((report.report->>'possibleDuplicates')::integer,0)+case when (select disposition from disposition)='possible_duplicate' then 1 else 0 end,
            'providerFailures',coalesce((report.report->>'providerFailures')::integer,0)+case when (select disposition from disposition)='provider_failure' then 1 else 0 end
          ),array['dispositions',(select disposition from disposition)],to_jsonb(coalesce((report.report->'dispositions'->>(select disposition from disposition))::integer,0)+1),true
        ),updated_at=now() where report.run_id=$1::uuid and exists(select 1 from disposition)
      ) select selected.id as evaluation_id, exists(select 1 from checkpoint) as checkpoint_created from selected
    `, [input.runId, input.queryCellId, JSON.stringify(input.lead), fingerprint, input.lead.normalizedName, input.lead.normalizedAddress, input.lead.placeId ?? null, input.lead.canonicalDomain, input.lead.normalizedPhone, input.observation.provider, input.observation.observedAt, JSON.stringify(observation), input.disposition ?? null, JSON.stringify(input.reasons ?? [input.disposition ?? "not_processed_budget"]), JSON.stringify(input.evidenceSummary ?? {})]);
    if (!rows[0]) throw new Error("Discovery lead could not be persisted.");
    return { evaluationId: rows[0].evaluation_id, checkpointCreated: Boolean(rows[0].checkpoint_created) };
  }

  async recordDisposition(input: { runId: string; evaluationId: string; leaseToken: string; disposition: DiscoveryDisposition; reasons: string[]; evidenceSummary?: unknown; advisoryState?: "not_requested" | "available" | "advisory_unavailable"; candidateId?: string }): Promise<void> {
    const rows = await this.#query<{ completed: boolean }>(`
      with claimed as (
        select checkpoint.* from review_workspace.run_checkpoints checkpoint join review_workspace.run_current_state state on state.run_id = checkpoint.run_id
        where checkpoint.run_id = $1::uuid and checkpoint.discovery_evaluation_id = $2::uuid and checkpoint.lease_token = $3::uuid and checkpoint.state = 'leased' and checkpoint.lease_expires_at > now() and state.status in ('running','paused')
        for update of checkpoint
      ), disposition as (
        insert into review_workspace.discovery_disposition_events (evaluation_id,run_id, disposition, reasons, evidence_summary, advisory_state, actor_identity)
        select $2::uuid,$1::uuid, $4, $5::jsonb, $6::jsonb, $7, 'cron:discovery' from claimed returning id, evaluation_id
      ), current as (
        insert into review_workspace.discovery_current_state (lineage_id, evaluation_id, disposition_event_id)
        select evaluation.lineage_id, disposition.evaluation_id, disposition.id from disposition join review_workspace.discovery_evaluations evaluation on evaluation.id = disposition.evaluation_id
        on conflict (lineage_id) do update set evaluation_id = excluded.evaluation_id, disposition_event_id = excluded.disposition_event_id, updated_at = now()
      ), outcome as (
        insert into review_workspace.run_checkpoint_outcomes (run_id, ordinal, lease_token, outcome, report_delta)
        select run_id, ordinal, $3::uuid, $4, jsonb_build_object('disposition', $4, 'candidateId', $8::text) from claimed returning run_id, ordinal
      ), finished as (
        update review_workspace.run_checkpoints checkpoint set state = 'completed', lease_token = null, lease_expires_at = null, completed_at = now()
        from outcome where checkpoint.run_id = outcome.run_id and checkpoint.ordinal = outcome.ordinal returning checkpoint.run_id
      ), report as (
        update review_workspace.run_reports current set report = jsonb_set(
          current.report || jsonb_build_object(
            'deduplicatedLeads',coalesce((current.report->>'deduplicatedLeads')::integer,0)+1,
            'candidatesStaged',coalesce((current.report->>'candidatesStaged')::integer,0)+case when $4='candidate_staged' then 1 else 0 end,
            'possibleDuplicates',coalesce((current.report->>'possibleDuplicates')::integer,0)+case when $4='possible_duplicate' then 1 else 0 end,
            'providerFailures',coalesce((current.report->>'providerFailures')::integer,0)+case when $4='provider_failure' then 1 else 0 end
          ),array['dispositions',$4],to_jsonb(coalesce((current.report->'dispositions'->>$4)::integer,0)+1),true
        ),updated_at=now() where run_id in (select run_id from finished)
      ) select exists(select 1 from finished) as completed
    `, [input.runId, input.evaluationId, input.leaseToken, input.disposition, JSON.stringify(input.reasons), JSON.stringify(input.evidenceSummary ?? {}), input.advisoryState ?? "not_requested", input.candidateId ?? null]);
    if (!rows[0]?.completed) throw new Error("Discovery checkpoint lease is no longer valid.");
    await this.#finishRunIfIdle(input.runId);
  }

  async completeQuery(input: { runId: string; queryCellId: string; leaseToken: string; attempt: number; outcome: "query_expanded" | "provider_failure"; leadCount: number; requestId?: string; resultProvenance?: unknown }): Promise<void> {
    const rows = await this.#query<{ completed: boolean }>(`
      with claimed as (select * from review_workspace.run_checkpoints where run_id = $1::uuid and query_cell_id = $2::uuid and lease_token = $3::uuid and state = 'leased' and lease_expires_at > now() for update),
      execution as (insert into review_workspace.discovery_query_executions(query_cell_id,run_id,checkpoint_ordinal,attempt,outcome,provider_request_id,result_provenance,actor_identity)
        select $2::uuid,run_id,ordinal,$6,case when $4='provider_failure' then 'provider_failure' when $5=0 then 'zero_yield' else 'succeeded' end,$7,$8::jsonb,'cron:discovery' from claimed),
      outcome as (insert into review_workspace.run_checkpoint_outcomes (run_id, ordinal, lease_token, outcome, report_delta) select run_id, ordinal, $3::uuid, $4, jsonb_build_object('leadCount', $5::integer) from claimed returning run_id, ordinal),
      finished as (update review_workspace.run_checkpoints checkpoint set state = case when $4 = 'provider_failure' then 'failed' else 'completed' end, lease_token = null, lease_expires_at = null, completed_at = now() from outcome where checkpoint.run_id = outcome.run_id and checkpoint.ordinal = outcome.ordinal returning checkpoint.run_id),
      report as (update review_workspace.run_reports current set report=current.report||jsonb_build_object(
        'queryCellsCompleted',coalesce((current.report->>'queryCellsCompleted')::integer,0)+1,
        'normalizedLeads',coalesce((current.report->>'normalizedLeads')::integer,0)+$5,
        'providerFailures',coalesce((current.report->>'providerFailures')::integer,0)+case when $4='provider_failure' then 1 else 0 end,
        'zeroYieldCells',coalesce((current.report->>'zeroYieldCells')::integer,0)+case when $4<>'provider_failure' and $5=0 then 1 else 0 end
      ),updated_at=now() where run_id in (select run_id from finished))
      select exists(select 1 from finished) as completed
    `, [input.runId, input.queryCellId, input.leaseToken, input.outcome, input.leadCount, input.attempt, input.requestId ?? null, JSON.stringify(input.resultProvenance ?? [])]);
    if (!rows[0]?.completed) throw new Error("Discovery query checkpoint lease is no longer valid.");
    await this.#finishRunIfIdle(input.runId);
  }

  async recordQueryAttempt(input: { runId: string; queryCellId: string; leaseToken: string; attempt: number; requestId?: string; resultProvenance?: unknown }): Promise<void> {
    const rows = await this.#query<{ recorded: boolean }>(`
      with claimed as (
        select * from review_workspace.run_checkpoints where run_id=$1::uuid and query_cell_id=$2::uuid and lease_token=$3::uuid and state='leased' and lease_expires_at>now()
      ), execution as (
        insert into review_workspace.discovery_query_executions(query_cell_id,run_id,checkpoint_ordinal,attempt,outcome,provider_request_id,result_provenance,actor_identity)
        select $2::uuid,run_id,ordinal,$4,'provider_failure',$5,$6::jsonb,'cron:discovery' from claimed
        on conflict(run_id,checkpoint_ordinal,attempt) do nothing returning id
      ) select exists(select 1 from execution) recorded
    `,[input.runId,input.queryCellId,input.leaseToken,input.attempt,input.requestId??null,JSON.stringify(input.resultProvenance??[])]);
    if(!rows[0]?.recorded) throw new Error("Discovery query checkpoint lease is no longer valid.");
  }

  async recordLeadObservations(input: { runId: string; evaluationId: string; leaseToken: string; observations: CapturedObservation[] }): Promise<void> {
    if(!input.observations.length) return;
    const observations=input.observations.map(boundedObservation);
    const rows=await this.#query<{recorded:boolean}>(`
      with claimed as (
        select 1 from review_workspace.run_checkpoints where run_id=$1::uuid and discovery_evaluation_id=$2::uuid and lease_token=$3::uuid and state='leased' and lease_expires_at>now()
      ), entries as (
        select entry,coalesce(entry->>'sourceUrl',entry->>'provider')||':'||(entry->>'observedAt') observation_key
        from jsonb_array_elements($4::jsonb) entry
      ), inserted as (
        insert into review_workspace.source_observations(run_id,provider,observation_key,observed_at,extracted_values,retrieval_metadata)
        select $1::uuid,entry->>'provider',observation_key,(entry->>'observedAt')::timestamptz,coalesce(entry->'values','{}'::jsonb),
          jsonb_build_object('state',entry->>'state','sourceUrl',entry->>'sourceUrl','publisherUrl',entry->>'publisherUrl','requestId',entry->>'requestId','rank',entry->'rank')
        from entries cross join claimed on conflict(provider,observation_key,observed_at) do nothing returning id
      ), all_observations as (
        select id from inserted union select observation.id from entries join review_workspace.source_observations observation
          on observation.provider=entries.entry->>'provider' and observation.observation_key=entries.observation_key and observation.observed_at=(entries.entry->>'observedAt')::timestamptz
      ), linked as (
        insert into review_workspace.discovery_lead_observations(evaluation_id,source_observation_id)
        select $2::uuid,id from all_observations on conflict do nothing
      ) select exists(select 1 from claimed) recorded
    `,[input.runId,input.evaluationId,input.leaseToken,JSON.stringify(observations)]);
    if(!rows[0]?.recorded) throw new Error("Discovery checkpoint lease is no longer valid.");
  }

  async retry(runId: string, leaseToken: string, attempt: number): Promise<void> {
    if (attempt >= 3) { await this.#query(`update review_workspace.run_checkpoints set state='failed', lease_token=null, lease_expires_at=null, completed_at=now() where run_id=$1::uuid and lease_token=$2::uuid`, [runId, leaseToken]); await this.#finishRunIfIdle(runId); return; }
    const delay = attempt <= 1 ? "1 minute" : "5 minutes";
    await this.#query(`update review_workspace.run_checkpoints set state='retry_wait', lease_token=null, lease_expires_at=null, next_attempt_at=now()+$3::interval where run_id=$1::uuid and lease_token=$2::uuid and state='leased'`, [runId, leaseToken, delay]);
  }

  async pauseForBudget(runId: string, leaseToken: string): Promise<void> {
    const rows = await this.#query<{ paused: boolean }>(`
      with checkpoint as (
        update review_workspace.run_checkpoints set state='retry_wait',lease_token=null,lease_expires_at=null,next_attempt_at=now()
        where run_id=$1::uuid and lease_token=$2::uuid and state='leased' returning run_id
      ), state as (
        update review_workspace.run_current_state set status='paused',updated_at=now(),revision=revision+1
        where run_id in(select run_id from checkpoint) returning run_id
      ), campaign as (
        update review_workspace.discovery_campaigns set status='paused',updated_at=now() where run_id in(select run_id from state) returning run_id
      ), run_event as (
        insert into review_workspace.discovery_run_events(run_id,action,actor_identity,details)
        select run_id,'paused','cron:discovery',jsonb_build_object('reason','provider_call_budget_exhausted') from campaign
      ) select exists(select 1 from campaign) paused
    `,[runId,leaseToken]);
    if(!rows[0]?.paused) throw new Error("Discovery checkpoint lease is no longer valid.");
  }

  async report(runId: string): Promise<DiscoveryReport | undefined> {
    const rows = await this.#query<{ report: DiscoveryReport }>(`select report from review_workspace.run_reports where run_id=$1::uuid`, [runId]);
    return rows[0]?.report;
  }

  async listDispositions(runId: string, limit = 50, offset = 0, disposition?: DiscoveryDisposition): Promise<Array<{ evaluationId: string; name: string; address?: string; county?: string; disposition: string; reasons: string[]; advisoryState: string; candidateId?: string; recordedAt: string }>> {
    const rows = await this.#query<Record<string, unknown>>(`
      select evaluation.id as evaluation_id, coalesce(evaluation.original_values->>'name','Unnamed lead') as name,
        evaluation.original_values->>'address' as address, evaluation.original_values->>'county' as county,
        event.disposition, event.reasons, event.advisory_state, event.recorded_at, state.candidate_id
      from review_workspace.discovery_disposition_events event
      join review_workspace.discovery_evaluations evaluation on evaluation.id=event.evaluation_id
      left join review_workspace.candidate_revision_discovery_links link on link.evaluation_id=evaluation.id
      left join review_workspace.candidate_current_state state on state.candidate_revision_id=link.candidate_revision_id
      where event.run_id=$1::uuid and ($4::text is null or event.disposition=$4) order by event.recorded_at desc limit $2 offset $3
    `,[runId,Math.max(1,Math.min(limit,100)),Math.max(0,offset),disposition??null]);
    return rows.map((row) => ({ evaluationId:String(row.evaluation_id), name:String(row.name), address:row.address?String(row.address):undefined, county:row.county?String(row.county):undefined, disposition:String(row.disposition), reasons:Array.isArray(row.reasons)?row.reasons.map(String):[], advisoryState:String(row.advisory_state), candidateId:row.candidate_id?String(row.candidate_id):undefined, recordedAt:String(row.recorded_at) }));
  }

  async workState(runId:string):Promise<{pending:number;retryWaiting:number;leased:number}>{
    const rows=await this.#query<{pending:number;retry_waiting:number;leased:number}>(`
      select count(*) filter(where state='pending')::integer pending,count(*) filter(where state='retry_wait')::integer retry_waiting,count(*) filter(where state='leased')::integer leased
      from review_workspace.run_checkpoints where run_id=$1::uuid
    `,[runId]);
    return{pending:Number(rows[0]?.pending??0),retryWaiting:Number(rows[0]?.retry_waiting??0),leased:Number(rows[0]?.leased??0)};
  }

  async oldestClaimableRun(): Promise<{ id: string } | undefined> {
    const rows = await this.#query<{ id: string }>(`
      select campaign.run_id as id from review_workspace.discovery_campaigns campaign
      join review_workspace.verification_runs run on run.id=campaign.run_id
      join review_workspace.discovery_activation_state activation on activation.singleton and activation.active
      join review_workspace.discovery_activation_events activation_event on activation_event.id=activation.activation_event_id and activation_event.query_policy_version=run.run_parameters->>'queryPolicyVersion'
      where campaign.status in ('queued','running') and exists (
        select 1 from review_workspace.run_checkpoints checkpoint where checkpoint.run_id=campaign.run_id
          and (checkpoint.state='pending' or (checkpoint.state='retry_wait' and checkpoint.next_attempt_at<=now()) or (checkpoint.state='leased' and checkpoint.lease_expires_at<=now()))
      ) order by campaign.created_at asc limit 1
    `);
    return rows[0];
  }

  async pause(runId: string, actorSubject: string): Promise<void> {
    await this.#query(`
      with state as (update review_workspace.run_current_state set status='paused',updated_at=now(),revision=revision+1 where run_id=$1::uuid and status in ('queued','running') returning run_id),
      campaign as (update review_workspace.discovery_campaigns set status='paused',updated_at=now() where run_id in(select run_id from state) returning run_id)
      insert into review_workspace.discovery_run_events(run_id,action,actor_identity) select run_id,'paused',$2 from campaign
    `,[runId,actorSubject]);
  }

  async resume(runId: string, actorSubject: string): Promise<void> {
    const rows=await this.#query<{resumed:boolean}>(`
      with campaign as (select * from review_workspace.discovery_campaigns where run_id=$1::uuid and status='paused' for update), activation as (
        select event.daily_provider_call_ceiling from review_workspace.discovery_activation_state state join review_workspace.discovery_activation_events event on event.id=state.activation_event_id
        join review_workspace.verification_runs run on run.id=$1::uuid and run.run_parameters->>'queryPolicyVersion'=event.query_policy_version where state.singleton and state.active
      ), remaining as (select greatest(reserved_calls-used_calls,0) calls,budget_date from campaign), reserve as (
        insert into review_workspace.discovery_daily_budgets(budget_date,ceiling_calls,reserved_calls)
        select (now() at time zone 'utc')::date,daily_provider_call_ceiling,remaining.calls from activation,remaining where remaining.budget_date<>(now() at time zone 'utc')::date
        on conflict(budget_date) do update set reserved_calls=review_workspace.discovery_daily_budgets.reserved_calls+excluded.reserved_calls,updated_at=now()
        where review_workspace.discovery_daily_budgets.reserved_calls+excluded.reserved_calls<=review_workspace.discovery_daily_budgets.ceiling_calls returning budget_date
      ), allowed as (select exists(select 1 from campaign) and exists(select 1 from remaining where calls>0) and (exists(select 1 from campaign where budget_date=(now() at time zone 'utc')::date) or exists(select 1 from reserve)) ok), updated_campaign as (
        update review_workspace.discovery_campaigns set status='queued',budget_date=(now() at time zone 'utc')::date,updated_at=now() where run_id=$1::uuid and (select ok from allowed) returning run_id
      ), updated_state as (update review_workspace.run_current_state set status='queued',updated_at=now(),revision=revision+1 where run_id in(select run_id from updated_campaign)), run_event as (
        insert into review_workspace.discovery_run_events(run_id,action,actor_identity) select run_id,'resumed',$2 from updated_campaign
      )
      select exists(select 1 from updated_campaign) resumed
    `,[runId,actorSubject]);
    if(!rows[0]?.resumed) throw new Error("Discovery cannot resume without active policy and daily budget headroom.");
  }

  async cancel(runId:string, actorSubject:string):Promise<void>{
    await this.#query(`
      with targets as (select run_id,ordinal,coalesce(lease_token,gen_random_uuid()) token from review_workspace.run_checkpoints where run_id=$1::uuid and state in('pending','retry_wait','leased')),
      outcomes as (insert into review_workspace.run_checkpoint_outcomes(run_id,ordinal,lease_token,outcome,report_delta) select run_id,ordinal,token,'cancelled','{}'::jsonb from targets on conflict do nothing),
      checkpoints as (update review_workspace.run_checkpoints set state='completed',lease_token=null,lease_expires_at=null,next_attempt_at=null,completed_at=now() where run_id=$1::uuid and state in('pending','retry_wait','leased')),
      state as (update review_workspace.run_current_state set status='cancelled',updated_at=now(),revision=revision+1 where run_id=$1::uuid and status in('queued','running','paused') returning run_id),
      campaign as (update review_workspace.discovery_campaigns set status='cancelled',updated_at=now() where run_id in(select run_id from state) returning reserved_calls-used_calls unused,budget_date),
      run_event as (insert into review_workspace.discovery_run_events(run_id,action,actor_identity) select run_id,'cancelled',$2 from state),
      release as (update review_workspace.discovery_daily_budgets budget set reserved_calls=greatest(used_calls,reserved_calls-campaign.unused),updated_at=now() from campaign where budget.budget_date=campaign.budget_date)
      select true
    `,[runId,actorSubject]);
  }

  async #finishRunIfIdle(runId: string): Promise<void> {
    await this.#query(`
      with terminal as (select not exists(select 1 from review_workspace.run_checkpoints where run_id=$1::uuid and state in ('pending','retry_wait','leased')) as done),
      state as (update review_workspace.run_current_state set status='completed', updated_at=now(), revision=revision+1 where run_id=$1::uuid and (select done from terminal) returning run_id),
      campaign as (update review_workspace.discovery_campaigns set status='completed', updated_at=now() where run_id in (select run_id from state) returning reserved_calls-used_calls as unused, budget_date),
      release as (update review_workspace.discovery_daily_budgets budget set reserved_calls=greatest(used_calls,reserved_calls-campaign.unused), updated_at=now() from campaign where budget.budget_date=campaign.budget_date)
      select true
    `, [runId]);
  }

  #sql(): Sql { return this.#client ??= this.#createClient(); }
  async #query<T>(query: string, params: unknown[] = []): Promise<T[]> { const sql = this.#sql(); await assertReviewWorkspace(sql); return await sql.query(query, params) as T[]; }
}

export const discoveryRepository = new DiscoveryRepository();
