import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireWorker } from "@/lib/execution-auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
const schema = z.object({
  workerId: z.string().min(1).max(160),
  version: z.string().max(80).optional(),
  concurrency: z.number().int().min(1).max(16),
}).strict();

export async function POST(request: NextRequest) {
  if (!(await requireWorker(request))) return NextResponse.json({ error: "Worker non autorizzato." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Heartbeat non valido." }, { status: 400 });
  try {
    await prisma.workerHeartbeat.upsert({
      where: { workerId: parsed.data.workerId },
      create: { ...parsed.data },
      update: { version: parsed.data.version, concurrency: parsed.data.concurrency, lastSeenAt: new Date() },
    });
    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json({ error: "Heartbeat non disponibile." }, { status: 503 });
  }
}
