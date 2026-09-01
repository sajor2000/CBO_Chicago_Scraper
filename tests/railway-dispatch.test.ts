import assert from "node:assert/strict";
import test from "node:test";
import { cronUrl, dispatchOnce } from "../scripts/railway-dispatch.mjs";

test("Railway dispatcher accepts only the secured production cron endpoint", () => {
  assert.equal(cronUrl({ CBO_CRON_URL: "https://review.example.org/api/cron" }).toString(), "https://review.example.org/api/cron");
  assert.throws(() => cronUrl({ CBO_CRON_URL: "http://review.example.org/api/cron" }), /HTTPS/);
  assert.throws(() => cronUrl({ CBO_CRON_URL: "https://review.example.org/api/runs" }), /\/api\/cron/);
  assert.throws(() => cronUrl({ CBO_CRON_URL: "https://secret@example.org/api/cron" }), /embedded credentials/);
});

test("Railway dispatcher sends the cron secret without exposing it in its result", async () => {
  let request: Request | undefined;
  const result = await dispatchOnce(
    { CBO_CRON_URL: "https://review.example.org/api/cron", CRON_SECRET: "not-for-logs" },
    async (input, init) => {
      request = new Request(input, init);
      return Response.json({ runId: "run-123", skipped: false });
    }
  );
  assert.equal(request?.headers.get("authorization"), "Bearer not-for-logs");
  assert.deepEqual(result, { dispatched: true, status: 200, runId: "run-123", skipped: false });
  assert.doesNotMatch(JSON.stringify(result), /not-for-logs/);
});

test("Railway dispatcher fails closed on an unsuccessful cron response", async () => {
  await assert.rejects(
    dispatchOnce({ CBO_CRON_URL: "https://review.example.org/api/cron", CRON_SECRET: "secret" }, async () => new Response("do not expose", { status: 503 })),
    /Cron request failed \(503\)/
  );
});
