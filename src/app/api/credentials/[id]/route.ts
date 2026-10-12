import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUserId } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { credentialApiError } from "@/lib/credential-errors";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
const updateSchema = z.object({ batchIds: z.array(z.string().uuid()).min(1).max(100), versionScopes: z.record(z.string().uuid(), z.array(z.string().uuid()).max(500)) }).strict().superRefine((value, context) => {
  if (new Set(value.batchIds).size !== value.batchIds.length) context.addIssue({ code: "custom", path: ["batchIds"], message: "I batch non possono essere duplicati." });
  for (const [batchId, versionIds] of Object.entries(value.versionScopes)) {
    if (!value.batchIds.includes(batchId)) context.addIssue({ code: "custom", path: ["versionScopes", batchId], message: "Lo scope versione richiede che il batch sia autorizzato." });
    if (new Set(versionIds).size !== versionIds.length) context.addIssue({ code: "custom", path: ["versionScopes", batchId], message: "Gli ID versione non possono essere duplicati." });
  }
});

export async function PATCH(request: Request, context: Context) {
  try {
    const userId = await getAuthenticatedUserId(); if (!userId) return NextResponse.json({ error: "Autenticazione richiesta." }, { status: 401 });
    const id = z.string().uuid().parse((await context.params).id); const data = updateSchema.parse(await request.json());
    const credential = await prisma.apiCredential.findFirst({ where: { id, revokedAt: null, organization: { memberships: { some: { userId, role: { in: ["OWNER", "ADMIN"] } } } } }, select: { id: true, organizationId: true } });
    if (!credential) return NextResponse.json({ error: "Credenziale non trovata." }, { status: 404 });
    if (new Set(data.batchIds).size !== data.batchIds.length) return NextResponse.json({ error: "I batch non possono essere duplicati." }, { status: 400 });
    const batches = await prisma.batch.findMany({ where: { id: { in: data.batchIds }, organizationId: credential.organizationId, status: "PUBLISHED", activeVersionId: { not: null } }, select: { id: true } });
    if (batches.length !== data.batchIds.length) return NextResponse.json({ error: "Un batch non appartiene all'organizzazione o non è pubblicato." }, { status: 400 });
    const requestedVersionIds = Object.values(data.versionScopes ?? {}).flat();
    const versions = requestedVersionIds.length ? await prisma.batchVersion.findMany({ where: { id: { in: requestedVersionIds }, batchId: { in: data.batchIds }, publishedAt: { not: null }, batch: { organizationId: credential.organizationId } }, select: { id: true, batchId: true } }) : [];
    const versionBatch = new Map(versions.map((version) => [version.id, version.batchId]));
    if (versions.length !== new Set(requestedVersionIds).size || Object.entries(data.versionScopes ?? {}).some(([batchId, ids]) => ids.some((versionId) => versionBatch.get(versionId) !== batchId))) return NextResponse.json({ error: "Una versione selezionata non è pubblicata o non appartiene al batch autorizzato." }, { status: 400 });
    await prisma.$transaction(async (tx) => {
      await tx.apiCredentialGrant.deleteMany({ where: { credentialId: id } });
      await tx.apiCredentialGrant.createMany({ data: data.batchIds.map((batchId) => ({ credentialId: id, batchId, batchVersionIds: data.versionScopes?.[batchId] ?? [] })) });
      await tx.auditEvent.create({ data: { organizationId: credential.organizationId, actorId: userId, action: "api_credential.scopes_updated", resourceType: "ApiCredential", resourceId: id, metadata: { batchCount: data.batchIds.length } } });
    });
    return NextResponse.json({ updated: true });
  } catch (error) { return credentialApiError(error); }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const userId = await getAuthenticatedUserId(); if (!userId) return NextResponse.json({ error: "Autenticazione richiesta." }, { status: 401 });
    const id = z.string().uuid().parse((await context.params).id);
    const credential = await prisma.apiCredential.findFirst({ where: { id, revokedAt: null, organization: { memberships: { some: { userId, role: { in: ["OWNER", "ADMIN"] } } } } }, select: { id: true, organizationId: true } });
    if (!credential) return NextResponse.json({ error: "Credenziale non trovata o già revocata." }, { status: 404 });
    await prisma.$transaction(async (tx) => {
      await tx.apiCredential.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditEvent.create({ data: { organizationId: credential.organizationId, actorId: userId, action: "api_credential.revoked", resourceType: "ApiCredential", resourceId: id, metadata: {} } });
    });
    return NextResponse.json({ revoked: true });
  } catch (error) { return credentialApiError(error); }
}
