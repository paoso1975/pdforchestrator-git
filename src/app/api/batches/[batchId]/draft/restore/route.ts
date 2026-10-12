import { Prisma } from "@/generated/prisma/client";
import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthenticatedUserId } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { batchDraftResponseSchema, uuidSchema } from "@/lib/schemas/api";
import { forbidden, unauthorized, validationError } from "@/lib/validation";

export const runtime = "nodejs";
const restoreSchema = z.object({ sourceRevision: z.number().int().positive(), expectedRevision: z.number().int().positive().nullable() }).strict();

export async function POST(request: NextRequest, context: { params: Promise<{ batchId: string }> }) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) return unauthorized();
    const batchId = uuidSchema.parse((await context.params).batchId);
    const body = restoreSchema.parse(await request.json());
    const batch = await prisma.batch.findFirst({ where: { id: batchId, organization: { memberships: { some: { userId, role: { in: ["OWNER", "ADMIN", "DESIGNER"] } } } } }, select: { id: true, name: true, organizationId: true } });
    if (!batch) return forbidden();
    const result = await prisma.$transaction(async (tx) => {
      const source = await tx.batchDraftRevision.findFirst({ where: { batchId, organizationId: batch.organizationId, revision: body.sourceRevision } });
      if (!source) return { missing: true as const };
      const current = await tx.batchVersion.findFirst({ where: { batchId, publishedAt: null }, orderBy: { version: "desc" } });
      if ((current?.revision ?? null) !== body.expectedRevision) return { conflict: true as const, currentRevision: current?.revision ?? null };
      const graph = source.graph as Prisma.InputJsonValue;
      const inputSchema = source.inputSchema as Prisma.InputJsonValue;
      const outputSchema = source.outputSchema as Prisma.InputJsonValue;
      const configHash = createHash("sha256").update(JSON.stringify({ graph, inputSchema, outputSchema, batchName: source.batchName })).digest("hex");
      const data = { graph, inputSchema, outputSchema, toolManifest: { draft: true } as Prisma.InputJsonValue, configHash };
      let draft;
      if (current) {
        const revision = current.revision + 1;
        const write = await tx.batchVersion.updateMany({ where: { id: current.id, batchId, publishedAt: null, revision: body.expectedRevision! }, data: { ...data, revision } });
        if (!write.count) return { conflict: true as const, currentRevision: current.revision };
        draft = await tx.batchVersion.findUniqueOrThrow({ where: { id: current.id } });
      } else {
        const maximum = await tx.batchVersion.aggregate({ where: { batchId }, _max: { version: true } });
        const revisionMaximum = await tx.batchDraftRevision.aggregate({ where: { batchId }, _max: { revision: true } });
        draft = await tx.batchVersion.create({ data: { batchId, version: (maximum._max.version ?? 0) + 1, revision: (revisionMaximum._max.revision ?? 0) + 1, ...data } });
      }
      await tx.batch.update({ where: { id: batchId }, data: { name: source.batchName } });
      await tx.batchDraftRevision.create({ data: { organizationId: batch.organizationId, batchId, revision: draft.revision, batchName: source.batchName, graph, inputSchema, outputSchema, actorId: userId } });
      await tx.auditEvent.create({ data: { organizationId: batch.organizationId, actorId: userId, action: "batch.draft.restored", resourceType: "BatchDraft", resourceId: batchId, metadata: { sourceRevision: source.revision, revision: draft.revision, configHash } } });
      return { conflict: false as const, draft, batchName: source.batchName };
    });
    if ("missing" in result) return NextResponse.json({ error: "Revisione da ripristinare non trovata." }, { status: 404 });
    if ("conflict" in result && result.conflict) return NextResponse.json({ error: "Draft modificato da un'altra sessione.", currentRevision: result.currentRevision }, { status: 409 });
    return NextResponse.json(batchDraftResponseSchema.parse({ id: result.draft.id, batchId: result.draft.batchId, version: result.draft.version, revision: result.draft.revision, graph: result.draft.graph, inputSchema: result.draft.inputSchema, outputSchema: result.draft.outputSchema, configHash: result.draft.configHash, batchName: result.batchName, createdAt: result.draft.createdAt, updatedAt: result.draft.updatedAt }));
  } catch (error) { return validationError(error); }
}
