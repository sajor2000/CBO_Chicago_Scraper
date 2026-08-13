import { auth } from "@clerk/nextjs/server";
import { requireWorkspaceRole, WorkspaceAuthorizationError, WorkspaceTargetError } from "../../../../../lib/db.ts";
import { hostedEvidenceFromEnv } from "../../../../../lib/providers/hosted-evidence.ts";
import { reviewRepository } from "../../../../../lib/repositories/review.ts";
import { runRegistry, RunLockError } from "../../../../../lib/runs/index.ts";
import { processVerificationCheckpoint, referenceResourceFromSnapshot } from "../../../../../lib/verification/run-checkpoint.ts";

/** Executes one leased checkpoint. Operators can repeat this deliberately during the manual pilot. */
export async function POST(_request: Request, { params }: { params: Promise<{ runId: string }> }): Promise<Response> {
  try {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Authentication required." }, { status: 401 });
    await requireWorkspaceRole(userId, "operator");
    const hostedEvidence = hostedEvidenceFromEnv();
    const runId = (await params).runId;
    const claim = await runRegistry.claimNext(runId);
    if (!claim) return Response.json({ message: "No checkpoint is available." });
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
    return Response.json({ state: output.result.state, reasons: output.result.reasons });
  } catch (error) {
    const status = error instanceof WorkspaceAuthorizationError ? 403
      : error instanceof WorkspaceTargetError ? 503
        : error instanceof RunLockError ? 409 : 400;
    return Response.json({ error: error instanceof Error ? error.message : "Checkpoint execution failed." }, { status });
  }
}
