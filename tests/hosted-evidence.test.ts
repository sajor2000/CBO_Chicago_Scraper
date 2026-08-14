import assert from "node:assert/strict";
import test from "node:test";
import { collectHostedEvidence } from "../src/lib/providers/hosted-evidence.ts";

test("hosted collection never scrapes a search-discovered URL", async () => {
  let scraped: string | undefined;
  const evidence = await collectHostedEvidence({
    resource: { id: "r1", name: "Example", address: "Chicago" },
    firecrawl: { scrape: async (url: string) => { scraped = url; return { provider: "firecrawl", state: "success", observedAt: "2026-08-13T00:00:00Z" }; } },
    google: { search: async () => ({ provider: "google_places", state: "success", observedAt: "2026-08-13T00:00:00Z" }) },
    search: { search: async () => ({ provider: "search_fallback", state: "success", observedAt: "2026-08-13T00:00:00Z", values: { url: "https://untrusted.example" } }) }
  });
  assert.equal(scraped, undefined);
  assert.equal(evidence.length, 3);
});
