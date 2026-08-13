import { authorizeCron } from "../../../lib/runs/cron.ts";

/** Scheduling remains disabled in vercel.json until a manual dry run is accepted. */
export async function GET(request: Request): Promise<Response> {
  try {
    authorizeCron(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null);
    return Response.json({ scheduled: false, message: "Cron endpoint authorized; scheduled execution is not enabled." });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Cron authorization failed." }, { status: 401 });
  }
}
