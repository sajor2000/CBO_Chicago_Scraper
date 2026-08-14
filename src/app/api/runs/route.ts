import { auth } from "@clerk/nextjs/server";
import { requireWorkspaceRole, WorkspaceAuthorizationError, WorkspaceTargetError } from "../../../lib/db.ts";
import { runRegistry } from "../../../lib/runs/index.ts";
import { reviewRepository } from "../../../lib/repositories/review.ts";
import { assertHostedVerificationConfigured } from "../../../lib/verification/readiness.ts";

export async function POST(request: Request): Promise<Response> {
  try {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Authentication required." }, { status: 401 });
    await requireWorkspaceRole(userId, "operator");
    const body = await request.json() as { idempotencyKey: string; selection: string[]; budget: number };
    await reviewRepository.assertBaselineReady();
    assertHostedVerificationConfigured();
    return Response.json(await runRegistry.launch(body), { status: 202 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Run launch failed." }, { status: error instanceof WorkspaceAuthorizationError ? 403 : error instanceof WorkspaceTargetError ? 503 : 400 });
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Authentication required." }, { status: 401 });
    await requireWorkspaceRole(userId, "operator");
    const body = await request.json() as { runId: string; action: "cancel" | "resume"; additionalBudget?: number };
    if (body.action !== "cancel" && body.action !== "resume") return Response.json({ error: "Unsupported run action." }, { status: 400 });
    if (body.action === "cancel") {
      await runRegistry.cancel(body.runId);
      return Response.json(await runRegistry.get(body.runId));
    }
    return Response.json(await runRegistry.resume(body.runId, body.additionalBudget ?? 0));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Run update failed." }, { status: error instanceof WorkspaceAuthorizationError ? 403 : error instanceof WorkspaceTargetError ? 503 : 400 });
  }
}
