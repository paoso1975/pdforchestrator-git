import { randomBytes, createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUserId } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/secret-vault";
import { credentialApiError } from "@/lib/credential-errors";

export const runtime = "nodejs";
const createSchema = z.object({ organizationId: z.string().uuid(), name: z.string().trim().min(1).max(100), batchIds: z.array(z.string().uuid()).min(1).max(100), versionScopes: z.record(z.string().uuid(), z.array(z.string().uuid()).max(500)).optional(), expiresAt: z.string().datetime().optional() }).strict().superRefine((value, context) => {
  if (value.expiresAt && Date.parse(value.expiresAt) <= Date.now()) context.addIssue({ code: "custom", path: ["expiresAt"], message: "La scadenza deve essere futura." });
  if (new Set(value.batchIds).size !== value.batchIds.length) context.addIssue({ code: "custom", path: ["batchIds"], message: "I batch non possono essere duplicati." });
  for (const [batchId, versionIds] of Object.entries(value.versionScopes ?? {})) {
    if (!value.batchIds.includes(batchId)) context.addIssue({ code: "custom", path: ["versionScopes", batchId], message: "Lo scope versione richiede che il batch sia autorizzato." });
    if (new Set(versionIds).size !== versionIds.length) context.addIssue({ code: "custom", path: ["versionScopes", batchId], message: "Gli ID versione non possono essere duplicati." });
  }
});

export async function GET() {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) return NextResponse.json({ error: "Autenticazione richiesta." }, { status: 401 });
    const rows = await prisma.apiCredential.findMany({ where: { organization: { memberships: { some: { userId, role: { in: ["OWNER", "ADMIN"] } } } } }, select: { id: true, organizationId: true, name: true, keyId: true, tokenPrefix: true, lastUsedAt: true, expiresAt: true, revokedAt: true, createdAt: true, grants: { include: { batch: { select: { id: true, name: true } } } }, _count: { select: { executions: true } } }, orderBy: { createdAt: "desc" } });
    return NextResponse.json(rows.map(({ grants, _count, ...item }) => ({ ...item, batchGrants: grants.map((grant) => ({ batch: grant.batch, versionIds: grant.batchVersionIds })), executions: _count.executions })));
  } catch (error) { return credentialApiError(error); }
}

export async function POST(request: Request) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) return NextResponse.json({ error: "Autenticazione richiesta." }, { status: 401 });
    const input = createSchema.parse(await request.json());
    const membership = await prisma.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId: input.organizationId, userId } } });
    if (!membership || !["OWNER", "ADMIN"].includes(membership.role)) return NextResponse.json({ error: "Accesso non consentito." }, { status: 403 });
    const batches = await prisma.batch.findMany({ where: { id: { in: input.batchIds }, organizationId: input.organizationId, status: "PUBLISHED", activeVersionId: { not: null } }, select: { id: true } });
    if (batches.length !== new Set(input.batchIds).size) return NextResponse.json({ error: "Un batch non appartiene all'organizzazione selezionata." }, { status: 400 });
    const requestedVersionIds = Object.values(input.versionScopes ?? {}).flat();
    const versions = requestedVersionIds.length ? await prisma.batchVersion.findMany({ where: { id: { in: requestedVersionIds }, batchId: { in: input.batchIds }, publishedAt: { not: null }, batch: { organizationId: input.organizationId } }, select: { id: true, batchId: true } }) : [];
    const versionBatch = new Map(versions.map((version) => [version.id, version.batchId]));
    if (versions.length !== new Set(requestedVersionIds).size || Object.entries(input.versionScopes ?? {}).some(([batchId, ids]) => ids.some((versionId) => versionBatch.get(versionId) !== batchId))) return NextResponse.json({ error: "Una versione selezionata non è pubblicata o non appartiene al batch autorizzato." }, { status: 400 });
    const keyId = `pfo_live_${randomBytes(18).toString("base64url")}`;
    const secret = randomBytes(32).toString("base64url");
    const encrypted = encryptSecret(secret);
    const credential = await prisma.$transaction(async (tx) => {
      const created = await tx.apiCredential.create({ data: {
        organizationId: input.organizationId, name: input.name, tokenHash: createHash("sha256").update(secret).digest("hex"), tokenPrefix: keyId, keyId,
        secretCiphertext: encrypted.ciphertext, secretIv: encrypted.iv, secretAuthTag: encrypted.authTag, secretKeyVersion: encrypted.keyVersion,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        grants: { create: input.batchIds.map((batchId) => ({ batchId, batchVersionIds: input.versionScopes?.[batchId] ?? [] })) },
      }, select: { id: true, organizationId: true, name: true, keyId: true, expiresAt: true, createdAt: true } });
      await tx.auditEvent.create({ data: { organizationId: input.organizationId, actorId: userId, action: "api_credential.created", resourceType: "ApiCredential", resourceId: created.id, metadata: { name: input.name, scopes: input.batchIds.length, expiresAt: created.expiresAt?.toISOString() ?? null } } });
      return created;
    });
    return NextResponse.json({ credential, secret }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("PFO_CREDENTIAL_MASTER_KEY")) {
      console.error("credential_creation_config_error", { variable: "PFO_CREDENTIAL_MASTER_KEY" });
      return NextResponse.json({ error: "Configurazione server incompleta: imposta PFO_CREDENTIAL_MASTER_KEY (32 byte casuali in base64) per abilitare la creazione delle credenziali." }, { status: 503 });
    }
    return credentialApiError(error);
  }
}
