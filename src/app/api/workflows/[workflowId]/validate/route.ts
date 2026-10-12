import { Prisma } from "@/generated/prisma/client";
import { NextResponse, type NextRequest } from "next/server";
import { getAuthenticatedUserId } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { uuidSchema } from "@/lib/schemas/api";
import { forbidden, unauthorized, validationError } from "@/lib/validation";
import { workflowPublicationPayloadSchema } from "@/lib/workflows/schemas";
import { compileWorkflowDraft } from "@/lib/workflows/publication";

export const runtime = "nodejs";
type Context = { params: Promise<{ workflowId: string }> };

export async function POST(request: NextRequest, context: Context) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) return unauthorized();
    const workflowId = uuidSchema.parse((await context.params).workflowId);
    const body = workflowPublicationPayloadSchema.parse(await request.json());
    const workflow = await prisma.workflow.findFirst({
      where: { id: workflowId, organization: { memberships: { some: { userId } } } },
      include: { drafts: true },
    });
    if (!workflow) return NextResponse.json({ error: "Workflow non trovato." }, { status: 404 });
    const membership = await prisma.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId: workflow.organizationId, userId } }, select: { role: true } });
    if (!membership || !["OWNER", "ADMIN", "DESIGNER"].includes(membership.role)) return forbidden();
    if (workflow.status === "ARCHIVED") return NextResponse.json({ error: "Un workflow archiviato non può essere validato." }, { status: 409 });
    const draft = workflow.drafts[0];
    if (!draft) return NextResponse.json({ error: "Il workflow non ha una bozza da validare." }, { status: 409 });
    if (draft.revision !== body.expectedRevision) return NextResponse.json({ error: "La bozza è cambiata; ricaricala prima di validare.", revision: draft.revision }, { status: 409 });

    const compiled = compileWorkflowDraft(draft);
    if (compiled.diagnostics.length || !compiled.plan) return NextResponse.json({ error: "Validazione o compilazione non riuscita.", issues: compiled.diagnostics.map(({ message }) => message), diagnostics: compiled.diagnostics }, { status: 400 });
    const saved = await prisma.$transaction(async (tx) => {
      const updateDraft = await tx.workflowDraft.updateMany({
        where: { id: draft.id, organizationId: workflow.organizationId, workflowId, revision: body.expectedRevision },
        data: { compiledPlan: compiled.plan as unknown as Prisma.InputJsonValue, hash: compiled.hash, validatedAt: new Date(), updatedById: userId },
      });
      if (!updateDraft.count) return false;
      const updateWorkflow = await tx.workflow.updateMany({ where: { id: workflowId, organizationId: workflow.organizationId, status: { not: "ARCHIVED" } }, data: { status: "VALIDATED", updatedById: userId } });
      if (!updateWorkflow.count) return false;
      await tx.auditEvent.create({ data: { organizationId: workflow.organizationId, workflowId, actorId: userId, action: "workflow.validated", resourceType: "WorkflowDraft", resourceId: draft.id, metadata: { revision: draft.revision, hash: compiled.hash, handlers: compiled.handlerDependencies } } });
      return true;
    });
    if (!saved) return NextResponse.json({ error: "La bozza è cambiata durante la validazione; riprova." }, { status: 409 });
    return NextResponse.json({ status: "VALIDATED", revision: draft.revision, hash: compiled.hash, compiledPlan: compiled.plan, handlerDependencies: compiled.handlerDependencies });
  } catch (error) {
    return validationError(error);
  }
}
