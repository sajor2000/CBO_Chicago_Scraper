export type RunStatus = "queued" | "running" | "cancelled" | "completed" | "failed";

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

/** In-memory stand-in for the planned Neon run/lock/checkpoint tables. */
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

export const runRegistry = new InMemoryRunRegistry();
