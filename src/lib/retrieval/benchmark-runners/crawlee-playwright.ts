/** Dependency-free policy contract. Install Crawlee only after the B1 escalation decision. */
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
