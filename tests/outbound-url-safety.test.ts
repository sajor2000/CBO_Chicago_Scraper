import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeOutboundUrl } from "../src/lib/security/outbound-url.ts";

test("outbound URL guard accepts public HTTP(S) and blocks credential/local/private targets", async () => {
  const publicLookup = async () => ["93.184.216.34"];
  assert.equal((await assertSafeOutboundUrl("https://example.org/services", publicLookup)).hostname, "example.org");
  for (const target of ["ftp://example.org", "https://user:pass@example.org", "http://localhost/x", "http://127.0.0.1", "http://[::1]", "http://[fc00::1]", "http://[fe80::1]", "http://[2001:db8::1]", "http://[::ffff:10.0.0.1]", "http://10.0.0.2", "http://169.254.169.254", "http://192.0.2.1", "http://203.0.113.1"]) {
    await assert.rejects(() => assertSafeOutboundUrl(target, publicLookup), /unsafe|public HTTP/i);
  }
  await assert.rejects(() => assertSafeOutboundUrl("https://example.org", async () => ["192.168.1.2"]), /unsafe/i);
});

test("DNS lookup failures fail closed as unsafe destinations", async () => {
  await assert.rejects(() => assertSafeOutboundUrl("https://missing.example", async () => { throw new Error("dns unavailable"); }), /Unsafe outbound destination/);
});
