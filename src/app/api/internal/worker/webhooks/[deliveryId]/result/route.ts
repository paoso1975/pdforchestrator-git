import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireWorker } from "@/lib/execution-auth";
export const runtime = "nodejs";
type Context = { params: Promise<{ deliveryId: string }> };
const schema = z.object({ workerId: z.string(), success: z.boolean(), error: z.string().max(1000).optional() }).strict();
export async function POST(request: NextRequest, context: Context) {
  if (!(await requireWorker(request))) return NextResponse.json({ error: "Worker non autorizzato." }, { status: 401 });
  try {
    const id = z.string().uuid().parse((await context.params).deliveryId); const body = schema.parse(await request.json());
    const delivery = await prisma.webhookDelivery.findFirst({ where: { id, status: "DELIVERING", leaseOwner: body.workerId, leaseExpiresAt: { gt: new Date() } }, select: { id: true, attempts: true } });
    if (!delivery) return NextResponse.json({ error: "Lease webhook non valido." }, { status: 409 });
    const retry = !body.success && delivery.attempts < 10; const delay = Math.min(21_600, 15 * 2 ** Math.max(0, delivery.attempts - 1));
    const updated = await prisma.webhookDelivery.updateMany({ where: { id, leaseOwner: body.workerId }, data: { status: body.success ? "DELIVERED" : retry ? "PENDING" : "FAILED", deliveredAt: body.success ? new Date() : null, nextAttemptAt: retry ? new Date(Date.now() + delay * 1000) : null, lastError: body.success ? null : body.error ?? "Webhook delivery failed", leaseOwner: null, leaseExpiresAt: null } });
    return NextResponse.json({ updated: updated.count === 1, retryInSeconds: retry ? delay : null });
  } catch { return NextResponse.json({ error: "Esito webhook non valido." }, { status: 400 }); }
}
