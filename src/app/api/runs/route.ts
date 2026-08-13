import { authorizeRunOperator, FixtureModeError, fixtureUserFromHeader } from "../../../lib/auth.ts";
import { runRegistry } from "../../../lib/runs/index.ts";

export async function POST(request: Request): Promise<Response> {
  try {
    authorizeRunOperator(fixtureUserFromHeader(request));
    const body = await request.json() as { idempotencyKey: string; selection: string[]; budget: number };
    return Response.json(runRegistry.launch(body), { status: 202 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Run launch failed." }, { status: error instanceof FixtureModeError ? 503 : 403 });
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    authorizeRunOperator(fixtureUserFromHeader(request));
    const body = await request.json() as { runId: string; action: "cancel" | "resume" };
    if (body.action === "cancel") runRegistry.cancel(body.runId);
    else runRegistry.resume(body.runId);
    return Response.json(runRegistry.get(body.runId));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Run update failed." }, { status: error instanceof FixtureModeError ? 503 : 403 });
  }
}
