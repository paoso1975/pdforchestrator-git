import { createHash, createHmac, randomBytes } from "node:crypto";

export function pfoHeaders(keyId: string, secret: string, method: string, url: URL, body: Uint8Array = new Uint8Array()) {
  const pairs = [...url.searchParams.entries()].sort(([ak, av], [bk, bv]) => ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0);
  const enc = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  const query = pairs.map(([key, value]) => `${enc(key)}=${enc(value)}`).join("&");
  const timestamp = Math.floor(Date.now() / 1000).toString(); const nonce = randomBytes(18).toString("base64url");
  const digest = createHash("sha256").update(body).digest("hex");
  const canonical = [method.toUpperCase(), url.pathname, query, timestamp, nonce, digest].join("\n");
  const signature = createHmac("sha256", secret).update(canonical).digest("hex");
  return { "X-PFO-Key": keyId, "X-PFO-Timestamp": timestamp, "X-PFO-Nonce": nonce, "X-PFO-Content-SHA256": digest, "X-PFO-Signature": signature };
}
