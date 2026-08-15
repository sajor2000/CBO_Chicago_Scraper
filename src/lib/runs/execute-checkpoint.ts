import { hostedEvidenceFromEnv } from "../providers/hosted-evidence.ts";
import { reviewProvenance, reviewRepository } from "../repositories/review.ts";
import type { CapturedObservation } from "../retrieval/types.ts";
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
  resourceName?: string;
};

const blankStep = (): Pick<RunReport, "recordsChecked" | "candidatesStaged" | "conflicts" | "unableToVerify" | "providerFailures" | "budgetUsed"> => ({
  recordsChecked: 0, candidatesStaged: 0, conflicts: 0, unableToVerify: 0, providerFailures: 0, budgetUsed: 0
});

const within = <T,>(work: Promise<T>, milliseconds: number, label: string): Promise<T> => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`${label} timed out.`)), milliseconds);
  work.then(resolve, reject).finally(() => clearTimeout(timeout));
});

export function providerIssuesFor(observations: CapturedObservation[], advisoryError?: unknown): string[] {
  const issues = observations
    .filter((observation) => observation.state !== "success" && observation.state !== "no_result")
    .map((observation) => `${observation.provider}:${observation.state}`);
  if (!advisoryError) return issues;
  const message = advisoryError instanceof Error ? advisoryError.message : "";
  const httpStatus = message.match(/request failed \((\d{3})\)/)?.[1];
  const state = /timed out/i.test(message) ? "timeout"
    : httpStatus ? `http_${httpStatus}`
      : /response|structured|invalid|JSON/i.test(message) ? "malformed" : "unavailable";
  return [...issues, `azure_openai:${state}`];
}

/** Executes one leased checkpoint; callers own authorization and HTTP response mapping. */
export async function executeCheckpoint(runId: string): Promise<CheckpointResult> {
  let leaseToken: string | undefined;
  let resourceId: string | undefined;
  let resourceName: string | undefined;
  let attempt = 0;
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
    resourceId = claim.resourceId;
    attempt = claim.attempt;
    const hostedEvidence = hostedEvidenceFromEnv();
    const seeded = await reviewRepository.seededResource(claim.resourceId, claim.snapshotId);
    if (!seeded) throw new Error("Selected resource has no seeded public snapshot.");
    const resource = referenceResourceFromSnapshot(seeded);
    resourceName = resource.name;
    const observations = await within(hostedEvidence.collect(resource), 30_000, "Evidence collection");
    let advisoryError: unknown;
    const advisory = await within(hostedEvidence.score(resource, observations), 25_000, "Evidence scoring").catch((error) => {
      advisoryError = error;
      return undefined;
    });
    const providerIssues = providerIssuesFor(observations, advisoryError);
    if (providerIssues.length) console.warn("Verification provider issues", { runId, resourceId: claim.resourceId, providerIssues });
    const output = await processVerificationCheckpoint({
      resource,
      observations,
      advisory,
      stage: (candidate) => reviewRepository.stageVerification({ resourceId: resource.id, runId, leaseToken: claim.leaseToken, ...candidate })
    });
    if (!advisory) output.report.providerFailures = (output.report.providerFailures ?? 0) + 1;
    await runRegistry.completeCheckpoint(runId, claim.leaseToken, output.report, output.outcome, {
      resourceName: resource.name,
      verificationState: output.result.state,
      reasons: output.result.reasons,
      providerIssues,
      evidence: reviewProvenance({ observations: output.result.observations, advisory: output.result.advisory })
    });
    leaseToken = undefined;
    const runStatus = await runRegistry.status(runId);
    return {
      recordsChecked: 1, budgetUsed: 1,
      candidatesStaged: output.report.candidatesStaged ?? 0,
      conflicts: output.report.conflicts ?? 0,
      unableToVerify: output.report.unableToVerify ?? 0,
      providerFailures: output.report.providerFailures ?? 0,
      state: output.result.state, reasons: output.result.reasons, providerIssues, resourceId: claim.resourceId,
      done: runStatus === "completed" || runStatus === "cancelled", runStatus, resourceName: resource.name
    };
  } catch (error) {
    if (leaseToken) {
      try {
        await runRegistry.completeCheckpoint(runId, leaseToken, { providerFailures: 1 }, "provider_failure", {
          resourceName: resourceName ?? "Selected resource",
          verificationState: "provider_failure",
          reasons: ["Verification could not complete; this resource needs a later retry."],
          providerIssues: ["execution:failed"],
          evidence: { observations: [] }
        });
        const runStatus = await runRegistry.status(runId);
        return {
          recordsChecked: 1, candidatesStaged: 0, conflicts: 0, unableToVerify: 0, providerFailures: 1, budgetUsed: 1,
          state: "provider_failure", reasons: ["Verification could not complete; this resource needs a later retry."],
          providerIssues: ["execution:failed"], resourceId, resourceName,
          done: runStatus === "completed" || runStatus === "cancelled", runStatus
        };
      } catch {
        try { await runRegistry.releaseLease(runId, leaseToken); } catch { /* preserve the original execution error */ }
      }
    }
    throw error;
  }
}
