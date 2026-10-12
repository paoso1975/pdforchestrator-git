import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const KEY_VERSION = 1;
function masterKey() {
  const raw = process.env.PFO_CREDENTIAL_MASTER_KEY;
  if (!raw) throw new Error("PFO_CREDENTIAL_MASTER_KEY non configurata.");
  const key = /^[a-f\d]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("PFO_CREDENTIAL_MASTER_KEY deve contenere 32 byte in base64 o 64 caratteri hex.");
  return key;
}

export function encryptSecret(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64"), keyVersion: KEY_VERSION };
}

export function decryptSecret(value: { ciphertext: string; iv: string; authTag: string }) {
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(value.iv, "base64"));
  decipher.setAuthTag(Buffer.from(value.authTag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "base64")), decipher.final()]).toString("utf8");
}
