import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import { type BenchmarkManifest } from "../src/lib/retrieval/benchmark-contract.ts";
import { crawleeBenchmarkOptions, assertCrawleeBenchmarkOptions } from "../src/lib/retrieval/benchmark-runners/crawlee-playwright.ts";
import { runCrawleePlaywright } from "../src/lib/retrieval/benchmark-runners/crawlee-playwright.ts";
import { runNativeHttp } from "../src/lib/retrieval/benchmark-runners/native-http.ts";
import { runPlaywright } from "../src/lib/retrieval/benchmark-runners/playwright.ts";

const staticPage = '<main data-benchmark-name="Example Pantry" data-benchmark-address="1 Main St" data-benchmark-phone="312-555-0100"></main>';
const dynamicPage = '<main id="service"></main><script>document.querySelector("#service").setAttribute("data-benchmark-name", "Rendered Pantry");</script>';

async function fixtureServer() {
  const server = createServer((request, response) => {
    if (request.url === "/static") return void response.writeHead(200, { "content-type": "text/html" }).end(staticPage);
    if (request.url === "/dynamic") return void response.writeHead(200, { "content-type": "text/html" }).end(dynamicPage);
    if (request.url === "/redirect-private") return void response.writeHead(302, { location: "http://unapproved.test/private" }).end();
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

test("native and browser runners compare the same local-only fixtures", { skip: !existsSync(chromium.executablePath()) }, async () => {
  const server = await fixtureServer();
  try {
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const manifest: BenchmarkManifest = { version: "v1", fixtureOrigin: origin, targets: [
      { id: "static", url: `${origin}/static`, requestCeiling: 1, expected: { terminal: "success", values: { name: "Example Pantry", address: "1 Main St" } } },
      { id: "dynamic", url: `${origin}/dynamic`, requestCeiling: 1, expected: { terminal: "success", values: { name: "Rendered Pantry" } } },
      { id: "redirect-private", url: `${origin}/redirect-private`, requestCeiling: 2, expected: { terminal: "redirect_denied" } }
    ] };
    const [staticTarget, dynamicTarget, redirectTarget] = manifest.targets;
    const nativeStatic = await runNativeHttp(staticTarget!, origin);
    const nativeDynamic = await runNativeHttp(dynamicTarget!, origin);
    const browserDynamic = await runPlaywright(dynamicTarget!, origin);
    const crawleeDynamic = await runCrawleePlaywright(dynamicTarget!);
    const nativeRedirect = await runNativeHttp(redirectTarget!, origin);
    assert.equal(nativeStatic.values?.name, "Example Pantry");
    assert.equal(nativeDynamic.terminal, "no_result");
    assert.equal(browserDynamic.terminal, "success", JSON.stringify(browserDynamic));
    assert.equal(browserDynamic.values?.name, "Rendered Pantry");
    assert.equal(crawleeDynamic.terminal, "success", JSON.stringify(crawleeDynamic));
    assert.equal(crawleeDynamic.values?.name, "Rendered Pantry");
    assert.equal(crawleeDynamic.requestCount, 1);
    assert.equal(nativeRedirect.terminal, "redirect_denied");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("Crawlee policy configuration rejects unsafe defaults", () => {
  const options = crawleeBenchmarkOptions();
  assertCrawleeBenchmarkOptions(options);
  assert.throws(() => assertCrawleeBenchmarkOptions({ ...options, maxConcurrency: 2 } as unknown as typeof options), /policy boundary/);
});
