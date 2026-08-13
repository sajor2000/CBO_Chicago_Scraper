import { authorizeCron } from "../../../lib/runs/cron.ts";
import { executeCheckpoint } from "../../../lib/runs/execute-checkpoint.ts";
import { runRegistry, RunLockError } from "../../../lib/runs/index.ts";

/** Vercel invokes one authenticated checkpoint; Neon leases prevent overlap. */
export async function GET(request: Request): Promise<Response> {
  try {
    authorizeCron(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null);
    const run = await runRegistry.launchScheduled();
    return Response.json({ scheduled: true, runId: run.id, ...(await executeCheckpoint(run.id)) });
  } catch (error) {
    if (error instanceof RunLockError) return Response.json({ scheduled: true, skipped: true, message: "A checkpoint is already leased." }, { status: 202 });
    const status = error instanceof Error && error.message === "Invalid cron authorization." ? 401 : 500;
    return Response.json({ error: status === 401 ? "Cron authorization failed." : "Scheduled checkpoint failed." }, { status });
  }
}
