import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authorizePublicRequest, publicApiError, readBody } from "@/lib/public-api";
import { enqueueWebhookDeliveries } from "@/lib/webhook-delivery";
import { credentialCanAccessBatchVersion } from "@/lib/credential-scopes";
export const runtime = "nodejs";
type Context = { params: Promise<{ executionId: string }> };
export async function POST(request: Request, context: Context) {
  try {
    const { bytes, error } = await readBody(request); if (error) return error;
    const auth = await authorizePublicRequest(request, bytes); if (auth.response) return auth.response;
    if (bytes.length) return NextResponse.json({ error: "Il body deve essere vuoto." }, { status: 400 });
    const id = z.string().uuid().parse((await context.params).executionId);
    const execution = await prisma.batchExecution.findFirst({ where: { id, organizationId: auth.credential.organizationId, credentialId: auth.credential.id }, select: { id: true, organizationId: true, batchId: true, batchVersionId: true, status: true } });
    if (!execution) return NextResponse.json({ error: "Execution non trovata." }, { status: 404 });
    if (!await credentialCanAccessBatchVersion(auth.credential.id, execution.batchId, execution.batchVersionId)) return NextResponse.json({ error: "Execution non trovata." }, { status: 404 });
    if (!["QUEUED", "RUNNING"].includes(execution.status)) return NextResponse.json({ id, status: execution.status });
    const status = execution.status === "QUEUED" ? "CANCELLED" : "CANCEL_REQUESTED";
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.batchExecution.update({ where: { id }, data: { status, cancelRequestedAt: new Date(), ...(status === "CANCELLED" ? { completedAt: new Date() } : {}) }, select: { id: true, status: true } });
      const event = await tx.executionEvent.create({ data: { executionId: id, type: status === "CANCELLED" ? "CANCELLED" : "CANCEL_REQUESTED", payload: { source: "public_hmac" } } });
      if (status === "CANCELLED") await enqueueWebhookDeliveries(tx, execution.organizationId, id, event.id, "CANCELLED", { source: "public_hmac" });
      return result;
    });
    return NextResponse.json(updated, { status: 202 });
  } catch (error) { return publicApiError(error, request); }
}
