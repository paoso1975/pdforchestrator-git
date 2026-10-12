import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function unsafeIp(value: string) {
  if (isIP(value) === 4) {
    const [a, b] = value.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || (a === 203 && b === 0);
  }
  const ip = value.toLowerCase();
  if (ip.startsWith("::ffff:")) return unsafeIp(ip.slice(7));
  return ip === "::" || ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") || /^fe[89ab]/.test(ip) || ip.startsWith("ff") || !/^[23]/.test(ip) || ip.startsWith("2001:db8:") || /^::ffff:(?:0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(ip);
}

export async function validateWebhookUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443" || url.hostname === "localhost" || url.hostname.endsWith(".localhost")) throw new Error("Webhook deve usare HTTPS su host pubblico e porta 443.");
  if (isIP(url.hostname)) throw new Error("Webhook IP letterali non ammessi.");
  let addresses;
  try { addresses = await lookup(url.hostname, { all: true, verbatim: true }); } catch { throw new Error("Webhook host non verificabile."); }
  if (!addresses.length || addresses.some((item) => unsafeIp(item.address))) throw new Error("Host webhook risolve a un indirizzo non pubblico.");
  return url.toString();
}
