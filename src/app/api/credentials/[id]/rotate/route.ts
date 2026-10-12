import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUserId } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/secret-vault";
import { credentialApiError } from "@/lib/credential-errors";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function POST(_request: Request, context: Context) {
  try {
    const userId = await getAuthenticatedUserId(); if (!userId) return NextResponse.json({ error: "Autenticazione richiesta." }, { status: 401 });
    const id = z.string().uuid().parse((await context.params).id);
    const source = await prisma.apiCredential.findFirst({
      where: { id, revokedAt: null, organization: { memberships: { some: { userId, role: { in: ["OWNER", "ADMIN"] } } } } },
      include: { grants: { where: { batch: { status: "PUBLISHED", activeVersionId: { not: null } } } } },
    });
    if (!source) return NextResponse.json({ error: "Credenziale non trovata." }, { status: 404 });
    const keyId = `pfo_live_${randomBytes(18).toString("base64url")}`; const secret = randomBytes(32).toString("base64url"); const encrypted = encryptSecret(secret);
    const result = await prisma.$transaction(async (tx) => {
      const revoked = await tx.apiCredential.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
      if (!revoked.count) throw new Error("CREDENTIAL_ALREADY_REVOKED");
      const created = await tx.apiCredential.create({ data: { organizationId: source.organizationId, name: source.name, tokenHash: createHash("sha256").update(secret).digest("hex"), tokenPrefix: keyId, keyId, secretCiphertext: encrypted.ciphertext, secretIv: encrypted.iv, secretAuthTag: encrypted.authTag, secretKeyVersion: encrypted.keyVersion, expiresAt: source.expiresAt, grants: { create: source.grants.map((grant) => ({ batchId: grant.batchId, batchVersionIds: grant.batchVersionIds })) } }, select: { id: true, name: true, keyId: true, expiresAt: true, createdAt: true } });
      await tx.auditEvent.create({ data: { organizationId: source.organizationId, actorId: userId, action: "api_credential.rotated", resourceType: "ApiCredential", resourceId: created.id, metadata: { replacedCredentialId: id, scopes: source.grants.length } } });
      return created;
    });
    return NextResponse.json({ credential: result, secret }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "CREDENTIAL_ALREADY_REVOKED") return NextResponse.json({ error: "Credenziale non trovata o già revocata." }, { status: 409 });
    return credentialApiError(error);
  }
}
