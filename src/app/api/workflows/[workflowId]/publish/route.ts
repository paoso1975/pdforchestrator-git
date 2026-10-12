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
    const workflow = await prisma.workflow.findFirst({ where: { id: workflowId, organization: { memberships: { some: { userId } } } } });
    if (!workflow) return NextResponse.json({ error: "Workflow non trovato." }, { status: 404 });
    const membership = await prisma.organizationMembership.findUnique({ where: { organizationId_userId: { organizationId: workflow.organizationId, userId } }, select: { role: true } });
    if (!membership || !["OWNER", "ADMIN", "DESIGNER"].includes(membership.role)) return forbidden();
    if (workflow.status === "ARCHIVED") return NextResponse.json({ error: "Un workflow archiviato non può essere pubblicato." }, { status: 409 });
    const draft = await prisma.workflowDraft.findFirst({ where: { organizationId: workflow.organizationId, workflowId } });
    if (!draft) return NextResponse.json({ error: "Il workflow non ha una bozza da pubblicare." }, { status: 409 });
    if (draft.revision !== body.expectedRevision) return NextResponse.json({ error: "La bozza è cambiata; validala nuovamente prima della pubblicazione.", revision: draft.revision }, { status: 409 });

    // Recompile at the publication boundary. A stale or client-forged compiled plan is never trusted.
    const compiled = compileWorkflowDraft(draft);
    if (compiled.diagnostics.length || !compiled.plan) return NextResponse.json({ error: "Validazione o compilazione non riuscita.", issues: compiled.diagnostics.map(({ message }) => message), diagnostics: compiled.diagnostics }, { status: 400 });
    if (workflow.status !== "VALIDATED" || !draft.validatedAt || draft.hash !== compiled.hash || !draft.compiledPlan) {
      return NextResponse.json({ error: "La revisione deve essere validata dopo l'ultima modifica prima della pubblicazione." }, { status: 409 });
    }

    const result = await prisma.$transaction(async (tx) => {
      // Serialize version allocation and publication per workflow. Jobs keep their own immutable version FK.
      await tx.$queryRaw`SELECT "id" FROM "Workflow" WHERE "id" = ${workflowId}::uuid AND "organizationId" = ${workflow.organizationId}::uuid FOR UPDATE`;
      const current = await tx.workflow.findFirst({ where: { id: workflowId, organizationId: workflow.organizationId }, include: { drafts: true } });
      const currentDraft = current?.drafts[0];
      if (!current || current.status !== "VALIDATED" || !currentDraft || currentDraft.revision !== body.expectedRevision || currentDraft.hash !== compiled.hash || !currentDraft.validatedAt) return null;

      const latest = await tx.workflowVersion.aggregate({ where: { organizationId: workflow.organizationId, workflowId }, _max: { version: true } });
      const version = await tx.workflowVersion.create({ data: {
        organizationId: workflow.organizationId,
        workflowId,
        version: (latest._max.version ?? 0) + 1,
        revision: currentDraft.revision,
        nodes: currentDraft.nodes as Prisma.InputJsonValue,
        edges: currentDraft.edges as Prisma.InputJsonValue,
        viewport: currentDraft.viewport as Prisma.InputJsonValue,
        compiledPlan: compiled.plan as unknown as Prisma.InputJsonValue,
        inputSchema: currentDraft.inputSchema as Prisma.InputJsonValue,
        outputSchema: currentDraft.outputSchema as Prisma.InputJsonValue,
        hash: compiled.hash,
        createdById: userId,
      } });
      await tx.workflowPublication.create({ data: { organizationId: workflow.organizationId, workflowId, workflowVersionId: version.id, publishedById: userId } });
      await tx.workflow.update({ where: { id: workflowId }, data: { activeVersionId: version.id, status: "PUBLISHED", updatedById: userId } });
      await tx.auditEvent.create({ data: { organizationId: workflow.organizationId, workflowId, actorId: userId, action: "workflow.published", resourceType: "WorkflowVersion", resourceId: version.id, metadata: { version: version.version, revision: version.revision, hash: version.hash } } });
      return version;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (!result) return NextResponse.json({ error: "Lo stato del workflow è cambiato durante la pubblicazione; ricarica e riprova." }, { status: 409 });
    return NextResponse.json({ id: result.id, version: result.version, revision: result.revision, hash: result.hash, publishedAt: result.createdAt }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "Conflitto durante l'assegnazione della versione; riprova." }, { status: 409 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return NextResponse.json({ error: "Conflitto concorrente; ricarica e riprova." }, { status: 409 });
    return validationError(error);
  }
}
