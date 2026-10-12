import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { getStorageConfig } from "@/lib/storage";
import { requireWorker } from "@/lib/execution-auth";
import { enqueueWebhookDeliveries } from "@/lib/webhook-delivery";

export const runtime = "nodejs";
type Context = { params: Promise<{ executionId: string }> };
const schema = z.object({ workerId: z.string(), output: z.unknown(), durationMs: z.number().int().min(0), pagesProcessed: z.number().int().min(0).default(0), files: z.array(z.object({ objectKey: z.string().min(1).max(1024), filename: z.string().min(1).max(255), mimeType: z.string().regex(/^[A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+$/).default("application/pdf"), sizeBytes: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/i), kind: z.enum(["INTERMEDIATE", "OUTPUT"]).default("OUTPUT"), nodeId: z.string().max(128).optional() }).strict()).max(200).default([]) }).strict();

export async function POST(request: NextRequest, context: Context) {
  if (!(await requireWorker(request))) return NextResponse.json({ error: "Worker non autorizzato." }, { status: 401 });
  try {
    const { executionId } = await context.params; const body = schema.parse(await request.json());
    const execution = await prisma.batchExecution.findFirst({ where: { id: executionId, leaseOwner: body.workerId, leaseExpiresAt: { gt: new Date() }, status: { in: ["RUNNING", "CANCEL_REQUESTED"] } }, select: { id: true, organizationId: true, startedAt: true, status: true } });
    if (!execution) return NextResponse.json({ error: "Lease non valido." }, { status: 409 });
    if (execution.status === "CANCEL_REQUESTED") {
      await prisma.$transaction(async (tx) => { await tx.batchExecution.update({ where: { id: executionId }, data: { status: "CANCELLED", completedAt: new Date(), durationMs: execution.startedAt ? Date.now() - execution.startedAt.getTime() : null, leaseOwner: null, leaseExpiresAt: null } }); const event = await tx.executionEvent.create({ data: { executionId, type: "CANCELLED", payload: { source: "worker" } } }); await enqueueWebhookDeliveries(tx, execution.organizationId, executionId, event.id, "CANCELLED", { source: "worker" }); });
      return NextResponse.json({ status: "CANCELLED" });
    }
    const { bucket } = getStorageConfig();
    const prefix = `${execution.organizationId}/executions/${executionId}/`;
    if (body.files.some((file) => !file.objectKey.startsWith(prefix))) return NextResponse.json({ error: "Percorso file fuori tenant o job." }, { status: 400 });
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      const retentionDays = Math.max(1, Number.parseInt(process.env.PFO_RETENTION_DAYS ?? "30", 10) || 30);
      const storedFiles = [];
      for (const file of body.files) storedFiles.push(await tx.storedFile.create({ data: { organizationId: execution.organizationId, bucket, objectKey: file.objectKey, filename: file.filename, mimeType: file.mimeType, sizeBytes: BigInt(file.sizeBytes), sha256: file.sha256, kind: file.kind, expiresAt: new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000) } }));
      const manifestFiles = storedFiles.map((file, index) => ({ id: file.id, filename: file.filename, mimeType: file.mimeType, sizeBytes: file.sizeBytes.toString(), sha256: file.sha256, ...(body.files[index]?.nodeId ? { nodeId: body.files[index].nodeId } : {}) }));
      const manifest = { count: manifestFiles.length, totalBytes: storedFiles.reduce((sum, file) => sum + file.sizeBytes, BigInt(0)).toString(), files: manifestFiles };
      const output = body.output && typeof body.output === "object" && !Array.isArray(body.output) ? body.output as Record<string, unknown> : {};
      await tx.batchExecution.update({ where: { id: executionId }, data: { status: "COMPLETED", progress: 100, output: { ...output, files: manifestFiles, manifest } as Prisma.InputJsonValue, pagesProcessed: body.pagesProcessed, durationMs: body.durationMs, completedAt: now, leaseOwner: null, leaseExpiresAt: null, currentStepId: null } });
      const event = await tx.executionEvent.create({ data: { executionId, type: "COMPLETED", payload: { durationMs: body.durationMs, pagesProcessed: body.pagesProcessed } } });
      await enqueueWebhookDeliveries(tx, execution.organizationId, executionId, event.id, "COMPLETED", { durationMs: body.durationMs, pagesProcessed: body.pagesProcessed });
    });
    return NextResponse.json({ status: "COMPLETED" });
  } catch (error) { console.error("Worker completion failed", error); return NextResponse.json({ error: "Completamento non valido." }, { status: 400 }); }
}
