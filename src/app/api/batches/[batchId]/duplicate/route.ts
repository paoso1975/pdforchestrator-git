import { Prisma } from "@/generated/prisma/client";
import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getAuthenticatedUserId } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { uuidSchema } from "@/lib/schemas/api";
import { forbidden, unauthorized, validationError } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(_request: NextRequest, context: { params: Promise<{ batchId: string }> }) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) return unauthorized();
    const batchId = uuidSchema.parse((await context.params).batchId);
    const original = await prisma.batch.findFirst({
      where: { id: batchId, organization: { memberships: { some: { userId, role: { in: ["OWNER", "ADMIN", "DESIGNER"] } } } } },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    });
    if (!original) return forbidden();
    const result = await prisma.$transaction(async (tx) => {
      const baseName = `Copia di ${original.name}`.slice(0, 120);
      const slugBase = `${original.slug.slice(0, 90)}-copia`;
      let slug = slugBase;
      for (let suffix = 2; await tx.batch.findFirst({ where: { organizationId: original.organizationId, slug }, select: { id: true } }); suffix += 1) slug = `${slugBase}-${suffix}`;
      const copy = await tx.batch.create({ data: { organizationId: original.organizationId, name: baseName, slug } });
      const source = original.versions[0];
      if (source) {
        const graph = source.graph as Prisma.InputJsonValue;
        const inputSchema = source.inputSchema as Prisma.InputJsonValue;
        const outputSchema = source.outputSchema as Prisma.InputJsonValue;
        const configHash = createHash("sha256").update(JSON.stringify({ graph, inputSchema, outputSchema, batchName: baseName })).digest("hex");
        const draft = await tx.batchVersion.create({ data: { batchId: copy.id, version: 1, revision: 1, graph, inputSchema, outputSchema, toolManifest: { draft: true }, configHash } });
        await tx.batchDraftRevision.create({ data: { organizationId: original.organizationId, batchId: copy.id, revision: 1, batchName: baseName, graph, inputSchema, outputSchema, actorId: userId } });
        await tx.auditEvent.create({ data: { organizationId: original.organizationId, actorId: userId, action: "batch.duplicated", resourceType: "Batch", resourceId: copy.id, metadata: { sourceBatchId: original.id, draftVersionId: draft.id } } });
      } else {
        await tx.auditEvent.create({ data: { organizationId: original.organizationId, actorId: userId, action: "batch.duplicated", resourceType: "Batch", resourceId: copy.id, metadata: { sourceBatchId: original.id } } });
      }
      return copy;
    });
    return NextResponse.json({ id: result.id, name: result.name, slug: result.slug }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "Duplicazione concorrente: riprova." }, { status: 409 });
    return validationError(error);
  }
}
