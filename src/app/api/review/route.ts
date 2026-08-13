import { auth } from "@clerk/nextjs/server";
import { reviewRepository, RevisionConflictError, type CandidateAction } from "../../../lib/repositories/review.ts";

export async function POST(request: Request): Promise<Response> {
  try {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Authentication required." }, { status: 401 });
    const body = await request.json() as { candidateId: string; expectedRevision: number; action: CandidateAction; fields?: string[]; reason: string };
    const candidate = reviewRepository.decide({ ...body, reviewerEmail: userId });
    return Response.json(candidate);
  } catch (error) {
    const status = error instanceof RevisionConflictError ? 409 : 400;
    return Response.json({ error: error instanceof Error ? error.message : "Review decision failed." }, { status });
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Authentication required." }, { status: 401 });
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? "50");
    return Response.json(reviewRepository.list(Number.isFinite(limit) ? limit : 50));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Review request failed." }, { status: 400 });
  }
}
