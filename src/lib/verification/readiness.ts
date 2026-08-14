import { assertReviewWorkspace } from "../db.ts";
import { reviewRepository } from "../repositories/review.ts";

const requiredConfiguration = ["FIRECRAWL_API_KEY", "GOOGLE_MAPS_API_KEY", "TAVILY_API_KEY", "AZURE_OPENAI_ENDPOINT", "AZURE_OPENAI_API_KEY", "AZURE_OPENAI_DEPLOYMENT", "CRON_SECRET"] as const;

export type VerificationReadiness = {
  ready: boolean;
  checks: Array<{ name: "workspace" | "baseline" | "configuration"; ready: boolean; message: string }>;
};

export function assertHostedVerificationConfigured(env: Record<string, string | undefined> = process.env): void {
  const missing = requiredConfiguration.filter((name) => !env[name]);
  if (missing.length) throw new Error(`Hosted verification is not configured: ${missing.join(", ")}.`);
}

export async function verificationReadiness(input: {
  checkWorkspace?: () => Promise<void>;
  checkBaseline?: () => Promise<void>;
  env?: Record<string, string | undefined>;
} = {}): Promise<VerificationReadiness> {
  const checks: VerificationReadiness["checks"] = [];
  for (const [name, check] of [
    ["workspace", input.checkWorkspace ?? (() => assertReviewWorkspace())],
    ["baseline", input.checkBaseline ?? (() => reviewRepository.assertBaselineReady())],
    ["configuration", () => assertHostedVerificationConfigured(input.env)]
  ] as const) {
    try {
      await check();
      checks.push({ name, ready: true, message: "Ready." });
    } catch (error) {
      checks.push({ name, ready: false, message: error instanceof Error ? error.message : "Not ready." });
    }
  }
  return { ready: checks.every((check) => check.ready), checks };
}
