import { isIP } from "node:net";
import { resolve } from "node:dns/promises";

type Lookup = (hostname: string) => Promise<string[]>;
const defaultLookup: Lookup = async (hostname) => (await resolve(hostname)).map(String);

export class UnsafeOutboundUrlError extends Error {
  constructor(message = "Unsafe outbound destination.") { super(message); this.name = "UnsafeOutboundUrlError"; }
}

const ipv4Number=(value:string)=>{const parts=value.split('.').map(Number);if(parts.length!==4||parts.some((part)=>!Number.isInteger(part)||part<0||part>255))return undefined;return parts.reduce((total,part)=>total*256+part,0)>>>0;};
const v4Cidr=(value:number,base:string,bits:number)=>{const start=ipv4Number(base)!;const mask=bits===0?0:(0xffffffff<<(32-bits))>>>0;return (value&mask)===(start&mask);};
const unsafeV4=(value:string)=>{const number=ipv4Number(value);if(number===undefined)return false;return [["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],["169.254.0.0",16],["172.16.0.0",12],["192.0.0.0",24],["192.0.2.0",24],["192.168.0.0",16],["198.18.0.0",15],["198.51.100.0",24],["203.0.113.0",24],["224.0.0.0",4],["240.0.0.0",4]] .some(([base,bits])=>v4Cidr(number,base as string,bits as number));};
const ipv6Number=(value:string)=>{
  let normalized=value.toLowerCase();
  const dotted=normalized.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if(dotted){const number=ipv4Number(dotted);if(number===undefined)return undefined;normalized=normalized.slice(0,-dotted.length)+`${(number>>>16).toString(16)}:${(number&0xffff).toString(16)}`;}
  const halves=normalized.split('::');if(halves.length>2)return undefined;
  const left=halves[0]?halves[0].split(':'):[];const right=halves[1]?halves[1].split(':'):[];
  const fill=8-left.length-right.length;if((halves.length===1&&fill!==0)||fill<0)return undefined;
  const parts=[...left,...Array(fill).fill('0'),...right];if(parts.length!==8||parts.some((part)=>!/^[a-f0-9]{1,4}$/.test(part)))return undefined;
  return parts.reduce((total,part)=>(total<<16n)+BigInt(`0x${part}`),0n);
};
const v6Cidr=(value:bigint,base:string,bits:number)=>{const start=ipv6Number(base)!;const shift=128n-BigInt(bits);return (value>>shift)===(start>>shift);};

function unsafeIp(ip: string): boolean {
  const value=ip.toLowerCase();
  if(isIP(value)===4)return unsafeV4(value);
  const number=ipv6Number(value);if(number===undefined)return true;
  if(v6Cidr(number,"::ffff:0:0",96)){const mapped=Number(number&0xffffffffn);return unsafeV4(`${mapped>>>24}.${(mapped>>>16)&255}.${(mapped>>>8)&255}.${mapped&255}`);}
  return [["::",128],["::1",128],["64:ff9b:1::",48],["100::",64],["2001::",32],["2001:2::",48],["2001:10::",28],["2001:20::",28],["2001:db8::",32],["fc00::",7],["fe80::",10],["ff00::",8]].some(([base,bits])=>v6Cidr(number,base as string,bits as number));
}

export async function assertSafeOutboundUrl(value: string, lookup: Lookup = defaultLookup): Promise<URL> {
  let url: URL;
  try { url = new URL(value); } catch { throw new UnsafeOutboundUrlError("A public HTTP(S) URL is required."); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new UnsafeOutboundUrlError("A public HTTP(S) URL without userinfo is required.");
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (hostname.includes('%') || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) throw new UnsafeOutboundUrlError("Unsafe outbound hostname.");
  let addresses: string[];
  try { addresses = isIP(hostname) ? [hostname] : await lookup(hostname); }
  catch { throw new UnsafeOutboundUrlError(); }
  if (!addresses.length || addresses.some(unsafeIp)) throw new UnsafeOutboundUrlError();
  return url;
}
