import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/secret-vault";
import { signRequest } from "@/lib/hmac";
import { positiveIntegerConfig } from "@/lib/public-api-security";

export type PublicCredential = { id: string; organizationId: string; keyId: string };
export type AuthResult = { credential: PublicCredential } | { status: number; error: string };

export async function authenticatePublicRequest(request: Request, body: Uint8Array): Promise<AuthResult> {
  const keyId = request.headers.get("x-pfo-key") ?? "";
  const timestamp = request.headers.get("x-pfo-timestamp") ?? "";
  const nonce = request.headers.get("x-pfo-nonce") ?? "";
  const bodyHash = request.headers.get("x-pfo-content-sha256") ?? "";
  const signature = request.headers.get("x-pfo-signature") ?? "";
  if (!/^pfo_live_[A-Za-z0-9_-]{16,64}$/.test(keyId) || !/^\d{10}$/.test(timestamp) || !/^[A-Za-z0-9_-]{16,128}$/.test(nonce) || !/^[a-f\d]{64}$/i.test(bodyHash) || !/^[a-f\d]{64}$/i.test(signature)) return { status: 401, error: "Credenziali HMAC non valide." };
  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isSafeInteger(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60_000) return { status: 401, error: "Timestamp fuori dalla finestra consentita." };
  const actualHash = createHash("sha256").update(body).digest("hex");
  if (!timingSafeEqual(Buffer.from(bodyHash.toLowerCase(), "hex"), Buffer.from(actualHash, "hex"))) return { status: 401, error: "Hash del body non valido." };
  const row = await prisma.apiCredential.findFirst({ where: { keyId }, select: { id: true, organizationId: true, keyId: true, secretCiphertext: true, secretIv: true, secretAuthTag: true, revokedAt: true, expiresAt: true } });
  if (!row || row.revokedAt || (row.expiresAt && row.expiresAt <= new Date()) || !row.secretCiphertext || !row.secretIv || !row.secretAuthTag) return { status: 401, error: "Credenziale non valida, scaduta o revocata." };
  const secret = decryptSecret({ ciphertext: row.secretCiphertext, iv: row.secretIv, authTag: row.secretAuthTag });
  const url = new URL(request.url);
  const expected = signRequest(secret, request.method, url.pathname, url.search, timestamp, nonce, actualHash);
  const expectedBytes = Buffer.from(expected, "hex");
  const suppliedBytes = Buffer.from(signature, "hex");
  if (expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes)) return { status: 401, error: "Firma HMAC non valida." };
  try {
    await prisma.$transaction(async (tx) => {
      await tx.apiRequestNonce.deleteMany({ where: { expiresAt: { lt: new Date() } } });
      await tx.apiRequestNonce.create({ data: { credentialId: row.id, nonce, expiresAt: new Date(timestampMs + 10 * 60_000) } });
      await tx.apiCredential.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { status: 409, error: "Nonce già utilizzato." };
    throw error;
  }
  return { credential: { id: row.id, organizationId: row.organizationId, keyId: row.keyId! } };
}

export async function consumeRequestLimit(credentialId: string, isJob = false) {
  const limit = positiveIntegerConfig(process.env.PFO_RATE_LIMIT_RPM, 120);
  const jobLimit = positiveIntegerConfig(process.env.PFO_JOB_LIMIT_RPM, 30);
  const now = new Date();
  const windowStart = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  await prisma.apiRateBucket.deleteMany({ where: { credentialId, windowStart: { lt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) } } });
  const result = await prisma.$queryRaw<Array<{ requestCount: number }>>(Prisma.sql`
    INSERT INTO "ApiRateBucket" ("id", "credentialId", "windowStart", "requestCount", "jobCount")
    VALUES (gen_random_uuid(), ${credentialId}::uuid, ${windowStart}, 1, ${isJob ? 1 : 0})
    ON CONFLICT ("credentialId", "windowStart") DO UPDATE SET
      "requestCount" = "ApiRateBucket"."requestCount" + 1,
      "jobCount" = "ApiRateBucket"."jobCount" + ${isJob ? 1 : 0}
    WHERE "ApiRateBucket"."requestCount" < ${limit}
      AND (${!isJob} OR "ApiRateBucket"."jobCount" < ${jobLimit})
    RETURNING "requestCount"
  `);
  return result.length > 0;
}

export function generateNonce() { return randomBytes(18).toString("base64url"); }
