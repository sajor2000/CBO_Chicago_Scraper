import assert from "node:assert/strict";
import test from "node:test";
import { safeOutboundUrl } from "../src/lib/security/outbound-url.ts";

test("outbound guard rejects SSRF targets before scraping", async () => {
  for (const value of ["file:///etc/passwd", "https://user@example.org", "http://127.0.0.1", "http://[::1]", "https://localhost"]) await assert.rejects(safeOutboundUrl(value));
  const url = await safeOutboundUrl("https://example.org/services", async () => [{ address: "93.184.216.34", family: 4 }]);
  assert.equal(url.hostname, "example.org");
  await assert.rejects(safeOutboundUrl("https://example.org", async () => [{ address: "10.0.0.1", family: 4 }]));
});
