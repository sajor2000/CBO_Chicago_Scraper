export type RunStatus = "queued" | "running" | "cancelled" | "completed" | "failed";
import { assertReviewWorkspace, reviewWorkspaceDb } from "../db.ts";

export interface VerificationRun {
  id: string;
  idempotencyKey: string;
  selection: string[];
  budget: number;
  checkpoint: number;
  status: RunStatus;
  report: RunReport;
}

export interface RunReport {
  recordsChecked: number;
  candidatesStaged: number;
  conflicts: number;
  unableToVerify: number;
  providerFailures: number;
  budgetUsed: number;
}

export class RunLockError extends Error {
  constructor() {
    super("A checkpoint is already claimed.");
    this.name = "RunLockError";
  }
}

const blankReport = (): RunReport => ({ recordsChecked: 0, candidatesStaged: 0, conflicts: 0, unableToVerify: 0, providerFailures: 0, budgetUsed: 0 });
const copy = (run: VerificationRun) => structuredClone(run);
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

/** Fixture-only synchronous registry. */
export class InMemoryRunRegistry {
  #runs = new Map<string, VerificationRun>();
  #byIdempotency = new Map<string, string>();
  #claimedRunIds = new Set<string>();
  #nextId = 1;

  launch(input: { idempotencyKey: string; selection: string[]; budget: number }): VerificationRun {
    const existingId = this.#byIdempotency.get(input.idempotencyKey);
    if (existingId) return copy(this.#runs.get(existingId)!);
    if (!input.idempotencyKey || input.budget < 1 || input.selection.length > 100) throw new Error("A positive budget, idempotency key, and at most 100 selected resources are required.");
    const run: VerificationRun = { id: `run-${this.#nextId++}`, idempotencyKey: input.idempotencyKey, selection: [...input.selection], budget: input.budget, checkpoint: 0, status: "queued", report: blankReport() };
    this.#runs.set(run.id, run);
    this.#byIdempotency.set(run.idempotencyKey, run.id);
    return copy(run);
  }

  get(runId: string): VerificationRun | undefined {
    const run = this.#runs.get(runId);
    return run && copy(run);
  }

  claimNext(runId: string): { resourceId: string; checkpoint: number } | undefined {
    const run = this.#require(runId);
    if (run.status === "cancelled" || run.status === "completed") return undefined;
    if (this.#claimedRunIds.has(run.id)) throw new RunLockError();
    if (run.checkpoint >= run.selection.length || run.report.budgetUsed >= run.budget) {
      run.status = "completed";
      return undefined;
    }
    run.status = "running";
    this.#claimedRunIds.add(run.id);
    return { resourceId: run.selection[run.checkpoint]!, checkpoint: run.checkpoint };
  }

  completeCheckpoint(runId: string, report: Partial<Omit<RunReport, "recordsChecked" | "budgetUsed">> = {}) {
    const run = this.#require(runId);
    if (!this.#claimedRunIds.has(run.id)) throw new RunLockError();
    run.checkpoint += 1;
    run.report.recordsChecked += 1;
    run.report.budgetUsed += 1;
    for (const key of ["candidatesStaged", "conflicts", "unableToVerify", "providerFailures"] as const) run.report[key] += report[key] ?? 0;
    this.#claimedRunIds.delete(run.id);
    if (run.checkpoint >= run.selection.length || run.report.budgetUsed >= run.budget) run.status = "completed";
  }

  releaseLease(runId: string) {
    const run = this.#require(runId);
    if (!this.#claimedRunIds.has(run.id)) return;
    this.#claimedRunIds.delete(run.id);
    if (run.status === "running") run.status = "queued";
  }

  cancel(runId: string) {
    const run = this.#require(runId);
    this.#claimedRunIds.delete(run.id);
    run.status = "cancelled";
  }

  resume(runId: string): VerificationRun {
    const run = this.#require(runId);
    if (run.status === "completed") return copy(run);
    run.status = "queued";
    return copy(run);
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
  report: dbReport(row.report)
});

const runSelect = `
  select run.id, run.idempotency_key,
    coalesce(run.run_parameters->'selection', '[]'::jsonb) as selection,
    coalesce((run.run_parameters->>'budget')::integer, 0) as budget,
    state.next_checkpoint_ordinal as checkpoint, state.status,
    coalesce(report.report, '{}'::jsonb) as report
  from review_workspace.verification_runs run
  join review_workspace.run_current_state state on state.run_id = run.id
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
    const selection = [...new Set(input.selection)];
    if (!input.idempotencyKey || !selection.length || input.budget < 1 || input.budget > selection.length || selection.length > 100) {
      throw new Error("A positive budget, idempotency key, and at most 100 selected resources are required.");
    }
    if (selection.some((resourceId) => !isUuid(resourceId))) throw new Error("Selected resource IDs must be UUIDs.");
    const rows = await this.#query<{ id: string }>(`
      with inserted_run as (
        insert into review_workspace.verification_runs (idempotency_key, trigger_kind, run_parameters)
        values ($1, 'manual', jsonb_build_object('selection', $2::jsonb, 'budget', $3))
        on conflict (idempotency_key) do nothing
        returning id
      ), inserted_state as (
        insert into review_workspace.run_current_state (run_id)
        select id from inserted_run on conflict (run_id) do nothing
      ), inserted_report as (
        insert into review_workspace.run_reports (run_id, report)
        select id, $4::jsonb from inserted_run on conflict (run_id) do nothing
      ), inserted_checkpoints as (
        insert into review_workspace.run_checkpoints (run_id, ordinal, resource_id)
        select id, ordinal - 1, resource_id::uuid
        from inserted_run cross join unnest($5::text[]) with ordinality checkpoint(resource_id, ordinal)
        on conflict (run_id, ordinal) do nothing
      )
      select id from inserted_run
      union all
      select id from review_workspace.verification_runs where idempotency_key = $1
      limit 1
    `, [input.idempotencyKey, JSON.stringify(selection), input.budget, JSON.stringify(blankReport()), selection]);
    const runId = rows[0]?.id ?? (await this.#query<{ id: string }>(
      "select id from review_workspace.verification_runs where idempotency_key = $1",
      [input.idempotencyKey]
    ))[0]?.id;
    if (!runId) throw new Error("Run launch did not return a durable run.");
    return (await this.get(runId))!;
  }

  async get(runId: string): Promise<VerificationRun | undefined> {
    const rows = await this.#query<RunRow>(`${runSelect} where run.id = $1::uuid`, [runId]);
    return rows[0] && fromRow(rows[0]);
  }

  async claimNext(runId: string): Promise<{ resourceId: string; checkpoint: number; leaseToken: string } | undefined> {
    const rows = await this.#query<{ resource_id: string; ordinal: number; lease_token: string }>(`
      with completed as (
        update review_workspace.run_current_state state
        set status = 'completed', updated_at = now(), revision = revision + 1
        from review_workspace.verification_runs run
        where state.run_id = run.id and state.run_id = $1::uuid
          and state.status not in ('cancelled', 'completed')
          and (state.next_checkpoint_ordinal >= jsonb_array_length(run.run_parameters->'selection')
            or coalesce((select (report->>'budgetUsed')::integer from review_workspace.run_reports where run_id = state.run_id), 0)
              >= (run.run_parameters->>'budget')::integer)
        returning state.run_id
      ), claimed as (
        update review_workspace.run_checkpoints checkpoint
        set state = 'leased', lease_token = gen_random_uuid(),
            lease_expires_at = now() + interval '5 minutes', attempt = attempt + 1
        from review_workspace.run_current_state state
        where checkpoint.run_id = state.run_id and checkpoint.run_id = $1::uuid
          and state.status not in ('cancelled', 'completed')
          and checkpoint.ordinal = state.next_checkpoint_ordinal
          and (checkpoint.state = 'pending' or (checkpoint.state = 'leased' and checkpoint.lease_expires_at <= now()))
          and not exists (select 1 from completed)
        returning checkpoint.resource_id, checkpoint.ordinal, checkpoint.lease_token
      ), started as (
        update review_workspace.run_current_state state
        set status = 'running', updated_at = now(), revision = revision + 1
        where state.run_id = $1::uuid and exists (select 1 from claimed)
      )
      select resource_id, ordinal, lease_token from claimed
    `, [runId]);
    if (!rows[0]) {
      const run = await this.get(runId);
      if (!run || run.status === "cancelled" || run.status === "completed") return undefined;
      throw new RunLockError();
    }
    return { resourceId: rows[0].resource_id, checkpoint: Number(rows[0].ordinal), leaseToken: rows[0].lease_token };
  }

  async completeCheckpoint(runId: string, leaseToken: string, report: Partial<Omit<RunReport, "recordsChecked" | "budgetUsed">> = {}): Promise<void> {
    const delta = dbReport({ ...report, recordsChecked: 1, budgetUsed: 1 });
    const rows = await this.#query<{ run_id: string }>(`
      with checkpoint as (
        update review_workspace.run_checkpoints
        set state = 'completed', lease_token = null, lease_expires_at = null,
            report_delta = $3::jsonb, completed_at = now()
        where run_id = $1::uuid and lease_token = $2::uuid and state = 'leased'
          and lease_expires_at > now()
          and exists (
            select 1 from review_workspace.run_current_state
            where run_id = $1::uuid and status not in ('cancelled', 'completed')
          )
        returning run_id
      ), report as (
        update review_workspace.run_reports current
        set report = jsonb_build_object(
          'recordsChecked', coalesce((current.report->>'recordsChecked')::integer, 0) + 1,
          'candidatesStaged', coalesce((current.report->>'candidatesStaged')::integer, 0) + $4,
          'conflicts', coalesce((current.report->>'conflicts')::integer, 0) + $5,
          'unableToVerify', coalesce((current.report->>'unableToVerify')::integer, 0) + $6,
          'providerFailures', coalesce((current.report->>'providerFailures')::integer, 0) + $7,
          'budgetUsed', coalesce((current.report->>'budgetUsed')::integer, 0) + 1
        ), updated_at = now()
        where current.run_id in (select run_id from checkpoint)
        returning current.run_id, current.report
      ), advanced as (
        update review_workspace.run_current_state state
        set next_checkpoint_ordinal = next_checkpoint_ordinal + 1,
            status = case when next_checkpoint_ordinal + 1 >= jsonb_array_length(run.run_parameters->'selection')
              or coalesce((report.report->>'budgetUsed')::integer, 0) >= (run.run_parameters->>'budget')::integer
              then 'completed' else 'queued' end,
            updated_at = now(), revision = revision + 1
        from review_workspace.verification_runs run
        join report on report.run_id = run.id
        where state.run_id = run.id and state.run_id in (select run_id from checkpoint)
        returning state.run_id
      )
      select run_id from advanced
    `, [runId, leaseToken, JSON.stringify(delta), report.candidatesStaged ?? 0, report.conflicts ?? 0, report.unableToVerify ?? 0, report.providerFailures ?? 0]);
    if (!rows[0]) throw new RunLockError();
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
      set status = case when status in ('cancelled', 'completed') then status else 'queued' end,
          updated_at = now(), revision = revision + 1
      where state.run_id = $1::uuid and exists (select 1 from released)
    `, [runId, leaseToken]);
  }

  async cancel(runId: string): Promise<void> {
    await this.#query(`
      with released as (
        update review_workspace.run_checkpoints
        set state = 'pending', lease_token = null, lease_expires_at = null
        where run_id = $1::uuid and state = 'leased'
      )
      update review_workspace.run_current_state
      set status = 'cancelled', updated_at = now(), revision = revision + 1
      where run_id = $1::uuid
    `, [runId]);
  }

  async resume(runId: string): Promise<VerificationRun> {
    const rows = await this.#query<{ id: string }>(`
      update review_workspace.run_current_state
      set status = case when status = 'completed' then status else 'queued' end,
          updated_at = now(), revision = revision + 1
      where run_id = $1::uuid
      returning run_id as id
    `, [runId]);
    if (!rows[0]) throw new Error("Run not found.");
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

export const runRegistry = new NeonRunRegistry();
