import { auth } from "@clerk/nextjs/server";
import { requireWorkspaceRole, WorkspaceAuthorizationError, WorkspaceTargetError } from "../../../../../lib/db.ts";
import { executeCheckpoint } from "../../../../../lib/runs/execute-checkpoint.ts";
import { RunLockError } from "../../../../../lib/runs/index.ts";

/** One hosted evidence checkpoint can take multiple provider round-trips. */
export const maxDuration = 60;

/**
 * Executes exactly one leased checkpoint per request.
 * Operators should call this repeatedly (once per selected resource) during the manual pilot.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ runId: string }> }): Promise<Response> {
  const runId = (await params).runId;
  try {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Authentication required." }, { status: 401 });
    await requireWorkspaceRole(userId, "operator");

    return Response.json(await executeCheckpoint(runId));
  } catch (error) {
    const status = error instanceof WorkspaceAuthorizationError ? 403
      : error instanceof WorkspaceTargetError ? 503
        : error instanceof RunLockError ? 409 : 400;
    return Response.json({ error: error instanceof Error ? error.message : "Checkpoint execution failed." }, { status });
  }
}
