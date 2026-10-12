import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireWorker } from "@/lib/execution-auth";

export const runtime = "nodejs";
type Context = { params: Promise<{ executionId: string }> };
const schema = z.object({ workerId: z.string(), nodeId: z.string().min(1), toolId: z.string().min(1), toolVersion: z.string(), status: z.enum(["RUNNING", "SUCCEEDED", "FAILED", "SKIPPED"]), progress: z.number().int().min(0).max(100).default(0), attempts: z.number().int().min(0).optional(), input: z.unknown().optional(), output: z.unknown().optional(), error: z.unknown().optional(), event: z.string().optional() }).strict();

export async function POST(request: NextRequest, context: Context) {
  if (!(await requireWorker(request))) return NextResponse.json({ error: "Worker non autorizzato." }, { status: 401 });
  try {
    const { executionId } = await context.params; const body = schema.parse(await request.json());
    const owned = await prisma.batchExecution.findFirst({ where: { id: executionId, leaseOwner: body.workerId, leaseExpiresAt: { gt: new Date() }, status: "RUNNING" }, select: { id: true } });
    if (!owned) return NextResponse.json({ error: "Lease non valido." }, { status: 409 });
    const step = await prisma.stepExecution.upsert({ where: { executionId_nodeId: { executionId, nodeId: body.nodeId } }, create: { executionId, nodeId: body.nodeId, toolId: body.toolId, toolVersion: body.toolVersion, status: body.status, progress: body.progress, attempts: body.attempts ?? 1, ...(body.input === undefined ? {} : { input: body.input as Prisma.InputJsonValue }), ...(body.output === undefined ? {} : { output: body.output as Prisma.InputJsonValue }), ...(body.error === undefined ? {} : { error: body.error as Prisma.InputJsonValue }), ...(body.status === "RUNNING" ? { startedAt: new Date() } : { completedAt: new Date() }) }, update: { status: body.status, progress: body.progress, ...(body.attempts === undefined ? {} : { attempts: body.attempts }), ...(body.input === undefined ? {} : { input: body.input as Prisma.InputJsonValue }), ...(body.output === undefined ? {} : { output: body.output as Prisma.InputJsonValue }), ...(body.error === undefined ? {} : { error: body.error as Prisma.InputJsonValue }), ...(body.status === "RUNNING" ? { startedAt: new Date(), completedAt: null } : { completedAt: new Date() }) } });
    await prisma.batchExecution.update({ where: { id: executionId }, data: { currentStepId: body.status === "RUNNING" ? body.nodeId : undefined } });
    if (body.event) await prisma.executionEvent.create({ data: { executionId, type: body.event, payload: { nodeId: body.nodeId, status: body.status } } });
    return NextResponse.json(step);
  } catch (error) { console.error("Worker step update failed", error); return NextResponse.json({ error: "Aggiornamento step non valido." }, { status: 400 }); }
}
