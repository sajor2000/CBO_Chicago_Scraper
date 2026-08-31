import { redactedReceipt, type BenchmarkReceipt, type BenchmarkTarget } from "../benchmark-contract.ts";
import { classifiedError, extractBenchmarkValues } from "./common.ts";

export async function runNativeHttp(target: BenchmarkTarget, fixtureOrigin: string, fetcher: typeof fetch = fetch): Promise<BenchmarkReceipt> {
  const started = performance.now();
  const permittedOrigin = new URL(fixtureOrigin).origin;
  let current = new URL(target.url);
  let requests = 0;
  try {
    for (;;) {
      if (current.origin !== permittedOrigin) return redactedReceipt({ targetId: target.id, runner: "native_http", runnerVersion: process.version, requestedUrl: target.url, finalUrl: current.toString(), policyDecision: "denied", elapsedMs: Math.round(performance.now() - started), requestCount: requests, terminal: "redirect_denied" });
      if (requests >= target.requestCeiling) return redactedReceipt({ targetId: target.id, runner: "native_http", runnerVersion: process.version, requestedUrl: target.url, finalUrl: current.toString(), policyDecision: "denied", elapsedMs: Math.round(performance.now() - started), requestCount: requests, terminal: "request_budget_exceeded" });
      requests += 1;
      const response = await fetcher(current, { redirect: "manual", signal: AbortSignal.timeout(5_000) });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return redactedReceipt({ targetId: target.id, runner: "native_http", runnerVersion: process.version, requestedUrl: target.url, finalUrl: current.toString(), policyDecision: "allowed", elapsedMs: Math.round(performance.now() - started), requestCount: requests, terminal: "malformed" });
        current = new URL(location, current);
        continue;
      }
      const terminal = response.status === 429 ? "rate_limited" : response.status === 403 ? "blocked" : response.ok ? "success" : "malformed";
      const html = terminal === "success" ? await response.text() : "";
      return redactedReceipt({ targetId: target.id, runner: "native_http", runnerVersion: process.version, requestedUrl: target.url, finalUrl: current.toString(), policyDecision: "allowed", elapsedMs: Math.round(performance.now() - started), requestCount: requests, terminal, ...(terminal === "success" ? { values: extractBenchmarkValues(html) } : {}) });
    }
  } catch (error) {
    return redactedReceipt({ targetId: target.id, runner: "native_http", runnerVersion: process.version, requestedUrl: target.url, finalUrl: current.toString(), policyDecision: "allowed", elapsedMs: Math.round(performance.now() - started), requestCount: requests, terminal: classifiedError(error), diagnostic: error instanceof Error ? error.message : "Native runner failed." });
  }
}
