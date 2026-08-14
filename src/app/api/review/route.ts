import { auth } from "@clerk/nextjs/server";
import { requireWorkspaceRole, WorkspaceAuthorizationError, WorkspaceTargetError } from "../../../lib/db.ts";
import { reviewRepository, RevisionConflictError, type CandidateAction, type CandidateStatus, type ReviewQueueFilters } from "../../../lib/repositories/review.ts";
import { postReview, type ReviewPostDependencies } from "../../../lib/review/post-review.ts";

const statuses: CandidateStatus[] = ["staged", "deferred", "rejected", "approved", "publish_pending", "published", "publish_failed"];
const kinds = ["update", "closure_review", "new_resource"] as const;
const evidenceQualities = ["high", "medium", "low"] as const;
const oneOf = <T extends string>(value: string | null, choices: readonly T[]) => value && choices.includes(value as T) ? value as T : undefined;

const productionDependencies: ReviewPostDependencies = {
  auth,
  requireWorkspaceRole,
  supersede: reviewRepository.supersede.bind(reviewRepository),
  decide: reviewRepository.decide.bind(reviewRepository),
  errorStatus: (error) => error instanceof RevisionConflictError ? 409 : error instanceof WorkspaceAuthorizationError ? 403 : error instanceof WorkspaceTargetError ? 503 : 400
};

export async function POST(request: Request): Promise<Response> {
  return postReview(request, productionDependencies);
}

export async function GET(request: Request): Promise<Response> {
  try {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Authentication required." }, { status: 401 });
    await requireWorkspaceRole(userId, "reviewer");
    const params = new URL(request.url).searchParams;
    const limit = Number(params.get("limit") ?? "50");
    const filters: ReviewQueueFilters = {
      limit: Number.isFinite(limit) ? limit : 50,
      status: oneOf(params.get("status"), statuses),
      kind: oneOf(params.get("kind"), kinds),
      evidenceQuality: oneOf(params.get("evidenceQuality"), evidenceQualities)
    };
    return Response.json(await reviewRepository.list(filters));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Review request failed." }, { status: error instanceof WorkspaceAuthorizationError ? 403 : error instanceof WorkspaceTargetError ? 503 : 400 });
  }
}
