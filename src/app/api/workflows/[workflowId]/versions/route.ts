import { NextResponse, type NextRequest } from "next/server";
import { getAuthenticatedUserId } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { uuidSchema } from "@/lib/schemas/api";
import { unauthorized, validationError } from "@/lib/validation";

export const runtime = "nodejs";
type Context = { params: Promise<{ workflowId: string }> };

export async function GET(_request: NextRequest, context: Context) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) return unauthorized();
    const workflowId = uuidSchema.parse((await context.params).workflowId);
    const workflow = await prisma.workflow.findFirst({ where: { id: workflowId, organization: { memberships: { some: { userId } } } }, select: { organizationId: true, activeVersionId: true } });
    if (!workflow) return NextResponse.json({ error: "Workflow non trovato." }, { status: 404 });
    const versions = await prisma.workflowVersion.findMany({
      where: { organizationId: workflow.organizationId, workflowId },
      orderBy: { version: "desc" },
      select: { id: true, version: true, revision: true, hash: true, createdById: true, createdAt: true, publications: { orderBy: { publishedAt: "desc" }, select: { id: true, publishedAt: true, publishedById: true, revokedAt: true } } },
    });
    return NextResponse.json({ activeVersionId: workflow.activeVersionId, versions });
  } catch (error) {
    return validationError(error);
  }
}
