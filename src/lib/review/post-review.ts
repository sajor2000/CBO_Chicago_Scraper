import type { CandidateAction } from "../repositories/review.ts";

export type ReviewPostDependencies = {
  auth: () => Promise<{ userId: string | null }>;
  requireWorkspaceRole: (subject: string, role: "reviewer") => Promise<unknown>;
  supersede: (input: { candidateId: string; expectedRevision: number; proposedValues: Record<string, string>; actorSubject: string; reason: string }) => Promise<unknown>;
  decide: (input: { candidateId: string; expectedRevision: number; action: CandidateAction; fields?: string[]; reason: string; reviewerSubject: string; reviewerCboEligibility?: boolean }) => Promise<unknown>;
  errorStatus: (error: unknown) => number;
};

export async function postReview(request: Request, dependencies: ReviewPostDependencies): Promise<Response> {
  try {
    const { userId } = await dependencies.auth();
    if (!userId) return Response.json({ error: "Authentication required." }, { status: 401 });
    await dependencies.requireWorkspaceRole(userId, "reviewer");
    const body = await request.json() as { candidateId: string; expectedRevision: number; action: CandidateAction | "edit"; fields?: string[]; proposedValues?: Record<string, string>; reason: string; reviewerCboEligibility?: unknown };
    if (body.reviewerCboEligibility !== undefined && typeof body.reviewerCboEligibility !== "boolean") throw new Error("CBO eligibility must be a boolean.");
    if (body.reviewerCboEligibility !== undefined && body.action !== "approved" && body.action !== "rejected" && body.action !== "eligibility_confirmed") throw new Error("CBO eligibility can only accompany a terminal decision.");
    if (body.action === "eligibility_confirmed" && body.reviewerCboEligibility === undefined) throw new Error("Eligibility confirmation requires an explicit CBO label.");
    const candidate = body.action === "edit"
      ? await dependencies.supersede({ candidateId: body.candidateId, expectedRevision: body.expectedRevision, proposedValues: body.proposedValues ?? {}, actorSubject: userId, reason: body.reason })
      : await dependencies.decide({ ...body, action: body.action, reviewerSubject: userId, reviewerCboEligibility: body.reviewerCboEligibility });
    return Response.json(candidate);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Review decision failed." }, { status: dependencies.errorStatus(error) });
  }
}
