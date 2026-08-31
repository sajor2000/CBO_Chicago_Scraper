import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";

const privateV4 = (value: string) => /^(10\.|127\.|0\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|100\.(6[4-9]|[789]\d|1[01]\d|12[0-7])\.)/.test(value);
const privateV6 = (value: string) => value === "::1" || /^(fc|fd|fe80:)/i.test(value);

export async function safeOutboundUrl(value: string, resolve: (hostname: string) => Promise<LookupAddress[]> = (hostname) => lookup(hostname, { all: true })): Promise<URL> {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || !url.hostname || url.hostname.toLowerCase() === "localhost") throw new Error("Outbound URL is not an allowed public HTTP(S) target.");
  const literal = isIP(url.hostname);
  if (literal && (literal === 4 ? privateV4(url.hostname) : privateV6(url.hostname))) throw new Error("Outbound URL resolves to private or reserved space.");
  const addresses = literal ? [{ address: url.hostname, family: literal as 4 | 6 }] : await resolve(url.hostname);
  if (!addresses.length || addresses.some(({ address, family }) => family === 4 ? privateV4(address) : privateV6(address))) throw new Error("Outbound URL resolves to private or reserved space.");
  return url;
}
