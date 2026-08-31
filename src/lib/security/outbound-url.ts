import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";

type Resolver = (hostname: string) => Promise<LookupAddress[]>;
const resolvePublic: Resolver = (hostname) => lookup(hostname, { all: true });
const publicV4 = (value: string) => {
  const [a, b] = value.split(".").map(Number);
  return !(!Number.isInteger(a) || !Number.isInteger(b) || a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168)) || (a === 198 && (b === 18 || b === 19)) || /^(192\.0\.(2|0)|198\.51\.100|203\.0\.113)\./.test(value));
};
const publicV6 = (value: string) => {
  const lower = value.toLowerCase();
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? publicV4(mapped[1]!) : !(/^(::|::1|fc|fd|fe[89ab]|ff)/.test(lower) || /^2001:(db8|2):/.test(lower));
};

/** Resolves only globally routable HTTP(S) targets and returns the bound addresses. */
export async function safeOutboundUrl(value: string, resolve: Resolver = resolvePublic): Promise<{ url: URL; addresses: LookupAddress[] }> {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || !url.hostname || url.hostname.toLowerCase() === "localhost") throw new Error("Outbound URL is not an allowed public HTTP(S) target.");
  const literal = isIP(url.hostname);
  const addresses = literal ? [{ address: url.hostname, family: literal as 4 | 6 }] : await resolve(url.hostname);
  if (!addresses.length || addresses.some(({ address, family }) => family === 4 ? !publicV4(address) : !publicV6(address))) throw new Error("Outbound URL resolves to private or reserved space.");
  return { url, addresses };
}

/** Uses manual redirects so every redirect target receives the same validation. */
export async function safeOutboundFetch(value: string, init: RequestInit = {}, fetcher: typeof fetch = fetch, resolve: Resolver = resolvePublic): Promise<Response> {
  let target = await safeOutboundUrl(value, resolve);
  for (let redirects = 0; redirects < 5; redirects += 1) {
    const response = await fetcher(target.url, { ...init, redirect: "manual" });
    const location = response.headers.get("location");
    if (!location || response.status < 300 || response.status >= 400) return response;
    target = await safeOutboundUrl(new URL(location, target.url).toString(), resolve);
  }
  throw new Error("Outbound request exceeded redirect limit.");
}
