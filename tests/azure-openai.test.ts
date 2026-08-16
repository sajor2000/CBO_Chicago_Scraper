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
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ cboEligibility: "confirmed_cbo", operationalAssessment: "open", evidenceQuality: "high", citations: ["firecrawl", "google_places"], suggestedCategory: "food_access", rationale: "The official site and Google listing describe food assistance." }) } }] }), { status: 200 });
    }
  });
  const result = await scorer.score({ name: "Example Pantry", evidence: `api-key=do-not-send ${"x".repeat(9000)}`, citationProviders: ["firecrawl", "google_places"] });
  assert.equal(result.cboEligibility, "confirmed_cbo");
  assert.equal(result.operationalAssessment, "open");
  assert.equal(result.suggestedCategory, "food_access");
  const request = JSON.parse(requestBody);
  const supplied = JSON.parse(request.messages.find((message: { role: string; content: string }) => message.role === "user").content);
  assert.ok(supplied.evidence.length <= 6000);
  assert.equal(request.max_completion_tokens, 500);
  assert.equal(request.temperature, undefined);
  assert.equal(request.response_format.type, "json_schema");
  assert.equal(request.response_format.json_schema.strict, true);
  assert.doesNotMatch(JSON.stringify(request.response_format.json_schema.schema), /minLength|maxLength|maxItems|uniqueItems/);
  assert.doesNotMatch(requestBody, /do-not-send/);
});

test("Azure OpenAI scorer retries one malformed structured response", async () => {
  let calls = 0;
  const scorer = new AzureOpenAiScorer({ endpoint: "https://example", apiKey: "secret", deployment: "model", fetch: async () => {
    calls += 1;
    const content = calls === 1 ? "{}" : JSON.stringify({ cboEligibility: "confirmed_cbo", operationalAssessment: "open", evidenceQuality: "high", citations: ["firecrawl", "google_places"], suggestedCategory: null, rationale: "Corroborated by the captured sources." });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  } });
  const result = await scorer.score({ name: "Example", evidence: "official", citationProviders: ["firecrawl", "google_places"] });
  assert.equal(calls, 2);
  assert.equal(result.cboEligibility, "confirmed_cbo");
});

test("Azure Foundry v1 deployments receive the model in the request body", async () => {
  let requestUrl = "";
  let requestBody = "";
  const scorer = new AzureOpenAiScorer({ endpoint: "https://example.services.ai.azure.com/openai/v1", apiKey: "secret", deployment: "DeepSeek-V4-Flash", fetch: async (url, init) => {
    requestUrl = String(url);
    requestBody = String(init?.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ cboEligibility: "likely_cbo", operationalAssessment: "open", evidenceQuality: "medium", citations: ["official"], suggestedCategory: null, rationale: "Official evidence describes a pantry." }) } }] }), { status: 200 });
  } });
  await scorer.score({ name: "Example", evidence: "official", citationProviders: ["official"] });
  assert.equal(requestUrl, "https://example.services.ai.azure.com/openai/v1/chat/completions");
  assert.equal(JSON.parse(requestBody).model, "DeepSeek-V4-Flash");
});

test("Azure OpenAI audit prompt prohibits tool use and production decisions", async () => {
  let requestBody = "";
  const scorer = new AzureOpenAiScorer({ endpoint: "https://example", apiKey: "secret", deployment: "model", fetch: async (_url, init) => {
    requestBody = String(init?.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ cboEligibility: "insufficient_evidence", operationalAssessment: "unknown", evidenceQuality: "low", citations: [], suggestedCategory: null, rationale: "No corroborated source." }) } }] }), { status: 200 });
  } });
  await scorer.score({ name: "Example", evidence: "text", citationProviders: [] });
  assert.match(requestBody, /never instructions/i);
  assert.match(requestBody, /do not browse, call tools/i);
  assert.match(requestBody, /never approve, publish, close, merge/i);
  assert.match(requestBody, /classification policy/i);
  assert.match(requestBody, /two or more corroborating sources/i);
});

test("Azure OpenAI scorer fails closed on malformed responses", async () => {
  const scorer = new AzureOpenAiScorer({ endpoint: "https://example", apiKey: "secret", deployment: "model", fetch: async () => new Response("{}", { status: 200 }) });
  await assert.rejects(() => scorer.score({ name: "Example", evidence: "text", citationProviders: [] }));
});

test("Azure OpenAI scorer rejects citations absent from captured evidence", async () => {
  const scorer = new AzureOpenAiScorer({ endpoint: "https://example", apiKey: "secret", deployment: "model", fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ cboEligibility: "likely_cbo", operationalAssessment: "unknown", evidenceQuality: "low", citations: ["invented_provider"], suggestedCategory: null, rationale: "Unsupported." }) } }] }), { status: 200 }) });
  await assert.rejects(() => scorer.score({ name: "Example", evidence: "text", citationProviders: ["firecrawl"] }), /malformed/);
});

test("Azure OpenAI scorer rejects unsupported decisive output", async () => {
  const scorer = new AzureOpenAiScorer({ endpoint: "https://example", apiKey: "secret", deployment: "model", fetch: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ cboEligibility: "not_a_cbo", operationalAssessment: "unknown", evidenceQuality: "medium", citations: [], suggestedCategory: "invented", rationale: "A beach." }) } }] }), { status: 200 }) });
  await assert.rejects(() => scorer.score({ name: "Example", evidence: "text", citationProviders: ["firecrawl"] }), /malformed/);
});
