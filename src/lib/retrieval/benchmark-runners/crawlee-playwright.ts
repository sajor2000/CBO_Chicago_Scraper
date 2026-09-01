import { Configuration, LogLevel, PlaywrightCrawler } from "crawlee";
import { redactedReceipt, type BenchmarkReceipt, type BenchmarkTarget } from "../benchmark-contract.ts";
import { extractBenchmarkValues } from "./common.ts";

function terminal(status: number | undefined, html: string): BenchmarkReceipt["terminal"] {
  if (status === 429) return "rate_limited";
  if (status === 403) return "blocked";
  if (status === undefined || status >= 400) return "malformed";
  if (/captcha|verify you are human/i.test(html)) return "blocked";
  return extractBenchmarkValues(html) ? "success" : "no_result";
}

/** Runs Crawlee defaults against exactly one fixture URL; it is a comparator, not a production adapter. */
export async function runCrawleePlaywright(target: BenchmarkTarget): Promise<BenchmarkReceipt> {
  const started = performance.now();
  let requests = 0;
  let receipt: BenchmarkReceipt | undefined;
  const crawler = new PlaywrightCrawler({
    preNavigationHooks: [async ({ page }) => { page.on("request", () => { requests += 1; }); }],
    async requestHandler({ page, request, response }) {
      const html = await page.content();
      const outcome = terminal(response?.status(), html);
      receipt = redactedReceipt({
        targetId: target.id,
        runner: "crawlee_playwright",
        runnerVersion: "crawlee",
        requestedUrl: target.url,
        finalUrl: request.loadedUrl ?? request.url,
        policyDecision: "allowed",
        elapsedMs: Math.round(performance.now() - started),
        requestCount: requests,
        terminal: outcome,
        ...(outcome === "success" ? { values: extractBenchmarkValues(html) } : {})
      });
    },
    async failedRequestHandler({ request }) {
      const diagnostic = request.errorMessages.join("; ");
      receipt = redactedReceipt({
        targetId: target.id,
        runner: "crawlee_playwright",
        runnerVersion: "crawlee",
        requestedUrl: target.url,
        finalUrl: request.loadedUrl ?? request.url,
        policyDecision: "allowed",
        elapsedMs: Math.round(performance.now() - started),
        requestCount: requests || 1,
        terminal: /429/.test(diagnostic) ? "rate_limited" : /403|captcha/i.test(diagnostic) ? "blocked" : /timeout/i.test(diagnostic) ? "timeout" : "malformed",
        diagnostic
      });
    }
  }, new Configuration({ logLevel: LogLevel.OFF }));
  await crawler.run([target.url]);
  return receipt ?? redactedReceipt({ targetId: target.id, runner: "crawlee_playwright", runnerVersion: "crawlee", requestedUrl: target.url, policyDecision: "allowed", elapsedMs: Math.round(performance.now() - started), requestCount: requests, terminal: "malformed", diagnostic: "Crawlee returned no receipt." });
}

/** Dependency-free policy contract for any later production adoption. */
export interface CrawleeBenchmarkOptions {
  minConcurrency: 1;
  maxConcurrency: 1;
  maxRequestRetries: 0;
  retryOnBlocked: false;
  useSessionPool: false;
  persistCookiesPerSession: false;
  respectRobotsTxtFile: true;
}

export function crawleeBenchmarkOptions(): CrawleeBenchmarkOptions {
  return {
    minConcurrency: 1,
    maxConcurrency: 1,
    maxRequestRetries: 0,
    retryOnBlocked: false,
    useSessionPool: false,
    persistCookiesPerSession: false,
    respectRobotsTxtFile: true
  };
}

export function assertCrawleeBenchmarkOptions(options: CrawleeBenchmarkOptions): void {
  if (options.minConcurrency !== 1 || options.maxConcurrency !== 1 || options.maxRequestRetries !== 0 || options.retryOnBlocked || options.useSessionPool || options.persistCookiesPerSession || options.respectRobotsTxtFile !== true) throw new Error("Crawlee benchmark options violate the policy boundary.");
}
