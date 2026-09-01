import { auth } from "@clerk/nextjs/server";
import { requireWorkspaceRole, WorkspaceAuthorizationError, reviewWorkspaceDb } from "../../../../lib/db.ts";
import { DISCOVERY_POLICY_VERSION } from "../../../../lib/discovery/query-matrix.ts";

type ActivationRequest = { active: boolean; acceptedCycleId?: string; dailyProviderCallCeiling?: number; rationale: string };

/** Appends the auditable kill-switch state; it neither launches work nor touches source data. */
export async function POST(request: Request): Promise<Response> {
  try {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Authentication required." }, { status: 401 });
    await requireWorkspaceRole(userId, "operator");
    const body = await request.json() as ActivationRequest;
    if (typeof body.active !== "boolean" || !body.rationale?.trim() || body.rationale.length > 1_000) throw new Error("A bounded activation rationale is required.");
    const serviceOwnerSubject = process.env.DISCOVERY_SERVICE_OWNER_SUBJECT?.trim();
    if (body.active && (!body.acceptedCycleId || serviceOwnerSubject !== userId || !Number.isInteger(body.dailyProviderCallCeiling) || body.dailyProviderCallCeiling! < 1 || body.dailyProviderCallCeiling! > 1_000)) throw new WorkspaceAuthorizationError();
    const query = reviewWorkspaceDb();
    const rows = await query`
      insert into review_workspace.discovery_activations
        (active, accepted_cycle_id, actor_subject, service_owner_subject, policy_version, daily_provider_call_ceiling, rationale)
      values (${body.active}, ${body.acceptedCycleId ?? null}::uuid, ${userId}, ${body.active ? serviceOwnerSubject : null}, ${DISCOVERY_POLICY_VERSION}, ${body.dailyProviderCallCeiling ?? 1}, ${body.rationale.trim()})
      returning id, active
    ` as Array<{ id: string; active: boolean }>;
    return Response.json(rows[0], { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Discovery activation failed." }, { status: error instanceof WorkspaceAuthorizationError ? 403 : 400 });
  }
}
