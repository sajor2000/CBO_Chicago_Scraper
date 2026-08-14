import { hostedEvidenceFromEnv } from "../providers/hosted-evidence.ts";
import { reviewRepository } from "../repositories/review.ts";
import { processVerificationCheckpoint, referenceResourceFromSnapshot } from "../verification/run-checkpoint.ts";
import { runRegistry, type RunReport } from "./index.ts";

export type CheckpointResult = Pick<RunReport, "recordsChecked" | "candidatesStaged" | "conflicts" | "unableToVerify" | "providerFailures" | "budgetUsed"> & {
  message?: string;
  done: boolean;
  runStatus?: string;
  state?: string;
  reasons?: string[];
  providerIssues?: string[];
  resourceId?: string;
};

const blankStep = (): Pick<RunReport, "recordsChecked" | "candidatesStaged" | "conflicts" | "unableToVerify" | "providerFailures" | "budgetUsed"> => ({
  recordsChecked: 0, candidatesStaged: 0, conflicts: 0, unableToVerify: 0, providerFailures: 0, budgetUsed: 0
});

const within = <T,>(work: Promise<T>, milliseconds: number, label: string): Promise<T> => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`${label} timed out.`)), milliseconds);
  work.then(resolve, reject).finally(() => clearTimeout(timeout));
});

/** Executes one leased checkpoint; callers own authorization and HTTP response mapping. */
export async function executeCheckpoint(runId: string): Promise<CheckpointResult> {
  let leaseToken: string | undefined;
  try {
    const claim = await runRegistry.claimNext(runId);
    if (!claim) {
      const run = await runRegistry.get(runId);
      const message = run?.status === "cancelled" ? "This run was cancelled."
        : run?.status === "completed" ? "This run has no remaining checkpoints."
          : "No checkpoint is available.";
      return { message, done: true, ...blankStep(), runStatus: run?.status };
    }
    leaseToken = claim.leaseToken;
    const hostedEvidence = hostedEvidenceFromEnv();
    const seeded = await reviewRepository.seededResource(claim.resourceId, claim.snapshotId);
    if (!seeded) throw new Error("Selected resource has no seeded public snapshot.");
    const resource = referenceResourceFromSnapshot(seeded);
    const observations = await within(hostedEvidence.collect(resource), 30_000, "Evidence collection");
    const advisory = await within(hostedEvidence.score(resource, observations), 25_000, "Evidence scoring").catch(() => undefined);
    const providerIssues = observations
      .filter((observation) => observation.state !== "success" && observation.state !== "no_result")
      .map((observation) => `${observation.provider}:${observation.state}`);
    if (!advisory) providerIssues.push("azure_openai:unavailable");
    if (providerIssues.length) console.warn("Verification provider issues", { runId, resourceId: claim.resourceId, providerIssues });
    const output = await processVerificationCheckpoint({
      resource,
      observations,
      advisory,
      stage: (candidate) => reviewRepository.stageVerification({ resourceId: resource.id, runId, leaseToken: claim.leaseToken, ...candidate })
    });
    if (!advisory) output.report.providerFailures = (output.report.providerFailures ?? 0) + 1;
    await runRegistry.completeCheckpoint(runId, claim.leaseToken, output.report, output.outcome);
    leaseToken = undefined;
    const runStatus = await runRegistry.status(runId);
    return {
      recordsChecked: 1, budgetUsed: 1,
      candidatesStaged: output.report.candidatesStaged ?? 0,
      conflicts: output.report.conflicts ?? 0,
      unableToVerify: output.report.unableToVerify ?? 0,
      providerFailures: output.report.providerFailures ?? 0,
      state: output.result.state, reasons: output.result.reasons, providerIssues, resourceId: claim.resourceId,
      done: runStatus === "completed" || runStatus === "cancelled", runStatus
    };
  } catch (error) {
    if (leaseToken) {
      try { await runRegistry.releaseLease(runId, leaseToken); } catch { /* best-effort release */ }
    }
    throw error;
  }
}
