import { neon } from "@neondatabase/serverless";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { Configuration, LogLevel, PlaywrightCrawler } from "crawlee";

type Gold = { id: string; name: string; address: string | null; phone: string | null; url: string };
type Outcome = { runner: string; reached: boolean; name: boolean; address: boolean; phone: boolean; elapsedMs: number };
type Summary = { attempted: number; reached: number; nameMatches: number; addressMatches: number; phoneMatches: number; medianElapsedMs: number; variableProviderCostUsd: number };

const databaseUrl = process.env.REAL_BENCHMARK_DATABASE_URL;
if (!databaseUrl) throw new Error("REAL_BENCHMARK_DATABASE_URL is required.");
const limit = 100;
const supportedRunners = ["native_http", "playwright", "crawlee_playwright", "scrapling_fetcher"] as const;
const selectedRunners = new Set((process.env.REAL_BENCHMARK_RUNNERS ?? supportedRunners.join(",")).split(","));
if ([...selectedRunners].some((runner) => !supportedRunners.includes(runner as typeof supportedRunners[number]))) throw new Error("REAL_BENCHMARK_RUNNERS contains an unsupported runner.");
const text = (value: string) => value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").toLowerCase();
const compact = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const judge = (runner: string, gold: Gold, html: string, elapsedMs: number): Outcome => {
  const page = text(html);
  return {
    runner,
    reached: true,
    name: compact(gold.name).length > 4 && page.includes(gold.name.toLowerCase()),
    address: Boolean(gold.address && compact(gold.address).length > 6 && page.includes(gold.address.toLowerCase())),
    phone: Boolean(gold.phone && compact(gold.phone).length > 6 && compact(page).includes(compact(gold.phone))),
    elapsedMs
  };
};
const failure = (runner: string, elapsedMs: number): Outcome => ({ runner, reached: false, name: false, address: false, phone: false, elapsedMs });
const started = () => performance.now();

async function native(gold: Gold): Promise<Outcome> {
  const began = started();
  try {
    const response = await fetch(gold.url, { redirect: "follow", signal: AbortSignal.timeout(15_000), headers: { "user-agent": "CBO retrieval bake-off/1.0" } });
    return response.ok ? judge("native_http", gold, await response.text(), performance.now() - began) : failure("native_http", performance.now() - began);
  } catch { return failure("native_http", performance.now() - began); }
}

async function playwright(browser: Awaited<ReturnType<typeof chromium.launch>>, gold: Gold): Promise<Outcome> {
  const began = started();
  let page: Awaited<ReturnType<typeof browser.newPage>> | undefined;
  try {
    page = await browser.newPage();
    const response = await page.goto(gold.url, { waitUntil: "domcontentloaded", timeout: 15_000 });
    return response?.ok() ? judge("playwright", gold, await page.content(), performance.now() - began) : failure("playwright", performance.now() - began);
  } catch { return failure("playwright", performance.now() - began); } finally { await page?.close(); }
}

async function crawlee(cohort: Gold[]): Promise<Outcome[]> {
  const began = new Map(cohort.map((gold) => [gold.id, started()]));
  const outcomes = new Map(cohort.map((gold) => [gold.id, failure("crawlee_playwright", 0)]));
  const crawler = new PlaywrightCrawler({
    minConcurrency: 1,
    maxConcurrency: 1,
    preNavigationHooks: [({ request }) => { request.userData.began = performance.now(); }],
    async requestHandler({ page, response, request }) {
      const gold = request.userData.gold as Gold;
      const elapsedMs = performance.now() - ((request.userData.began as number | undefined) ?? began.get(gold.id)!);
      outcomes.set(gold.id, response?.ok() ? judge("crawlee_playwright", gold, await page.content(), elapsedMs) : failure("crawlee_playwright", elapsedMs));
    },
    async failedRequestHandler({ request }) {
      const gold = request.userData.gold as Gold;
      outcomes.set(gold.id, failure("crawlee_playwright", performance.now() - ((request.userData.began as number | undefined) ?? began.get(gold.id)!)));
    }
  }, new Configuration({ logLevel: LogLevel.OFF }));
  await crawler.run(cohort.map((gold) => ({ url: gold.url, userData: { gold } })));
  return cohort.map((gold) => {
    const outcome = outcomes.get(gold.id)!;
    return { ...outcome, elapsedMs: outcome.elapsedMs || performance.now() - began.get(gold.id)! };
  });
}

async function scrapling(cohort: Gold[]): Promise<Summary> {
  const child = spawn("uv", ["run", "--with", "scrapling[all]==0.4.15", "python", "scripts/run-scrapling-real-bakeoff.py"], { stdio: ["pipe", "pipe", "pipe"] });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  child.stdin.end(JSON.stringify(cohort));
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  if (code !== 0) throw new Error(`Scrapling exited with code ${code}: ${Buffer.concat(stderr).toString("utf8")}`);
  return JSON.parse(Buffer.concat(stdout).toString("utf8")) as Summary;
}

const query = neon(databaseUrl);
const cohort = await query`
  select id::text, name, address, phone, url from (
    select distinct on (hyperlink) id, organization_name as name, full_address as address, phone, hyperlink as url
    from public.community_resource_locations
    where hyperlink ~ '^https?://'
      and organization_name is not null and length(trim(organization_name)) > 4
    order by hyperlink, id
  ) as distinct_sources
  order by id limit ${limit}
` as Gold[];
if (cohort.length !== limit) throw new Error("The source cohort is smaller than 100 records.");
const outcomes: Outcome[] = [];
if (selectedRunners.has("native_http")) for (const gold of cohort) outcomes.push(await native(gold));
if (selectedRunners.has("playwright")) {
  const browser = await chromium.launch({ headless: true });
  try { for (const gold of cohort) outcomes.push(await playwright(browser, gold)); } finally { await browser.close(); }
}
if (selectedRunners.has("crawlee_playwright")) outcomes.push(...await crawlee(cohort));
const byRunner = Object.groupBy(outcomes, ({ runner }) => runner);
const summary: Record<string, Summary> = Object.fromEntries(Object.entries(byRunner).map(([runner, rows]) => [runner, {
  attempted: rows!.length,
  reached: rows!.filter((row) => row.reached).length,
  nameMatches: rows!.filter((row) => row.name).length,
  addressMatches: rows!.filter((row) => row.address).length,
  phoneMatches: rows!.filter((row) => row.phone).length,
  medianElapsedMs: [...rows!].sort((left, right) => left.elapsedMs - right.elapsedMs)[Math.floor(rows!.length / 2)]!.elapsedMs,
  variableProviderCostUsd: 0
}]));
if (selectedRunners.has("scrapling_fetcher")) summary.scrapling_fetcher = await scrapling(cohort);
const result = JSON.stringify({ cohortSize: cohort.length, labelRule: "case-insensitive visible-text match; phone ignores punctuation", summary });
if (process.env.REAL_BENCHMARK_RESULT_PATH) await writeFile(process.env.REAL_BENCHMARK_RESULT_PATH, `${result}\n`, "utf8");
console.log(result);
