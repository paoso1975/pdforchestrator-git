import { NextResponse, type NextRequest } from "next/server";
import { getAuthenticatedUserId } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { batchDraftHistoryItemSchema, uuidSchema } from "@/lib/schemas/api";
import { unauthorized, validationError } from "@/lib/validation";

export const runtime = "nodejs";
export async function GET(_request: NextRequest, context: { params: Promise<{ batchId: string }> }) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) return unauthorized();
    const batchId = uuidSchema.parse((await context.params).batchId);
    const batch = await prisma.batch.findFirst({ where: { id: batchId, organization: { memberships: { some: { userId } } } }, select: { organizationId: true } });
    if (!batch) return NextResponse.json({ error: "Batch non trovato." }, { status: 404 });
    const revisions = await prisma.batchDraftRevision.findMany({ where: { batchId, organizationId: batch.organizationId }, select: { id: true, revision: true, batchName: true, createdAt: true, actorId: true }, orderBy: { revision: "desc" }, take: 100 });
    return NextResponse.json(batchDraftHistoryItemSchema.array().parse(revisions));
  } catch (error) { return validationError(error); }
}
