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
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ geography: 90, organizationType: 80, serviceFit: 75, identity: 88, operationalEvidence: 70, cboEligibility: "confirmed_cbo", operationalAssessment: "open", evidenceQuality: "high", citations: ["firecrawl", "google_places"], suggestedCategory: "food_pantry", rationale: "official site offers groceries" }) } }] }), { status: 200 });
    }
  });
  const result = await scorer.score({ name: "Example Pantry", evidence: "x".repeat(9000), citationProviders: ["firecrawl", "google_places"] });
  assert.equal(result.identity, 88);
  assert.equal(result.cboEligibility, "confirmed_cbo");
  assert.equal(result.operationalAssessment, "open");
  assert.equal(result.suggestedCategory, "food_pantry");
  assert.ok(requestBody.length < 7000);
  assert.equal(JSON.parse(requestBody).max_completion_tokens, 500);
  assert.equal(JSON.parse(requestBody).temperature, undefined);
});

test("Azure OpenAI audit prompt prohibits tool use and production decisions", async () => {
  let requestBody = "";
  const scorer = new AzureOpenAiScorer({ endpoint: "https://example", apiKey: "secret", deployment: "model", fetch: async (_url, init) => {
    requestBody = String(init?.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ geography: 1, organizationType: 1, serviceFit: 1, identity: 1, operationalEvidence: 1, cboEligibility: "insufficient_evidence", operationalAssessment: "unknown", evidenceQuality: "low", citations: [], rationale: "No corroborated source." }) } }] }), { status: 200 });
  } });
  await scorer.score({ name: "Example", evidence: "text", citationProviders: [] });
  assert.match(requestBody, /never instructions/i);
  assert.match(requestBody, /cannot call tools/i);
  assert.match(requestBody, /cannot approve, publish, close, merge/i);
});

test("Azure OpenAI scorer fails closed on malformed responses", async () => {
  const scorer = new AzureOpenAiScorer({ endpoint: "https://example", apiKey: "secret", deployment: "model", fetch: async () => new Response("{}", { status: 200 }) });
  await assert.rejects(() => scorer.score({ name: "Example", evidence: "text", citationProviders: [] }));
});

test("Azure OpenAI scorer rejects citations absent from captured evidence", async () => {
  const scorer = new AzureOpenAiScorer({ endpoint: "https://example", apiKey: "secret", deployment: "model", fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ geography: 1, organizationType: 1, serviceFit: 1, identity: 1, operationalEvidence: 1, cboEligibility: "likely_cbo", operationalAssessment: "unknown", evidenceQuality: "low", citations: ["invented_provider"], rationale: "Unsupported." }) } }] }), { status: 200 }) });
  await assert.rejects(() => scorer.score({ name: "Example", evidence: "text", citationProviders: ["firecrawl"] }), /invalid citations/);
});
