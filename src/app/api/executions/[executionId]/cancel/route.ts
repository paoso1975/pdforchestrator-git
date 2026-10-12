import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getAuthenticatedUserId } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { uuidSchema } from "@/lib/schemas/api";
import { validationError } from "@/lib/validation";

export const runtime = "nodejs";
type Context = { params: Promise<{ executionId: string }> };
export async function POST(_request: Request, context: Context) {
  try {
    const userId = await getAuthenticatedUserId();
    const id = uuidSchema.parse((await context.params).executionId);
    const execution = await prisma.batchExecution.findUnique({ where: { id }, select: { id: true, status: true, organizationId: true, batchId: true, credentialId: true } });
    if (!execution) return NextResponse.json({ error: "Esecuzione non trovata." }, { status: 404 });
    const membership = userId ? await prisma.organizationMembership.findFirst({ where: { organizationId: execution.organizationId, userId, role: { in: ["OWNER", "ADMIN", "OPERATOR"] } }, select: { userId: true } }) : null;
    if (!membership) {
      const bearer = _request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
      if (!bearer || !execution.credentialId) return NextResponse.json({ error: "Accesso non consentito." }, { status: 403 });
      const credential = await prisma.apiCredential.findFirst({ where: { id: execution.credentialId, tokenHash: createHash("sha256").update(bearer).digest("hex"), keyId: null, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }], grants: { some: { batchId: execution.batchId } } }, select: { id: true } });
      if (!credential) return NextResponse.json({ error: "Accesso non consentito." }, { status: 403 });
    }
    if (["COMPLETED", "SUCCEEDED", "FAILED", "CANCELLED"].includes(execution.status)) return NextResponse.json({ error: "Esecuzione già terminata." }, { status: 409 });
    const nextStatus = execution.status === "QUEUED" ? "CANCELLED" : "CANCEL_REQUESTED";
    const updated = await prisma.batchExecution.update({ where: { id }, data: { status: nextStatus, cancelRequestedAt: new Date(), ...(nextStatus === "CANCELLED" ? { completedAt: new Date() } : {}), events: { create: { type: nextStatus, payload: { source: "api" } } } } });
    return NextResponse.json(updated);
  } catch (error) { return validationError(error); }
}
