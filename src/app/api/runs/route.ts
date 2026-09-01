import { auth } from "@clerk/nextjs/server";
import { requireWorkspaceRole, WorkspaceAuthorizationError, WorkspaceTargetError } from "../../../lib/db.ts";
import { runRegistry } from "../../../lib/runs/index.ts";
import { reviewRepository } from "../../../lib/repositories/review.ts";
import { assertDiscoveryConfigured, assertHostedVerificationConfigured } from "../../../lib/verification/readiness.ts";
import { categoryCodes } from "../../../lib/taxonomy/categories.ts";
import { DISCOVERY_COUNTIES, DISCOVERY_MAX_PROVIDER_CALLS, DISCOVERY_MAX_UNIQUE_LEADS, discoveryQueryCells } from "../../../lib/discovery/query-matrix.ts";

export async function POST(request: Request): Promise<Response> {
  try {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Authentication required." }, { status: 401 });
    await requireWorkspaceRole(userId, "operator");
    const body = await request.json() as
      | { mode: "manual_full_cycle"; idempotencyKey: string; budget: number }
      | { mode: "discovery_only"; idempotencyKey: string; categories: string[]; counties: string[]; uniqueLeadCap: number; providerCallBudget: number }
      | { idempotencyKey: string; selection: string[]; budget: number };
    await reviewRepository.assertBaselineReady();
    if ("mode" in body && body.mode === "manual_full_cycle") {
      assertHostedVerificationConfigured();
      return Response.json(await runRegistry.launchCurrentFullCycle(body), { status: 202 });
    }
    if ("mode" in body && body.mode === "discovery_only") {
      assertDiscoveryConfigured();
      const categories = body.categories.filter((value): value is typeof categoryCodes[number] => categoryCodes.includes(value as typeof categoryCodes[number]));
      const counties = body.counties.filter((value): value is typeof DISCOVERY_COUNTIES[number] => DISCOVERY_COUNTIES.includes(value as typeof DISCOVERY_COUNTIES[number]));
      if (!categories.length || categories.length !== new Set(body.categories).size || !counties.length || counties.length !== new Set(body.counties).size) return Response.json({ error: "Choose only approved discovery categories and counties." }, { status: 400 });
      return Response.json(await runRegistry.launchDiscovery({
        idempotencyKey: body.idempotencyKey,
        cells: discoveryQueryCells(categories, counties),
        uniqueLeadCap: body.uniqueLeadCap,
        providerCallBudget: body.providerCallBudget,
        dailyProviderCallCeiling: DISCOVERY_MAX_PROVIDER_CALLS
      }), { status: 202 });
    }
    assertHostedVerificationConfigured();
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
