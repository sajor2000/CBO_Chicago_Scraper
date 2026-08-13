import { auth } from "@clerk/nextjs/server";
import { requireWorkspaceRole, WorkspaceAuthorizationError, WorkspaceTargetError } from "../../../../../lib/db.ts";
import { hostedEvidenceFromEnv } from "../../../../../lib/providers/hosted-evidence.ts";
import { reviewRepository } from "../../../../../lib/repositories/review.ts";
import { runRegistry, RunLockError, type RunReport } from "../../../../../lib/runs/index.ts";
import { processVerificationCheckpoint, referenceResourceFromSnapshot } from "../../../../../lib/verification/run-checkpoint.ts";

/** One hosted evidence checkpoint can take multiple provider round-trips. */
export const maxDuration = 60;

const blankStep = (): Pick<RunReport, "recordsChecked" | "candidatesStaged" | "conflicts" | "unableToVerify" | "providerFailures" | "budgetUsed"> => ({
  recordsChecked: 0,
  candidatesStaged: 0,
  conflicts: 0,
  unableToVerify: 0,
  providerFailures: 0,
  budgetUsed: 0
});

const within = <T,>(work: Promise<T>, milliseconds: number, label: string): Promise<T> => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(`${label} timed out.`)), milliseconds);
  work.then(resolve, reject).finally(() => clearTimeout(timeout));
});

/**
 * Executes exactly one leased checkpoint per request.
 * Operators should call this repeatedly (once per selected resource) during the manual pilot.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ runId: string }> }): Promise<Response> {
  let leaseToken: string | undefined;
  const runId = (await params).runId;
  try {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Authentication required." }, { status: 401 });
    await requireWorkspaceRole(userId, "operator");

    const claim = await runRegistry.claimNext(runId);
    if (!claim) {
      const run = await runRegistry.get(runId);
      const message = run?.status === "cancelled"
        ? "This run was cancelled."
        : run?.status === "completed"
          ? "This run has no remaining checkpoints."
          : "No checkpoint is available.";
      return Response.json({ message, done: true, ...blankStep(), runStatus: run?.status });
    }
    leaseToken = claim.leaseToken;

    const hostedEvidence = hostedEvidenceFromEnv();
    const seeded = await reviewRepository.seededResource(claim.resourceId);
    if (!seeded) throw new Error("Selected resource has no seeded public snapshot.");
    const resource = referenceResourceFromSnapshot(seeded);
    const observations = await within(hostedEvidence.collect(resource), 30_000, "Evidence collection");
    const advisory = await within(hostedEvidence.score(resource, observations), 15_000, "Evidence scoring");
    const output = await processVerificationCheckpoint({
      resource,
      observations,
      advisory,
      stage: (candidate) => reviewRepository.stageVerification({ resourceId: resource.id, runId, leaseToken: claim.leaseToken, ...candidate })
    });
    await runRegistry.completeCheckpoint(runId, claim.leaseToken, output.report);
    leaseToken = undefined;

    const run = await runRegistry.get(runId);
    return Response.json({
      recordsChecked: 1,
      budgetUsed: 1,
      candidatesStaged: output.report.candidatesStaged ?? 0,
      conflicts: output.report.conflicts ?? 0,
      unableToVerify: output.report.unableToVerify ?? 0,
      providerFailures: output.report.providerFailures ?? 0,
      state: output.result.state,
      reasons: output.result.reasons,
      resourceId: claim.resourceId,
      done: run?.status === "completed" || run?.status === "cancelled",
      runStatus: run?.status
    });
  } catch (error) {
    if (leaseToken) {
      try { await runRegistry.releaseLease(runId, leaseToken); } catch { /* best-effort release */ }
    }
    const status = error instanceof WorkspaceAuthorizationError ? 403
      : error instanceof WorkspaceTargetError ? 503
        : error instanceof RunLockError ? 409 : 400;
    return Response.json({ error: error instanceof Error ? error.message : "Checkpoint execution failed." }, { status });
  }
}
