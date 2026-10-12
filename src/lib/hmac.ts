import { createHmac } from "node:crypto";

function encode(value: string) { return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`); }
export function canonicalQuery(search: string) {
  const entries = [...new URLSearchParams(search).entries()];
  entries.sort(([ak, av], [bk, bv]) => ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0);
  return entries.map(([k, v]) => `${encode(k)}=${encode(v)}`).join("&");
}
export function canonicalRequest(method: string, pathname: string, search: string, timestamp: string, nonce: string, bodyHash: string) {
  return [method.toUpperCase(), pathname, canonicalQuery(search), timestamp, nonce, bodyHash.toLowerCase()].join("\n");
}
export function signRequest(secret: string, method: string, pathname: string, search: string, timestamp: string, nonce: string, bodyHash: string) {
  return createHmac("sha256", secret).update(canonicalRequest(method, pathname, search, timestamp, nonce, bodyHash), "utf8").digest("hex");
}
