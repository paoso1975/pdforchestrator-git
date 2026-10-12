import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireWorker } from "@/lib/execution-auth";
export const runtime = "nodejs";
const schema = z.object({ workerId: z.string().min(1).max(120) }).strict();
export async function POST(request: NextRequest) {
  if (!(await requireWorker(request))) return NextResponse.json({ error: "Worker non autorizzato." }, { status: 401 });
  try {
    const { workerId } = schema.parse(await request.json());
    const files = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "StoredFile" WHERE "expiresAt" <= NOW() AND ("retentionLeaseUntil" IS NULL OR "retentionLeaseUntil" < NOW()) ORDER BY "expiresAt" LIMIT 50 FOR UPDATE SKIP LOCKED`;
      if (!rows.length) return [];
      await tx.storedFile.updateMany({ where: { id: { in: rows.map((item) => item.id) } }, data: { retentionLeaseOwner: workerId, retentionLeaseUntil: new Date(Date.now() + 120_000) } });
      return tx.storedFile.findMany({ where: { id: { in: rows.map((item) => item.id) } }, select: { id: true, organizationId: true, bucket: true, objectKey: true, uploadId: true, kind: true, expiresAt: true } });
    });
    return NextResponse.json({ files });
  } catch { return NextResponse.json({ error: "Claim retention non riuscito." }, { status: 400 }); }
}
