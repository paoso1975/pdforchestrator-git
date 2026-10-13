import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireWorker } from "@/lib/execution-auth";

export const runtime = "nodejs";
type Context = { params: Promise<{ executionId: string }> };
const schema = z.object({ workerId: z.string(), nodeId: z.string().min(1), toolId: z.string().min(1), toolVersion: z.string(), status: z.enum(["RUNNING", "SUCCEEDED", "FAILED", "SKIPPED"]), progress: z.number().int().min(0).max(100).default(0), attempts: z.number().int().min(0).optional(), input: z.unknown().optional(), parameters: z.unknown().optional(), variablesIn: z.unknown().optional(), variablesOut: z.unknown().optional(), executionString: z.string().max(64 * 1024).optional(), output: z.unknown().optional(), error: z.unknown().optional(), event: z.string().max(80).optional() }).strict();

export async function POST(request: NextRequest, context: Context) {
  if (!(await requireWorker(request))) return NextResponse.json({ error: "Worker non autorizzato." }, { status: 401 });
  try {
    const { executionId } = await context.params; const body = schema.parse(await request.json());
    const owned = await prisma.batchExecution.findFirst({ where: { id: executionId, leaseOwner: body.workerId, leaseExpiresAt: { gt: new Date() }, status: "RUNNING" }, select: { id: true } });
    if (!owned) return NextResponse.json({ error: "Lease non valido." }, { status: 409 });
    const jsonValues = [body.input, body.parameters, body.variablesIn, body.variablesOut, body.output, body.error].filter((item) => item !== undefined);
    const payloadBytes = Buffer.byteLength(JSON.stringify(jsonValues), "utf8") + Buffer.byteLength(body.executionString ?? "", "utf8");
    if (payloadBytes > 256 * 1024) return NextResponse.json({ error: "Dettagli evento troppo grandi (limite 256 KiB)." }, { status: 413 });
    const key = { executionId_nodeId: { executionId, nodeId: body.nodeId } };
    const result = await prisma.$transaction(async (tx) => {
      const previous = await tx.stepExecution.findUnique({ where: key, select: { status: true, attempts: true } });
      const startingRun = body.status === "RUNNING" && (!previous || previous.status !== "RUNNING" || body.event === "STEP_RETRY" || (body.attempts !== undefined && body.attempts > previous.attempts));
      const jsonFields = {
        ...(body.input === undefined ? {} : { input: body.input as Prisma.InputJsonValue }),
        ...(body.parameters === undefined ? {} : { parameters: body.parameters as Prisma.InputJsonValue }),
        ...(body.variablesIn === undefined ? {} : { variablesIn: body.variablesIn as Prisma.InputJsonValue }),
        ...(body.variablesOut === undefined ? {} : { variablesOut: body.variablesOut as Prisma.InputJsonValue }),
        ...(body.output === undefined ? {} : { output: body.output as Prisma.InputJsonValue }),
        ...(body.error === undefined ? {} : { error: body.error as Prisma.InputJsonValue }),
      };
      const step = await tx.stepExecution.upsert({
        where: key,
        create: { executionId, nodeId: body.nodeId, toolId: body.toolId, toolVersion: body.toolVersion, status: body.status, progress: body.progress, attempts: body.attempts ?? 1, ...jsonFields, ...(body.executionString === undefined ? {} : { executionString: body.executionString }), ...(body.status === "RUNNING" ? { startedAt: new Date() } : { completedAt: new Date() }) },
        update: { status: body.status, progress: body.progress, ...(body.attempts === undefined ? {} : { attempts: body.attempts }), ...jsonFields, ...(body.executionString === undefined ? {} : { executionString: body.executionString }), ...(startingRun ? { startedAt: new Date(), completedAt: null } : body.status === "RUNNING" ? {} : { completedAt: new Date() }) },
      });
      if (body.status === "RUNNING") await tx.batchExecution.update({ where: { id: executionId }, data: { currentStepId: body.nodeId } });
      const shouldRecordEvent = !previous || previous.status !== body.status || jsonValues.length > 0 || body.event !== undefined;
      if (shouldRecordEvent) await tx.executionEvent.create({ data: { executionId, type: body.event ?? "STEP_UPDATE", payload: { nodeId: body.nodeId, toolId: body.toolId, toolVersion: body.toolVersion, status: body.status, progress: body.progress, ...(body.attempts === undefined ? {} : { attempts: body.attempts }), ...(body.input === undefined ? {} : { input: body.input as Prisma.InputJsonValue }), ...(body.parameters === undefined ? {} : { parameters: body.parameters as Prisma.InputJsonValue }), ...(body.variablesIn === undefined ? {} : { variablesIn: body.variablesIn as Prisma.InputJsonValue }), ...(body.variablesOut === undefined ? {} : { variablesOut: body.variablesOut as Prisma.InputJsonValue }), ...(body.executionString === undefined ? {} : { executionString: body.executionString }), ...(body.output === undefined ? {} : { output: body.output as Prisma.InputJsonValue }), ...(body.error === undefined ? {} : { error: body.error as Prisma.InputJsonValue }), ...(body.event === undefined ? {} : { workerEvent: body.event }) } as Prisma.InputJsonValue } });
      return step;
    });
    return NextResponse.json(result);
  } catch (error) { console.error("Worker step update failed", error); return NextResponse.json({ error: "Aggiornamento step non valido." }, { status: 400 }); }
}
