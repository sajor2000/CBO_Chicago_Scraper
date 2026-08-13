import { auth } from "@clerk/nextjs/server";
import { runRegistry } from "../../../lib/runs/index.ts";

export async function POST(request: Request): Promise<Response> {
  try {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Authentication required." }, { status: 401 });
    const body = await request.json() as { idempotencyKey: string; selection: string[]; budget: number };
    return Response.json(runRegistry.launch(body), { status: 202 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Run launch failed." }, { status: 400 });
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const { userId } = await auth();
    if (!userId) return Response.json({ error: "Authentication required." }, { status: 401 });
    const body = await request.json() as { runId: string; action: "cancel" | "resume" };
    if (body.action === "cancel") runRegistry.cancel(body.runId);
    else runRegistry.resume(body.runId);
    return Response.json(runRegistry.get(body.runId));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Run update failed." }, { status: 400 });
  }
}
