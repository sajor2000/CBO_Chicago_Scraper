import { auth } from "@clerk/nextjs/server";
import { requireWorkspaceRole, WorkspaceAuthorizationError, WorkspaceTargetError } from "../../../lib/db.ts";
import { reviewRepository, RevisionConflictError, type CandidateAction } from "../../../lib/repositories/review.ts";

export async function POST(request: Request): Promise<Response> {
  try {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Authentication required." }, { status: 401 });
    await requireWorkspaceRole(userId, "reviewer");
    const body = await request.json() as { candidateId: string; expectedRevision: number; action: CandidateAction | "edit"; fields?: string[]; proposedValues?: Record<string, string>; reason: string };
    const candidate = body.action === "edit"
      ? await reviewRepository.supersede({ candidateId: body.candidateId, expectedRevision: body.expectedRevision, proposedValues: body.proposedValues ?? {}, actorSubject: userId, reason: body.reason })
      : await reviewRepository.decide({ ...body, action: body.action, reviewerSubject: userId });
    return Response.json(candidate);
  } catch (error) {
    const status = error instanceof RevisionConflictError ? 409 : error instanceof WorkspaceAuthorizationError ? 403 : error instanceof WorkspaceTargetError ? 503 : 400;
    return Response.json({ error: error instanceof Error ? error.message : "Review decision failed." }, { status });
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Authentication required." }, { status: 401 });
    await requireWorkspaceRole(userId, "reviewer");
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? "50");
    return Response.json(await reviewRepository.list(Number.isFinite(limit) ? limit : 50));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Review request failed." }, { status: error instanceof WorkspaceAuthorizationError ? 403 : error instanceof WorkspaceTargetError ? 503 : 400 });
  }
}
