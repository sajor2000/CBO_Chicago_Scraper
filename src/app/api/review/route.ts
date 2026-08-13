import { authorizeReviewer, FixtureModeError, fixtureUserFromHeader } from "../../../lib/auth.ts";
import { reviewRepository, RevisionConflictError } from "../../../lib/repositories/review.ts";

export async function POST(request: Request): Promise<Response> {
  try {
    const reviewer = authorizeReviewer(fixtureUserFromHeader(request));
    const body = await request.json() as { candidateId: string; expectedRevision: number; action: "approved" | "rejected" | "deferred"; fields?: string[]; reason: string };
    const candidate = reviewRepository.decide({ ...body, reviewerEmail: reviewer.email });
    return Response.json(candidate);
  } catch (error) {
    const status = error instanceof RevisionConflictError ? 409 : error instanceof FixtureModeError ? 503 : 403;
    return Response.json({ error: error instanceof Error ? error.message : "Review decision failed." }, { status });
  }
}

export function GET(request: Request): Response {
  try {
    authorizeReviewer(fixtureUserFromHeader(request));
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? "50");
    return Response.json(reviewRepository.list(Number.isFinite(limit) ? limit : 50));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Reviewer authorization required." }, { status: error instanceof FixtureModeError ? 503 : 403 });
  }
}
