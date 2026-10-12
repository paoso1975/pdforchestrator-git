import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireWorker } from "@/lib/execution-auth";
import { enqueueWebhookDeliveries } from "@/lib/webhook-delivery";

export const runtime = "nodejs";
type Context = { params: Promise<{ executionId: string }> };
const schema = z.object({ workerId: z.string(), error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }), retryable: z.boolean().default(true) }).strict();

export async function POST(request: NextRequest, context: Context) {
  if (!(await requireWorker(request))) return NextResponse.json({ error: "Worker non autorizzato." }, { status: 401 });
  try {
    const { executionId } = await context.params; const body = schema.parse(await request.json());
    const execution = await prisma.batchExecution.findFirst({ where: { id: executionId, leaseOwner: body.workerId, leaseExpiresAt: { gt: new Date() }, status: { in: ["RUNNING", "CANCEL_REQUESTED"] } } });
    if (!execution) return NextResponse.json({ error: "Lease non valido." }, { status: 409 });
    if (execution.status === "CANCEL_REQUESTED") {
      await prisma.$transaction(async (tx) => { await tx.batchExecution.update({ where: { id: executionId }, data: { status: "CANCELLED", completedAt: new Date(), durationMs: execution.startedAt ? Date.now() - execution.startedAt.getTime() : null, leaseOwner: null, leaseExpiresAt: null } }); const event = await tx.executionEvent.create({ data: { executionId, type: "CANCELLED", payload: { source: "worker" } } }); await enqueueWebhookDeliveries(tx, execution.organizationId, executionId, event.id, "CANCELLED", { source: "worker" }); });
      return NextResponse.json({ status: "CANCELLED" });
    }
    const retry = body.retryable && execution.attemptCount < execution.maxAttempts;
    const delaySeconds = Math.min(3600, 15 * 2 ** Math.max(0, execution.attemptCount - 1));
    await prisma.$transaction(async (tx) => {
      await tx.batchExecution.update({ where: { id: executionId }, data: { status: retry ? "QUEUED" : "FAILED", error: body.error as Prisma.InputJsonValue, ...(retry ? { runAfter: new Date(Date.now() + delaySeconds * 1000) } : { completedAt: new Date(), durationMs: execution.startedAt ? Date.now() - execution.startedAt.getTime() : null }), leaseOwner: null, leaseExpiresAt: null, currentStepId: null } });
      const event = await tx.executionEvent.create({ data: { executionId, type: retry ? "RETRY_SCHEDULED" : "FAILED", payload: { error: body.error, retryInSeconds: retry ? delaySeconds : null } as Prisma.InputJsonValue } });
      if (!retry) await enqueueWebhookDeliveries(tx, execution.organizationId, executionId, event.id, "FAILED", { error: body.error });
    });
    return NextResponse.json({ status: retry ? "QUEUED" : "FAILED", retryInSeconds: retry ? delaySeconds : null });
  } catch (error) { console.error("Worker failure update failed", error); return NextResponse.json({ error: "Errore worker non valido." }, { status: 400 }); }
}
