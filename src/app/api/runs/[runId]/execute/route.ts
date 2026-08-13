import { auth } from "@clerk/nextjs/server";
import { requireWorkspaceRole, WorkspaceAuthorizationError, WorkspaceTargetError } from "../../../../../lib/db.ts";
import { hostedEvidenceFromEnv } from "../../../../../lib/providers/hosted-evidence.ts";
import { reviewRepository } from "../../../../../lib/repositories/review.ts";
import { runRegistry, RunLockError, type RunReport } from "../../../../../lib/runs/index.ts";
import { processVerificationCheckpoint, referenceResourceFromSnapshot } from "../../../../../lib/verification/run-checkpoint.ts";

const blankTotals = (): RunReport => ({
  recordsChecked: 0,
  candidatesStaged: 0,
  conflicts: 0,
  unableToVerify: 0,
  providerFailures: 0,
  budgetUsed: 0
});

/** Executes up to `limit` leased checkpoints (1–100). Operators can repeat this during the manual pilot. */
export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }): Promise<Response> {
  try {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Authentication required." }, { status: 401 });
    await requireWorkspaceRole(userId, "operator");
    const body = await request.json().catch(() => ({})) as { limit?: number };
    const limit = Math.max(1, Math.min(Number(body.limit ?? 1) || 1, 100));
    const hostedEvidence = hostedEvidenceFromEnv();
    const runId = (await params).runId;
    const totals = blankTotals();
    let lastState: string | undefined;
    let lastReasons: string[] | undefined;

    for (let index = 0; index < limit; index += 1) {
      const claim = await runRegistry.claimNext(runId);
      if (!claim) break;
      const seeded = await reviewRepository.seededResource(claim.resourceId);
      if (!seeded) throw new Error("Selected resource has no seeded public snapshot.");
      const resource = referenceResourceFromSnapshot(seeded);
      const observations = await hostedEvidence.collect(resource);
      const advisory = await hostedEvidence.score(resource, observations);
      const output = await processVerificationCheckpoint({
        resource,
        observations,
        advisory,
        stage: (candidate) => reviewRepository.stageVerification({ resourceId: resource.id, runId, ...candidate })
      });
      await runRegistry.completeCheckpoint(runId, claim.leaseToken, output.report);
      totals.recordsChecked += 1;
      totals.budgetUsed += 1;
      totals.candidatesStaged += output.report.candidatesStaged ?? 0;
      totals.conflicts += output.report.conflicts ?? 0;
      totals.unableToVerify += output.report.unableToVerify ?? 0;
      totals.providerFailures += output.report.providerFailures ?? 0;
      lastState = output.result.state;
      lastReasons = output.result.reasons;
    }

    if (!totals.recordsChecked) {
      const run = await runRegistry.get(runId);
      return Response.json({
        message: run?.status === "completed" || run?.status === "cancelled"
          ? "No checkpoint is available."
          : "No checkpoint is available.",
        ...totals,
        runStatus: run?.status
      });
    }

    const run = await runRegistry.get(runId);
    return Response.json({
      ...totals,
      state: lastState,
      reasons: lastReasons,
      runStatus: run?.status
    });
  } catch (error) {
    const status = error instanceof WorkspaceAuthorizationError ? 403
      : error instanceof WorkspaceTargetError ? 503
        : error instanceof RunLockError ? 409 : 400;
    return Response.json({ error: error instanceof Error ? error.message : "Checkpoint execution failed." }, { status });
  }
}
