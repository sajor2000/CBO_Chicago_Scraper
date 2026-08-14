import { reviewRepository } from "../../../lib/repositories/review.ts";
import { authorizeCron, CronAuthorizationError } from "../../../lib/runs/cron.ts";
import { executeCheckpoint, type CheckpointResult } from "../../../lib/runs/execute-checkpoint.ts";
import { runRegistry, RunLockError } from "../../../lib/runs/index.ts";
import { assertHostedVerificationConfigured } from "../../../lib/verification/readiness.ts";

/** One hosted evidence checkpoint can take multiple provider round-trips. */
export const maxDuration = 60;

type CronDependencies = {
  authorize: (token: string | null) => void;
  assertBaselineReady: () => Promise<void>;
  launchScheduled: () => Promise<{ id: string }>;
  executeCheckpoint: (runId: string) => Promise<CheckpointResult>;
};

const productionDependencies: CronDependencies = {
  authorize: authorizeCron,
  assertBaselineReady: async () => {
    await reviewRepository.assertBaselineReady();
    assertHostedVerificationConfigured();
  },
  launchScheduled: () => runRegistry.launchScheduled(),
  executeCheckpoint
};

/** Vercel invokes one authenticated checkpoint; Neon leases prevent overlap. */
export async function executeScheduledCron(request: Request, dependencies: CronDependencies = productionDependencies): Promise<Response> {
  try {
    dependencies.authorize(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null);
    await dependencies.assertBaselineReady();
    const run = await dependencies.launchScheduled();
    return Response.json({ scheduled: true, runId: run.id, ...(await dependencies.executeCheckpoint(run.id)) });
  } catch (error) {
    if (error instanceof RunLockError) return Response.json({ scheduled: true, skipped: true, message: "A checkpoint is already leased." }, { status: 202 });
    const status = error instanceof CronAuthorizationError ? 401 : 500;
    return Response.json({ error: status === 401 ? "Cron authorization failed." : "Scheduled checkpoint failed." }, { status });
  }
}

export async function GET(request: Request): Promise<Response> {
  return executeScheduledCron(request);
}
