import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireWorker } from "@/lib/execution-auth";
export const runtime = "nodejs";
type Context = { params: Promise<{ fileId: string }> };
const schema = z.object({ workerId: z.string().min(1).max(120), success: z.boolean() }).strict();
export async function POST(request: NextRequest, context: Context) {
  if (!(await requireWorker(request))) return NextResponse.json({ error: "Worker non autorizzato." }, { status: 401 });
  try {
    const id = z.string().uuid().parse((await context.params).fileId); const body = schema.parse(await request.json());
    if (body.success) {
      const result = await prisma.storedFile.deleteMany({ where: { id, retentionLeaseOwner: body.workerId, retentionLeaseUntil: { gt: new Date() } } });
      return result.count ? NextResponse.json({ deleted: true }) : NextResponse.json({ error: "Lease retention non valido." }, { status: 409 });
    }
    const result = await prisma.storedFile.updateMany({ where: { id, retentionLeaseOwner: body.workerId }, data: { retentionLeaseOwner: null, retentionLeaseUntil: null, expiresAt: new Date(Date.now() + 15 * 60_000) } });
    return result.count ? NextResponse.json({ released: true }) : NextResponse.json({ error: "Lease retention non valido." }, { status: 409 });
  } catch { return NextResponse.json({ error: "Esito retention non valido." }, { status: 400 }); }
}
