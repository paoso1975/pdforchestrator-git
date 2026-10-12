import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireWorker } from "@/lib/execution-auth";

export const runtime = "nodejs";
const schema = z.object({ workerId: z.string().min(1).max(120), leaseSeconds: z.number().int().min(30).max(900).default(120) }).strict();

export async function POST(request: NextRequest) {
  if (!(await requireWorker(request))) return NextResponse.json({ error: "Worker non autorizzato." }, { status: 401 });
  try {
    const { workerId, leaseSeconds } = schema.parse(await request.json());
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
    const input = job.input as Record<string, unknown>;
    const collectFileIds = (value: unknown, schema: unknown): string[] => {
      if (!schema || typeof schema !== "object" || Array.isArray(schema)) return [];
      const spec = schema as { format?: string; type?: string; items?: unknown; properties?: Record<string, unknown> };
      if (spec.format === "uri") return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value) ? [value] : [];
      if (spec.type === "array" && Array.isArray(value)) return value.flatMap((item) => collectFileIds(item, spec.items));
      if (spec.type === "object" && value && typeof value === "object" && !Array.isArray(value)) return Object.entries(value).flatMap(([key, item]) => collectFileIds(item, spec.properties?.[key]));
      return [];
    };
    const fileIds = [...new Set(collectFileIds(input, job.batchVersion.inputSchema))];
    const files = await prisma.storedFile.findMany({ where: { id: { in: fileIds }, organizationId: job.organizationId, kind: "INPUT", uploadState: "UPLOADED", expiresAt: { gt: new Date() } } });
    return NextResponse.json({ job, files: files.map((file) => ({ ...file, sizeBytes: file.sizeBytes.toString() })) });
  } catch (error) { console.error("Worker claim failed", error); return NextResponse.json({ error: "Richiesta claim non valida." }, { status: 400 }); }
}
