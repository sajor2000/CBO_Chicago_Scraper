import assert from "node:assert/strict";
import test from "node:test";
import { AzureOpenAiScorer } from "../src/lib/ai/azure-openai.ts";

test("Azure OpenAI scorer sends bounded evidence and accepts only structured advisory data", async () => {
  let requestBody = "";
  const scorer = new AzureOpenAiScorer({
    endpoint: "https://example.openai.azure.com",
    apiKey: "secret",
    deployment: "small-model",
    fetch: async (_url, init) => {
      requestBody = String(init?.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ geography: 90, organizationType: 80, serviceFit: 75, identity: 88, operationalEvidence: 70, suggestedCategory: "food_pantry", rationale: "official site offers groceries" }) } }] }), { status: 200 });
    }
  });
  const result = await scorer.score({ name: "Example Pantry", evidence: "x".repeat(9000) });
  assert.equal(result.identity, 88);
  assert.equal(result.suggestedCategory, "food_pantry");
  assert.ok(requestBody.length < 7000);
});

test("Azure OpenAI scorer fails closed on malformed responses", async () => {
  const scorer = new AzureOpenAiScorer({ endpoint: "https://example", apiKey: "secret", deployment: "model", fetch: async () => new Response("{}", { status: 200 }) });
  await assert.rejects(() => scorer.score({ name: "Example", evidence: "text" }));
});
