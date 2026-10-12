import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/secret-vault";
import { requireWorker } from "@/lib/execution-auth";
export const runtime = "nodejs";
const schema = z.object({ workerId: z.string().min(1).max(120) }).strict();
export async function POST(request: NextRequest) {
  if (!(await requireWorker(request))) return NextResponse.json({ error: "Worker non autorizzato." }, { status: 401 });
  try {
    const { workerId } = schema.parse(await request.json());
    const selected = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "WebhookDelivery" WHERE (("status" = 'PENDING' AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= NOW())) OR ("status" = 'DELIVERING' AND "leaseExpiresAt" < NOW())) ORDER BY "createdAt" ASC LIMIT 1 FOR UPDATE SKIP LOCKED`;
      if (!rows.length) return null;
      await tx.webhookDelivery.update({ where: { id: rows[0].id }, data: { status: "DELIVERING", attempts: { increment: 1 }, leaseOwner: workerId, leaseExpiresAt: new Date(Date.now() + 60_000) } });
      return tx.webhookDelivery.findUnique({ where: { id: rows[0].id }, include: { endpoint: { select: { url: true, secret: true, secretIv: true, secretAuthTag: true, enabled: true } } } });
    });
    if (!selected || !selected.endpoint.enabled) return NextResponse.json({ delivery: null });
    const secret = selected.endpoint.secretIv && selected.endpoint.secretAuthTag ? decryptSecret({ ciphertext: selected.endpoint.secret, iv: selected.endpoint.secretIv, authTag: selected.endpoint.secretAuthTag }) : null;
    if (!secret) return NextResponse.json({ error: "Webhook secret non disponibile." }, { status: 500 });
    return NextResponse.json({ delivery: { id: selected.id, eventId: selected.eventId, url: selected.endpoint.url, payload: selected.payload, secret, attempts: selected.attempts, workerId } });
  } catch { console.error("webhook claim failed"); return NextResponse.json({ error: "Claim webhook non riuscito." }, { status: 400 }); }
}
