import { reviewRepository } from "../../../lib/repositories/review.ts";
import { authorizeCron, CronAuthorizationError } from "../../../lib/runs/cron.ts";
import { executeCheckpoint, type CheckpointResult } from "../../../lib/runs/execute-checkpoint.ts";
import { runRegistry, RunLockError, NoScheduledWorkError } from "../../../lib/runs/index.ts";
import { assertHostedVerificationConfigured } from "../../../lib/verification/readiness.ts";
import { discoveryRepository } from "../../../lib/discovery/repository.ts";
import { executeDiscoveryCheckpoint } from "../../../lib/discovery/execute-checkpoint.ts";

/** One hosted evidence checkpoint can take multiple provider round-trips. */
export const maxDuration = 60;

type CronDependencies = {
  authorize: (token: string | null) => void;
  assertBaselineReady: () => Promise<void>;
  launchScheduled: () => Promise<{ id: string; mode?: string } | undefined>;
  executeCheckpoint: (runId: string, mode?: string) => Promise<CheckpointResult | { done: boolean; state?: string; message?: string }>;
};

const productionDependencies: CronDependencies = {
  authorize: authorizeCron,
  assertBaselineReady: async () => {
    await reviewRepository.assertBaselineReady();
    assertHostedVerificationConfigured();
  },
  launchScheduled: async () => {
    try { return await runRegistry.launchScheduled(); }
    catch (error) {
      if (!(error instanceof NoScheduledWorkError)) throw error;
      const discovery = await discoveryRepository.oldestClaimableRun();
      return discovery && { ...discovery, mode: "discovery_only" };
    }
  },
  executeCheckpoint: (runId, mode) => mode === "discovery_only" ? executeDiscoveryCheckpoint(runId) : executeCheckpoint(runId)
};

/** Vercel invokes one authenticated checkpoint; Neon leases prevent overlap. */
export async function executeScheduledCron(request: Request, dependencies: CronDependencies = productionDependencies): Promise<Response> {
  try {
    dependencies.authorize(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null);
    await dependencies.assertBaselineReady();
    const run = await dependencies.launchScheduled();
    if (!run) return Response.json({ scheduled: true, skipped: true, message: "No known-resource or discovery checkpoint is claimable." });
    return Response.json({ scheduled: true, runId: run.id, ...(await dependencies.executeCheckpoint(run.id, run.mode)) });
  } catch (error) {
    if (error instanceof RunLockError) return Response.json({ scheduled: true, skipped: true, message: "A checkpoint is already leased." }, { status: 202 });
    const status = error instanceof CronAuthorizationError ? 401 : 500;
    return Response.json({ error: status === 401 ? "Cron authorization failed." : "Scheduled checkpoint failed." }, { status });
  }
}

export async function GET(request: Request): Promise<Response> {
  return executeScheduledCron(request);
}
