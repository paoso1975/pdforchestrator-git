import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireWorker } from "@/lib/execution-auth";
import { createStorageClient } from "@/lib/storage";
import { verifyStoredPdfUpload } from "@/lib/upload-verification";
import { collectPdfFileReferences, validatePdfInputFileRecords } from "@/lib/pdf-file-references";
import { addApiSourceAliases } from "@/lib/api-schema";

export const runtime = "nodejs";
const schema = z.object({ workerId: z.string().min(1).max(120), leaseSeconds: z.number().int().min(30).max(900).default(120) }).strict();

export async function POST(request: NextRequest) {
  if (!(await requireWorker(request))) return NextResponse.json({ error: "Worker non autorizzato." }, { status: 401 });
  let claimedExecutionId: string | null = null;
  let claimedWorkerId = "";
  try {
    const { workerId, leaseSeconds } = schema.parse(await request.json());
    claimedWorkerId = workerId;
    const job = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`UPDATE "BatchExecution" SET "status" = 'FAILED', "error" = '{"code":"LEASE_EXHAUSTED","message":"Lease scaduto dopo il numero massimo di tentativi."}'::jsonb, "completedAt" = NOW(), "durationMs" = CASE WHEN "startedAt" IS NULL THEN NULL ELSE GREATEST(0, (EXTRACT(EPOCH FROM (NOW() - "startedAt")) * 1000)::int) END, "leaseOwner" = NULL, "leaseExpiresAt" = NULL WHERE "status" = 'RUNNING' AND "leaseExpiresAt" < NOW() AND "attemptCount" >= "maxAttempts"`);
      await tx.$executeRaw(Prisma.sql`UPDATE "BatchExecution" SET "status" = 'CANCELLED', "completedAt" = NOW(), "durationMs" = CASE WHEN "startedAt" IS NULL THEN NULL ELSE GREATEST(0, (EXTRACT(EPOCH FROM (NOW() - "startedAt")) * 1000)::int) END, "leaseOwner" = NULL, "leaseExpiresAt" = NULL WHERE "status" = 'CANCEL_REQUESTED' AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" < NOW())`);
      const rows = await tx.$queryRaw<Array<{ id: string; status: string; leaseOwner: string | null; attemptCount: number }>>(Prisma.sql`SELECT "id", "status", "leaseOwner", "attemptCount" FROM "BatchExecution" WHERE (("status" = 'QUEUED' AND "runAfter" <= NOW()) OR ("status" = 'RUNNING' AND "leaseExpiresAt" < NOW())) AND "attemptCount" < "maxAttempts" ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1`);
      const claimed = rows[0];
      const id = claimed?.id;
      if (!id) return null;
      const current = await tx.batchExecution.findUnique({ where: { id }, select: { startedAt: true } });
      await tx.batchExecution.update({ where: { id }, data: { status: "RUNNING", error: Prisma.DbNull, leaseOwner: workerId, leaseExpiresAt: new Date(Date.now() + leaseSeconds * 1000), heartbeatAt: new Date(), attemptCount: { increment: 1 }, ...(current?.startedAt ? {} : { startedAt: new Date() }) } });
      if (claimed.status === "RUNNING") await tx.executionEvent.create({ data: { executionId: id, type: "LEASE_RECOVERED", payload: { previousWorkerId: claimed.leaseOwner, previousAttempt: claimed.attemptCount, recoveryStrategy: "REPLAY_FROM_IMMUTABLE_INPUTS" } } });
      await tx.executionEvent.create({ data: { executionId: id, type: "WORKER_CLAIMED", payload: { workerId } } });
      return tx.batchExecution.findUnique({ where: { id }, include: { batchVersion: true } });
    });
    if (!job) return NextResponse.json({ job: null });
    claimedExecutionId = job.id;
    const input = job.input as Record<string, unknown>;
    const references = collectPdfFileReferences(input, job.batchVersion.inputSchema);
    const fileIds = [...new Set(references.map(({ fileId }) => fileId))];
    const records = fileIds.length ? await prisma.storedFile.findMany({ where: { id: { in: fileIds } } }) : [];
    const validation = validatePdfInputFileRecords(references, records, { organizationId: job.organizationId });
    if (!validation.valid) {
      await failClaimedJob(job.id, workerId, validation.error.code, validation.error.message);
      return NextResponse.json({ job: null });
    }
    const storage = createStorageClient();
    for (const file of validation.files) {
      try {
        const result = await verifyStoredPdfUpload(storage, file);
        if (!result.valid) {
          await failClaimedJob(job.id, workerId, result.reason, `Il PDF ${file.filename} non è disponibile o non supera le verifiche Cubbit (${result.reason}).`);
          return NextResponse.json({ job: null });
        }
      } catch {
        await failClaimedJob(job.id, workerId, "FILE_UNAVAILABLE", `Il PDF ${file.filename} non è disponibile nel bucket Cubbit.`);
        return NextResponse.json({ job: null });
      }
    }
    const files = validation.files;
    const workerInput = addApiSourceAliases(input, job.batchVersion.inputSchema);
    return NextResponse.json({ job: { ...job, input: workerInput }, files: files.map((file) => ({ ...file, sizeBytes: file.sizeBytes.toString() })) });
  } catch (error) {
    console.error("Worker claim failed", error);
    if (claimedExecutionId) {
      try { await failClaimedJob(claimedExecutionId, claimedWorkerId, "CLAIM_VALIDATION_FAILED", "Impossibile verificare i file PDF richiesti per il job."); }
      catch (failureError) { console.error("Could not fail claimed job after validation error", failureError); }
      return NextResponse.json({ job: null });
    }
    return NextResponse.json({ error: "Richiesta claim non valida." }, { status: 400 });
  }
}

async function failClaimedJob(executionId: string, workerId: string, code: string, message: string) {
  await prisma.$transaction(async (tx) => {
    const changed = await tx.batchExecution.updateMany({
      where: { id: executionId, status: "RUNNING", ...(workerId ? { leaseOwner: workerId } : {}) },
      data: {
        status: "FAILED",
        error: { code, message },
        completedAt: new Date(),
        durationMs: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
      },
    });
    if (changed.count) await tx.executionEvent.create({ data: { executionId, type: "FAILED", payload: { code, message, source: "WORKER_CLAIM_FILE_VALIDATION" } } });
  });
}
