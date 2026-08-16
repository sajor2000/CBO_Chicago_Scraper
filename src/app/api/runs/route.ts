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
    const body = await request.json() as
      | { mode: "manual_full_cycle"; idempotencyKey: string; budget: number }
      | { idempotencyKey: string; selection: string[]; budget: number };
    await reviewRepository.assertBaselineReady();
    assertHostedVerificationConfigured();
    if ("mode" in body && body.mode === "manual_full_cycle") {
      return Response.json(await runRegistry.launchCurrentFullCycle(body), { status: 202 });
    }
    if (!("selection" in body)) return Response.json({ error: "Unsupported run mode." }, { status: 400 });
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
    const body = await request.json() as { runId: string; action: "cancel" | "pause" | "resume"; additionalBudget?: number };
    if (body.action !== "cancel" && body.action !== "pause" && body.action !== "resume") return Response.json({ error: "Unsupported run action." }, { status: 400 });
    if (body.action === "cancel") {
      await runRegistry.cancel(body.runId);
      return Response.json(await runRegistry.get(body.runId));
    }
    if (body.action === "pause") {
      await runRegistry.pause(body.runId);
      return Response.json(await runRegistry.get(body.runId));
    }
    return Response.json(await runRegistry.resume(body.runId, body.additionalBudget ?? 0));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Run update failed." }, { status: error instanceof WorkspaceAuthorizationError ? 403 : error instanceof WorkspaceTargetError ? 503 : 400 });
  }
}
