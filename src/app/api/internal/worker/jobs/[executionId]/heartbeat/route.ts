import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireWorker } from "@/lib/execution-auth";

export const runtime = "nodejs";
type Context = { params: Promise<{ executionId: string }> };
const schema = z.object({ workerId: z.string(), leaseSeconds: z.number().int().min(30).max(900).default(120), progress: z.number().int().min(0).max(99).optional(), currentStepId: z.string().nullable().optional(), pagesProcessed: z.number().int().min(0).optional(), event: z.string().max(80).optional(), payload: z.unknown().optional() }).strict();

export async function POST(request: NextRequest, context: Context) {
  if (!(await requireWorker(request))) return NextResponse.json({ error: "Worker non autorizzato." }, { status: 401 });
  try {
    const { executionId } = await context.params;
    const body = schema.parse(await request.json());
    const current = await prisma.batchExecution.findFirst({ where: { id: executionId, leaseOwner: body.workerId, leaseExpiresAt: { gt: new Date() }, status: { in: ["RUNNING", "CANCEL_REQUESTED"] } }, select: { status: true } });
    if (!current) return NextResponse.json({ error: "Lease non valido o job terminato." }, { status: 409 });
    if (current.status === "CANCEL_REQUESTED") return NextResponse.json({ cancelRequested: true });
    const data = await prisma.batchExecution.updateMany({ where: { id: executionId, leaseOwner: body.workerId, leaseExpiresAt: { gt: new Date() }, status: "RUNNING" }, data: { heartbeatAt: new Date(), leaseExpiresAt: new Date(Date.now() + body.leaseSeconds * 1000), ...(body.progress === undefined ? {} : { progress: body.progress }), ...(body.currentStepId === undefined ? {} : { currentStepId: body.currentStepId }), ...(body.pagesProcessed === undefined ? {} : { pagesProcessed: body.pagesProcessed }) } });
    if (!data.count) return NextResponse.json({ error: "Lease non valido." }, { status: 409 });
    if (body.event) await prisma.executionEvent.create({ data: { executionId, type: body.event, payload: (body.payload ?? {}) as never } });
    return NextResponse.json({ cancelRequested: false });
  } catch (error) { console.error("Worker heartbeat failed", error); return NextResponse.json({ error: "Heartbeat non valido." }, { status: 400 }); }
}
