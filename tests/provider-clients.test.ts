import assert from "node:assert/strict";
import test from "node:test";
import { formatAuditEvidence, observationsForScoring } from "../src/lib/providers/hosted-evidence.ts";
import { ExaClient, FirecrawlClient, GooglePlacesClient, IrsClient, TavilyClient, TrustedDirectoryClient } from "../src/lib/providers/index.ts";

test("Firecrawl uses a bounded v2 scrape request", async () => {
  let request: Request | undefined;
  const client = new FirecrawlClient({ apiKey: "secret", fetch: async (url, init) => {
    request = new Request(url, init);
    return Response.json({ success: true, data: { markdown: "Hours: Mon-Fri", metadata: { sourceURL: "https://example.org" } } });
  } });

  const capture = await client.scrape("https://example.org");
  assert.equal(capture.state, "success");
  assert.equal(capture.sourceUrl, "https://example.org");
  assert.equal(capture.excerpt, "Hours: Mon-Fri");
  assert.equal(request?.url, "https://api.firecrawl.dev/v2/scrape");
  assert.deepEqual(await request?.json(), { url: "https://example.org/", formats: ["markdown"], onlyMainContent: true, timeout: 15_000, maxAge: 0 });
  assert.equal(request?.headers.get("authorization"), "Bearer secret");
});

test("Firecrawl Interact is allowlisted, bounded, and always cleaned up", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const client = new FirecrawlClient({
    apiKey: "secret",
    interactAllowlist: ["example.org"],
    fetch: async (url, init) => {
      const request = new Request(url, init);
      calls.push({ url: request.url, method: request.method });
      if (request.url.endsWith("/scrape")) return Response.json({ success: true, id: "job-1", data: {} });
      if (request.method === "POST") return Response.json({ data: { markdown: "Rendered hours" } });
      return new Response(null, { status: 204 });
    }
  });

  const capture = await client.scrape("https://example.org/services", { allowInteract: true });
  assert.equal(capture.state, "success");
  assert.equal(capture.excerpt, "Rendered hours");
  assert.deepEqual(calls.map((call) => call.method), ["POST", "POST", "DELETE"]);
  assert.match(calls[1].url, /\/v2\/scrape\/job-1\/interact$/);
});

test("Firecrawl does not interact when an ordinary scrape is blocked without a scrape session", async () => {
  const methods: string[] = [];
  const client = new FirecrawlClient({
    apiKey: "secret",
    interactAllowlist: ["example.org"],
    fetch: async (_url, init) => {
      methods.push(init?.method ?? "GET");
      return Response.json({ success: false, error: "blocked" }, { status: 403 });
    }
  });
  const capture = await client.scrape("https://example.org", { allowInteract: true });
  assert.equal(capture.state, "blocked");
  assert.deepEqual(methods, ["POST"]);
});

test("provider HTTP failures are captured and never become a closure signal", async () => {
  const google = new GooglePlacesClient({ apiKey: "secret", fetch: async () => new Response("busy", { status: 429 }) });
  const tavily = new TavilyClient({ apiKey: "secret", fetch: async () => new Response("blocked", { status: 403 }) });
  const irs = new IrsClient({ endpoint: "https://irs.example/search", fetch: async () => { throw new DOMException("late", "TimeoutError"); } });
  const directory = new TrustedDirectoryClient({ endpoint: "https://directory.example/search", fetch: async () => new Response("not found", { status: 404 }) });

  assert.equal((await google.search("Example CBO")).state, "rate_limited");
  assert.equal((await tavily.search("Example CBO")).state, "blocked");
  assert.equal((await irs.search("Example CBO")).state, "timeout");
  assert.equal((await directory.search("Example CBO")).state, "no_result");
  for (const capture of [await google.search("Example CBO"), await tavily.search("Example CBO"), await irs.search("Example CBO"), await directory.search("Example CBO")]) {
    assert.equal(capture.values?.businessStatus, undefined);
  }
});

