import { Prisma } from "@/generated/prisma/client";
import { NextResponse, type NextRequest } from "next/server";
import { getAuthenticatedUserId } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { uuidSchema } from "@/lib/schemas/api";
import { forbidden, unauthorized, validationError } from "@/lib/validation";
import { workflowRollbackPayloadSchema } from "@/lib/workflows/schemas";

export const runtime = "nodejs";
type Context = { params: Promise<{ workflowId: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) return unauthorized();
    const workflowId = uuidSchema.parse((await context.params).workflowId);
    const body = workflowRollbackPayloadSchema.parse(await request.json());
    const workflow = await prisma.workflow.findFirst({ where: { id: workflowId, organization: { memberships: { some: { userId } } } } });
    if (!workflow) return NextResponse.json({ error: "Workflow non trovato." }, { status: 404 });
    const membership = await prisma.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId: workflow.organizationId, userId } }, select: { role: true } });
    if (!membership || !["OWNER", "ADMIN", "DESIGNER"].includes(membership.role)) return forbidden();
    if (workflow.status === "ARCHIVED") return NextResponse.json({ error: "Un workflow archiviato non può essere ripristinato." }, { status: 409 });
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Workflow" WHERE "id" = ${workflowId}::uuid AND "organizationId" = ${workflow.organizationId}::uuid FOR UPDATE`;
      const current = await tx.workflow.findFirst({ where: { id: workflowId, organizationId: workflow.organizationId }, select: { status: true } });
      if (!current || current.status === "ARCHIVED") return { error: "ARCHIVED" as const };
      const version = await tx.workflowVersion.findFirst({ where: { id: body.workflowVersionId, organizationId: workflow.organizationId, workflowId } });
      if (!version) return { error: "NOT_FOUND" as const };
      await tx.workflowPublication.create({ data: { organizationId: workflow.organizationId, workflowId, workflowVersionId: version.id, publishedById: userId } });
      await tx.workflow.update({ where: { id: workflowId }, data: { activeVersionId: version.id, status: "PUBLISHED", updatedById: userId } });
      await tx.auditEvent.create({ data: { organizationId: workflow.organizationId, workflowId, actorId: userId, action: "workflow.rolled_back", resourceType: "WorkflowVersion", resourceId: version.id, metadata: { version: version.version, hash: version.hash } } });
      return { version };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if ("error" in result) return NextResponse.json({ error: result.error === "ARCHIVED" ? "Un workflow archiviato non può essere ripristinato." : "Versione non trovata per questo workflow." }, { status: result.error === "ARCHIVED" ? 409 : 404 });
    return NextResponse.json({ id: result.version.id, version: result.version.version, revision: result.version.revision, hash: result.version.hash, publishedAt: new Date() });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return NextResponse.json({ error: "Conflitto concorrente; ricarica e riprova." }, { status: 409 });
    return validationError(error);
  }
}
