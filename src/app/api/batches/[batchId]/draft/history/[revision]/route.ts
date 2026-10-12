import { NextResponse, type NextRequest } from "next/server";
import { getAuthenticatedUserId } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { uuidSchema } from "@/lib/schemas/api";
import { batchDraftHistoryDetailSchema, batchGraphSchema } from "@/lib/schemas/api";
import { unauthorized, validationError } from "@/lib/validation";

export const runtime = "nodejs";
export async function GET(_request: NextRequest, context: { params: Promise<{ batchId: string; revision: string }> }) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) return unauthorized();
    const { batchId: rawBatchId, revision: rawRevision } = await context.params;
    const batchId = uuidSchema.parse(rawBatchId);
    const revision = Number(rawRevision);
    if (!Number.isSafeInteger(revision) || revision < 1) return NextResponse.json({ error: "Revisione non valida." }, { status: 400 });
    const batch = await prisma.batch.findFirst({ where: { id: batchId, organization: { memberships: { some: { userId } } }, draftRevisions: { some: { revision } } }, select: { organizationId: true } });
    if (!batch) return NextResponse.json({ error: "Revisione non trovata." }, { status: 404 });
    const snapshot = await prisma.batchDraftRevision.findFirst({ where: { batchId, organizationId: batch.organizationId, revision } });
    if (!snapshot) return NextResponse.json({ error: "Revisione non trovata." }, { status: 404 });
    return NextResponse.json(batchDraftHistoryDetailSchema.parse({ ...snapshot, graph: batchGraphSchema.parse(snapshot.graph) }));
  } catch (error) { return validationError(error); }
}
