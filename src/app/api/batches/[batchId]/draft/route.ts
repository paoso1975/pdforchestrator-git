import { Prisma } from "@/generated/prisma/client";
import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getAuthenticatedUserId } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { batchDraftResponseSchema, batchDraftWriteSchema, batchGraphSchema, uuidSchema } from "@/lib/schemas/api";
import { unauthorized, validationError } from "@/lib/validation";
import { PayloadTooLargeError, readBoundedRequestBody } from "@/lib/http-body";
import { MAX_BATCH_DRAFT_BYTES } from "@/lib/schemas/batch-draft-export";
import { validateStructure, type BatchEdge, type BatchNode } from "@/lib/batch-graph";
import { getBlockDefinition } from "@/lib/blocks/registry";

export const runtime = "nodejs";
type Context = { params: Promise<{ batchId: string }> };
const editors = ["OWNER", "ADMIN", "DESIGNER"] as const;

function responseData(draft: { id: string; batchId: string; version: number; revision: number; graph: unknown; inputSchema: unknown; outputSchema: unknown; configHash: string; createdAt: Date; updatedAt: Date }, batchName: string) {
  return { id: draft.id, batchId: draft.batchId, version: draft.version, revision: draft.revision, graph: draft.graph, inputSchema: draft.inputSchema, outputSchema: draft.outputSchema, configHash: draft.configHash, batchName, createdAt: draft.createdAt, updatedAt: draft.updatedAt };
}

async function authorizedBatch(batchId: string, userId: string, write: boolean) {
  const batch = await prisma.batch.findFirst({
    where: { id: batchId, organization: { memberships: { some: { userId, ...(write ? { role: { in: [...editors] } } : {}) } } } },
    select: { id: true, name: true, organizationId: true },
  });
  return batch;
}

export async function GET(_request: NextRequest, context: Context) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) return unauthorized();
    const batchId = uuidSchema.parse((await context.params).batchId);
    const batch = await authorizedBatch(batchId, userId, false);
    if (!batch) return NextResponse.json({ error: "Batch non trovato." }, { status: 404 });
    const draft = await prisma.batchVersion.findFirst({ where: { batchId, publishedAt: null }, orderBy: { version: "desc" } });
    return NextResponse.json(draft ? batchDraftResponseSchema.parse(responseData({ ...draft, graph: batchGraphSchema.parse(draft.graph) }, batch.name)) : null);
  } catch (error) { return validationError(error); }
}

export async function PUT(request: NextRequest, context: Context) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) return unauthorized();
    const batchId = uuidSchema.parse((await context.params).batchId);
    const batch = await authorizedBatch(batchId, userId, true);
    if (!batch) return NextResponse.json({ error: "Batch non trovato o modifica non consentita." }, { status: 404 });
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_BATCH_DRAFT_BYTES) return NextResponse.json({ error: "Il draft supera il limite di 5 MiB." }, { status: 413 });
    const text = await readBoundedRequestBody(request, MAX_BATCH_DRAFT_BYTES);
    const body = batchDraftWriteSchema.parse(JSON.parse(text));
    const structuralIssues = validateStructure(body.graph.nodes as BatchNode[], body.graph.edges as BatchEdge[]);
    const unknownTools = body.graph.nodes.filter((node) => !getBlockDefinition(node.data.toolId, node.data.toolVersion)).map((node) => `${node.data.toolId}@${node.data.toolVersion}`);
    if (structuralIssues.length || unknownTools.length) return NextResponse.json({ error: "Draft non valido.", issues: [...structuralIssues, ...unknownTools.map((tool) => `Strumento non riconosciuto: ${tool}.`)] }, { status: 400 });
    const serialized = JSON.stringify({ graph: body.graph, inputSchema: body.inputSchema, outputSchema: body.outputSchema, batchName: body.batchName });
    const configHash = createHash("sha256").update(serialized).digest("hex");

    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.batchVersion.findFirst({ where: { batchId, publishedAt: null }, orderBy: { version: "desc" } });
      if ((current?.revision ?? null) !== body.expectedRevision) return { conflict: true as const, currentRevision: current?.revision ?? null };
      if (current?.configHash === configHash) return { conflict: false as const, unchanged: true as const, draft: current, batchName: body.batchName };
      let draft;
      const jsonData = {
        graph: body.graph as Prisma.InputJsonValue,
        inputSchema: body.inputSchema as Prisma.InputJsonValue,
        outputSchema: body.outputSchema as Prisma.InputJsonValue,
        toolManifest: { draft: true } as Prisma.InputJsonValue,
        configHash,
      };
      if (current) {
        const nextRevision = current.revision + 1;
        const write = await tx.batchVersion.updateMany({ where: { id: current.id, batchId, publishedAt: null, revision: body.expectedRevision! }, data: { ...jsonData, revision: nextRevision } });
        if (!write.count) return { conflict: true as const, currentRevision: current.revision };
        draft = await tx.batchVersion.findUniqueOrThrow({ where: { id: current.id } });
      } else {
        const maximum = await tx.batchVersion.aggregate({ where: { batchId }, _max: { version: true } });
        const revisionMaximum = await tx.batchDraftRevision.aggregate({ where: { batchId }, _max: { revision: true } });
        draft = await tx.batchVersion.create({ data: { batchId, version: (maximum._max.version ?? 0) + 1, revision: (revisionMaximum._max.revision ?? 0) + 1, ...jsonData } });
      }
      await tx.batch.update({ where: { id: batchId }, data: { name: body.batchName } });
      await tx.batchDraftRevision.create({ data: { organizationId: batch.organizationId, batchId, revision: draft.revision, batchName: body.batchName, graph: body.graph as Prisma.InputJsonValue, inputSchema: body.inputSchema as Prisma.InputJsonValue, outputSchema: body.outputSchema as Prisma.InputJsonValue, actorId: userId } });
      await tx.auditEvent.create({ data: { organizationId: batch.organizationId, actorId: userId, action: "batch.draft.saved", resourceType: "BatchDraft", resourceId: batchId, metadata: { revision: draft.revision, configHash } } });
      return { conflict: false as const, unchanged: false as const, draft, batchName: body.batchName };
    });
    if (result.conflict) return NextResponse.json({ error: "Draft modificato da un'altra sessione. Ricarica o ripristina la revisione più recente.", currentRevision: result.currentRevision }, { status: 409 });
    return NextResponse.json(batchDraftResponseSchema.parse(responseData(result.draft, result.batchName)), { status: body.expectedRevision === null && !result.unchanged ? 201 : 200 });
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return NextResponse.json({ error: "Il draft supera il limite di 5 MiB." }, { status: 413 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: "JSON del draft non valido." }, { status: 400 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "Salvataggio concorrente rilevato. Ricarica il draft.", currentRevision: null }, { status: 409 });
    return validationError(error);
  }
}

export async function POST(request: NextRequest, context: Context) { return PUT(request, context); }
export async function PATCH(request: NextRequest, context: Context) { return PUT(request, context); }
