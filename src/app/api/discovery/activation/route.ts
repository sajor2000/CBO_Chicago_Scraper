import { auth } from "@clerk/nextjs/server";
import { requireWorkspaceRole, WorkspaceAuthorizationError, WorkspaceTargetError } from "../../../../lib/db.ts";
import { discoveryRepository } from "../../../../lib/discovery/repository.ts";
import { DISCOVERY_QUERY_POLICY_VERSION } from "../../../../lib/discovery/query-matrix.ts";

export async function GET(): Promise<Response> {
  try {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Authentication required." }, { status: 401 });
    await requireWorkspaceRole(userId, "operator");
    return Response.json({ policyVersion: DISCOVERY_QUERY_POLICY_VERSION, activation: await discoveryRepository.activation() });
  } catch (error) {
    return Response.json({ error: "Discovery activation could not be read." }, { status: error instanceof WorkspaceAuthorizationError ? 403 : error instanceof WorkspaceTargetError ? 503 : 400 });
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Authentication required." }, { status: 401 });
    await requireWorkspaceRole(userId, "operator");
    const body = await request.json() as { action: "activated" | "deactivated"; acceptedCycleId: string; dailyProviderCallCeiling: number; rationale: string; serviceOwnerApproval: string };
    if (!['activated','deactivated'].includes(body.action)) return Response.json({ error: "Unsupported activation action." }, { status: 400 });
    return Response.json(await discoveryRepository.recordActivation({ ...body, queryPolicyVersion: DISCOVERY_QUERY_POLICY_VERSION, actorSubject: userId }));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Discovery activation failed." }, { status: error instanceof WorkspaceAuthorizationError ? 403 : error instanceof WorkspaceTargetError ? 503 : 400 });
  }
}