test("Google Places and Tavily return bounded, advisory observations", async () => {
  const google = new GooglePlacesClient({ apiKey: "secret", fetch: async () => Response.json({ places: [{ displayName: { text: "Example Pantry" }, formattedAddress: "1 Main St", nationalPhoneNumber: "+1 312-555-0100", websiteUri: "https://example.org", businessStatus: "CLOSED_PERMANENTLY" }] }) });
  const tavily = new TavilyClient({ apiKey: "secret", fetch: async () => Response.json({ results: [{ title: "Example Pantry", url: "https://example.org", content: "A community pantry" }] }) });

  const place = await google.search("Example Pantry");
  const search = await tavily.search("Example Pantry", { maxResults: 99 });
  assert.deepEqual(place.values, { name: "Example Pantry", address: "1 Main St", phone: "+1 312-555-0100", url: "https://example.org", businessStatus: "closed" });
  assert.equal(search.excerpt, "A community pantry");
  assert.equal(search.sourceUrl, "https://example.org");
});

test("Exa returns bounded direct-provider observations without authorizing scrape targets", async () => {
  let request: Request | undefined;
  const exa = new ExaClient({ apiKey: "secret", fetch: async (url, init) => {
    request = new Request(url, init);
    return Response.json({ results: [{ title: "Example Pantry", url: "https://example.org", highlights: ["Food assistance in Chicago"] }] });
  } });
  const result = await exa.search("Example Pantry Chicago", { maxResults: 99 });
  assert.equal(result.provider, "exa");
  assert.equal(result.excerpt, "Food assistance in Chicago");
  assert.equal(request?.headers.get("x-api-key"), "secret");
  assert.deepEqual(await request?.json(), { query: "Example Pantry Chicago", type: "fast", numResults: 5, moderation: true, contents: { highlights: true } });
});

test("discovery methods preserve bounded provider result arrays", async () => {
  const google = new GooglePlacesClient({ apiKey: "secret", fetch: async () => Response.json({ places: [
    { id: "place-a", displayName: { text: "A" }, formattedAddress: "1 Main", addressComponents: [{ longText: "Cook County", types: ["administrative_area_level_2"] }] },
    { id: "place-b", displayName: { text: "B" }, formattedAddress: "2 Main" }
  ] }) });
  const results = await google.discovery("pantry Cook", 2);
  assert.deepEqual(results.map((result) => result.values?.placeId), ["place-a", "place-b"]);
  assert.equal(results[0]?.values?.county, "Cook");
  await assert.rejects(google.discovery("pantry", 6));
});

test("GPT audit input retains bounded structured provider evidence", () => {
  const evidence = formatAuditEvidence([
    { provider: "google_places", state: "success", observedAt: "2026-08-13T00:00:00Z", sourceUrl: "https://example.org", values: { name: "Example Pantry", address: "1 Main St", phone: "+1 312-555-0100", businessStatus: "closed" } },
    { provider: "firecrawl", state: "success", observedAt: "2026-08-13T00:00:00Z", excerpt: "x".repeat(500) }
  ]);
  const parsed = JSON.parse(evidence) as Array<{ values?: { businessStatus?: string; address?: string }; excerpt?: string }>;
  assert.equal(parsed[0]?.values?.businessStatus, "closed");
  assert.equal(parsed[0]?.values?.address, "1 Main St");
  assert.equal(parsed[1]?.excerpt?.length, 300);
  assert.ok(evidence.length <= 6_000);
  assert.doesNotThrow(() => JSON.parse(formatAuditEvidence(Array.from({ length: 6 }, () => ({ provider: "google_places" as const, state: "success" as const, observedAt: "2026-08-13T00:00:00Z", excerpt: "x".repeat(500) })) )));
});

test("a mismatched Google result is not sent to the AI scorer", () => {
  const observations = observationsForScoring({ id: "r1", name: "Salvation Army Head Start", address: "845 W 69th St" }, [
    { provider: "google_places", state: "success", observedAt: "2026-08-13T00:00:00Z", values: { name: "Kennedy King College Child Development Center", address: "710 W 65th St", businessStatus: "open" } },
    { provider: "firecrawl", state: "success", observedAt: "2026-08-13T00:00:00Z", excerpt: "Head Start" }
  ]);
  assert.deepEqual(observations.map(({ provider }) => provider), ["firecrawl"]);
});
