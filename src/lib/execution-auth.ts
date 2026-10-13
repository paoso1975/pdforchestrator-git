import "server-only";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

export async function requireWorker(request: Request) {
  const configured = process.env.WORKER_SHARED_SECRET;
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!configured || !provided || configured.length < 32) return false;
  const { timingSafeEqual } = await import("node:crypto");
  const suppliedBytes = Buffer.from(provided); const expectedBytes = Buffer.from(configured);
  return suppliedBytes.length === expectedBytes.length && timingSafeEqual(suppliedBytes, expectedBytes);
}

export async function executionForRequest(executionId: string, request: Request) {
  const userId = await getAuthenticatedUserId();
  const include = {
    steps: { orderBy: { createdAt: "asc" as const } },
    events: { orderBy: { createdAt: "desc" as const }, take: 500 },
    batch: { select: { name: true } },
    batchVersion: { select: { version: true, graph: true } },
    credential: { select: { id: true, name: true, keyId: true, tokenPrefix: true } },
  };
  let execution = userId ? await prisma.batchExecution.findFirst({ where: { id: executionId, organization: { memberships: { some: { userId } } } }, include }) : null;
  if (!execution) {
    const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!bearer || bearer.length > 512) return { response: NextResponse.json({ error: "Autenticazione richiesta." }, { status: 401 }) };
    const credential = await prisma.apiCredential.findFirst({ where: { tokenHash: createHash("sha256").update(bearer).digest("hex"), keyId: null, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { id: true, grants: { select: { batchId: true, batchVersionIds: true } } } });
    if (credential?.grants.length) {
      const candidate = await prisma.batchExecution.findFirst({ where: { id: executionId, credentialId: credential.id }, include });
      const grant = candidate && credential.grants.find((item) => item.batchId === candidate.batchId && (!item.batchVersionIds.length || item.batchVersionIds.includes(candidate.batchVersionId)));
      if (candidate && grant) execution = candidate;
    }
  }
  if (!execution) return { response: NextResponse.json({ error: "Esecuzione non trovata." }, { status: 404 }) };
  return { execution, userId };
}
