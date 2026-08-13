import assert from "node:assert/strict";
import test from "node:test";
import { firecrawl, googlePlaces, localDirectory } from "../src/lib/retrieval/index.ts";

test("adapters capture supplied evidence without making network requests", () => {
  const observation = firecrawl.capture({ state: "success", observedAt: "2026-08-13T00:00:00Z", sourceUrl: "https://example.org", values: { name: "Example Pantry" } });
  assert.deepEqual(observation.provider, "firecrawl");
  assert.equal(observation.values?.name, "Example Pantry");
  assert.equal(googlePlaces.provider, "google_places");
  assert.equal(localDirectory.provider, "local_directory");
});
