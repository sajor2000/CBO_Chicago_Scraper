import { redactEvidence } from "../evidence/redaction.ts";
import type { EvidenceValues, RetrievalState } from "./types.ts";

export type BenchmarkTerminal = RetrievalState | "policy_denied" | "redirect_denied" | "request_budget_exceeded";

export interface BenchmarkTarget {
  id: string;
  url: string;
  expected: { terminal: BenchmarkTerminal; values?: EvidenceValues };
  requestCeiling: number;
}

export interface BenchmarkManifest {
  version: string;
  fixtureOrigin: string;
  targets: readonly BenchmarkTarget[];
}

export interface BenchmarkReceipt {
  targetId: string;
  runner: "native_http" | "playwright" | "crawlee_playwright";
  runnerVersion: string;
  requestedUrl: string;
  finalUrl?: string;
  policyDecision: "allowed" | "denied";
  elapsedMs: number;
  requestCount: number;
  terminal: BenchmarkTerminal;
  values?: EvidenceValues;
  diagnostic?: string;
}

const allowedTerminal = new Set<BenchmarkTerminal>(["success", "no_result", "blocked", "timeout", "rate_limited", "malformed", "policy_denied", "redirect_denied", "request_budget_exceeded"]);

export function validateBenchmarkManifest(manifest: BenchmarkManifest): void {
  const fixtureUrl = new URL(manifest.fixtureOrigin);
  if (fixtureUrl.protocol !== "http:" || !["127.0.0.1", "::1", "localhost", "fixture"].includes(fixtureUrl.hostname)) throw new Error("Benchmark fixture origin must be local HTTP or the internal fixture service.");
  const origin = fixtureUrl.origin;
  if (!manifest.version.trim() || !manifest.targets.length) throw new Error("Benchmark manifest requires a version and at least one target.");
  const ids = new Set<string>();
  for (const target of manifest.targets) {
    if (!target.id.trim() || ids.has(target.id)) throw new Error("Benchmark target IDs must be present and unique.");
    ids.add(target.id);
    if (new URL(target.url).origin !== origin) throw new Error(`Benchmark target '${target.id}' is outside the fixture origin.`);
    if (!Number.isInteger(target.requestCeiling) || target.requestCeiling < 1 || target.requestCeiling > 10) throw new Error(`Benchmark target '${target.id}' has an invalid request ceiling.`);
    if (!allowedTerminal.has(target.expected.terminal)) throw new Error(`Benchmark target '${target.id}' has an invalid terminal result.`);
    if (target.expected.terminal === "success" && !target.expected.values) throw new Error(`Benchmark target '${target.id}' requires expected values.`);
  }
}

export function redactedReceipt(receipt: BenchmarkReceipt): BenchmarkReceipt {
  return receipt.diagnostic ? { ...receipt, diagnostic: redactEvidence(receipt.diagnostic).slice(0, 1_000) } : receipt;
}

export function assertReceipt(manifest: BenchmarkManifest, receipt: BenchmarkReceipt): void {
  const target = manifest.targets.find(({ id }) => id === receipt.targetId);
  if (!target) throw new Error("Benchmark receipt names an unknown target.");
  if (receipt.requestCount > target.requestCeiling) throw new Error("Benchmark receipt exceeds its request ceiling.");
  if (receipt.terminal === "success" && !receipt.values) throw new Error("Successful benchmark receipt requires extracted values.");
  if (receipt.diagnostic && receipt.diagnostic !== redactEvidence(receipt.diagnostic)) throw new Error("Benchmark receipt diagnostic must be redacted.");
}

const authorityEnvironment = ["REVIEW_DATABASE_URL", "CBO_CRON_URL", "CRON_SECRET", "EXA_API_KEY", "GOOGLE_PLACES_API_KEY", "FIRECRAWL_API_KEY", "AZURE_OPENAI_API_KEY", "CLERK_SECRET_KEY"];

export function assertNoBenchmarkAuthorityEnvironment(env: Readonly<Record<string, string | undefined>> = process.env): void {
  const present = authorityEnvironment.find((name) => env[name]);
  if (present) throw new Error(`Benchmark runner must not receive ${present}.`);
}

export function matchesExpected(target: BenchmarkTarget, receipt: BenchmarkReceipt): boolean {
  if (target.expected.terminal !== receipt.terminal) return false;
  return Object.entries(target.expected.values ?? {}).every(([field, expected]) => receipt.values?.[field as keyof EvidenceValues] === expected);
}
