import { auth } from "@clerk/nextjs/server";
import { requireWorkspaceRole, WorkspaceAuthorizationError, WorkspaceTargetError } from "../../../../lib/db.ts";
import { createDataTeamCsv, isDataTeamRelation } from "../../../../lib/export/data-team-csv.ts";
import { reviewRepository } from "../../../../lib/repositories/review.ts";

export async function GET(request: Request): Promise<Response> {
  try {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Authentication required." }, { status: 401 });
    await requireWorkspaceRole(userId, "operator");
    const relation = new URL(request.url).searchParams.get("relation");
    if (!isDataTeamRelation(relation)) return Response.json({ error: "Choose an approved CBO or WIC source relation." }, { status: 400 });
    const csv = createDataTeamCsv(relation, await reviewRepository.dataTeamHandoff(relation));
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${relation}-approved.csv"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    if (error instanceof WorkspaceAuthorizationError) return Response.json({ error: error.message }, { status: 403 });
    if (error instanceof WorkspaceTargetError) return Response.json({ error: "Data-team handoff is unavailable." }, { status: 503 });
    return Response.json({ error: "Data-team handoff failed." }, { status: 500 });
  }
}
