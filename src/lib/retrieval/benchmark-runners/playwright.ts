import { chromium } from "playwright";
import { redactedReceipt, type BenchmarkReceipt, type BenchmarkTarget } from "../benchmark-contract.ts";
import { classifiedError, extractBenchmarkValues } from "./common.ts";

export async function runPlaywright(target: BenchmarkTarget, fixtureOrigin: string): Promise<BenchmarkReceipt> {
  const started = performance.now();
  const permittedOrigin = new URL(fixtureOrigin).origin;
  let requests = 0;
  let denied: BenchmarkReceipt["terminal"] | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    await page.route("**/*", async (route) => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.origin !== permittedOrigin) {
        denied = "redirect_denied";
        await route.abort();
        return;
      }
      if (requests >= target.requestCeiling) {
        denied = "request_budget_exceeded";
        await route.abort();
        return;
      }
      requests += 1;
      await route.continue();
    });
    const response = await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 5_000 });
    await page.waitForTimeout(25);
    const terminal = denied ?? (response?.status() === 429 ? "rate_limited" : response?.status() === 403 ? "blocked" : response?.ok() ? "success" : "malformed");
    return redactedReceipt({ targetId: target.id, runner: "playwright", runnerVersion: "playwright", requestedUrl: target.url, finalUrl: page.url(), policyDecision: terminal === "redirect_denied" || terminal === "request_budget_exceeded" ? "denied" : "allowed", elapsedMs: Math.round(performance.now() - started), requestCount: requests, terminal, ...(terminal === "success" ? { values: extractBenchmarkValues(await page.content()) } : {}) });
  } catch (error) {
    return redactedReceipt({ targetId: target.id, runner: "playwright", runnerVersion: "playwright", requestedUrl: target.url, policyDecision: denied ? "denied" : "allowed", elapsedMs: Math.round(performance.now() - started), requestCount: requests, terminal: denied ?? classifiedError(error), diagnostic: error instanceof Error ? error.message : "Playwright runner failed." });
  } finally {
    await browser?.close();
  }
}
