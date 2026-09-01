import assert from "node:assert/strict";
import test from "node:test";
import { safeOutboundFetch, safeOutboundUrl } from "../src/lib/security/outbound-url.ts";

test("outbound guard rejects SSRF targets before scraping", async () => {
  for (const value of ["file:///etc/passwd", "https://user@example.org", "http://127.0.0.1", "http://[::1]", "https://localhost"]) await assert.rejects(safeOutboundUrl(value));
  const target = await safeOutboundUrl("https://example.org/services", async () => [{ address: "93.184.216.34", family: 4 }]);
  assert.equal(target.url.hostname, "example.org");
  await assert.rejects(safeOutboundUrl("https://example.org", async () => [{ address: "10.0.0.1", family: 4 }]));
  for (const address of ["198.18.0.1", "fe90::1", "::ffff:127.0.0.1"]) await assert.rejects(safeOutboundUrl("https://example.org", async () => [{ address, family: address.includes(":") ? 6 : 4 }]));
});

test("outbound requests validate redirect targets", async () => {
  await assert.rejects(safeOutboundFetch("https://example.org", {}, async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1" } }), async () => [{ address: "93.184.216.34", family: 4 }]));
});
