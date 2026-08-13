import assert from "node:assert/strict";
import test from "node:test";
import { executeRunCheckpoints } from "../src/lib/verification/run-checkpoint.ts";

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("a corroborated live checkpoint stages one candidate", async () => {
  const old = { FIRECRAWL_API_KEY: process.env.FIRECRAWL_API_KEY, GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY, AZURE_OPENAI_ENDPOINT: process.env.AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY: process.env.AZURE_OPENAI_API_KEY, AZURE_OPENAI_MODEL: process.env.AZURE_OPENAI_MODEL };
  Object.assign(process.env, { FIRECRAWL_API_KEY: "test", GOOGLE_MAPS_API_KEY: "test", AZURE_OPENAI_ENDPOINT: "https://azure.test/responses", AZURE_OPENAI_API_KEY: "test", AZURE_OPENAI_MODEL: "gpt-5.6-sol" });
  const completed: unknown[] = []; const staged: unknown[] = [];
  const fetchMock = async (url: string | URL) => {
    const value = String(url);
    if (value.includes("firecrawl")) return response({ data: { markdown: "Address: 2 New St Chicago IL" } });
    if (value.includes("searchText")) return response({ places: [{ id: "place-id" }] });
    if (value.includes("places/place-id")) return response({ displayName: { text: "Community Pantry" }, formattedAddress: "2 New St Chicago IL", businessStatus: "OPERATIONAL" });
    return response({ output_text: '{"officialValues":{"name":"Community Pantry","address":"2 New St Chicago IL"},"rationale":"address published"}' });
  };
  try {
    await executeRunCheckpoints({ runId: "run", limit: 1, request: fetchMock as typeof fetch,
      runs: { claimNext: async () => ({ resourceId: "resource", checkpoint: 0, leaseToken: "lease" }), completeCheckpoint: async (_id, _lease, value) => { completed.push(value); } },
      reviews: { getMirrorResource: async () => ({ id: "resource", name: "Community Pantry", address: "1 Old St", url: "https://pantry.example" }), recordObservations: async () => undefined, stageVerification: async (value) => { staged.push(value); } }
    });
    assert.equal(staged.length, 1); assert.deepEqual(completed, [{ candidatesStaged: 1 }]);
  } finally { Object.assign(process.env, old); }
});

test("a provider rate limit completes a checkpoint without staging a candidate", async () => {
  const old = { FIRECRAWL_API_KEY: process.env.FIRECRAWL_API_KEY, GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY };
  Object.assign(process.env, { FIRECRAWL_API_KEY: "test", GOOGLE_MAPS_API_KEY: "test" });
  const completed: unknown[] = []; let staged = 0;
  try {
    await executeRunCheckpoints({ runId: "run", limit: 1, request: (async (url: string | URL) => String(url).includes("firecrawl") ? response({}, 429) : response({ places: [] })) as typeof fetch,
      runs: { claimNext: async () => ({ resourceId: "resource", checkpoint: 0, leaseToken: "lease" }), completeCheckpoint: async (_id, _lease, value) => { completed.push(value); } },
      reviews: { getMirrorResource: async () => ({ id: "resource", name: "Community Pantry", url: "https://pantry.example" }), recordObservations: async () => undefined, stageVerification: async () => { staged += 1; } }
    });
    assert.equal(staged, 0); assert.deepEqual(completed, [{ unableToVerify: 1, providerFailures: 1 }]);
  } finally { Object.assign(process.env, old); }
});
