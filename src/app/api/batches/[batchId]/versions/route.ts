import { Prisma } from "@/generated/prisma/client";
import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getAuthenticatedUserId } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { batchVersionCreateSchema, batchVersionSchema, uuidSchema } from "@/lib/schemas/api";
import { forbidden, unauthorized, validationError } from "@/lib/validation";
import { validateGraphDiagnostics, type BatchEdge, type BatchNode, type GraphDiagnostic } from "@/lib/batch-graph";
import { compileGraph, stableStringify } from "@/lib/blocks/compiler";
import { getBlockDefinition } from "@/lib/blocks/registry";
import { generateApiDefinition, makeOutputSchema, parametersFromSchema } from "@/lib/api-schema";

export const runtime = "nodejs";

type Context = { params: Promise<{ batchId: string }> };

export async function GET(_request: NextRequest, context: Context) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) return unauthorized();
    const batchId = uuidSchema.parse((await context.params).batchId);
    const batch = await prisma.batch.findFirst({
      where: { id: batchId, organization: { memberships: { some: { userId } } } },
      select: { id: true },
    });
    if (!batch) return NextResponse.json({ error: "Batch non trovato." }, { status: 404 });
    const versions = await prisma.batchVersion.findMany({ where: { batchId }, orderBy: { version: "desc" } });
    return NextResponse.json(batchVersionSchema.array().parse(versions));
  } catch (error) {
    return validationError(error);
  }
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const userId = await getAuthenticatedUserId();
    if (!userId) return unauthorized();
    const batchId = uuidSchema.parse((await context.params).batchId);
    const body = batchVersionCreateSchema.parse(await request.json());
    if (!body.publish) return NextResponse.json({ error: "Per creare o aggiornare una bozza usa PUT /api/batches/{batchId}/draft." }, { status: 400 });
    const nodes = (body.graph && typeof body.graph === "object" && "nodes" in body.graph && Array.isArray(body.graph.nodes)) ? body.graph.nodes : [];
    const graphRecord = body.graph && typeof body.graph === "object" ? body.graph as Record<string, unknown> : {};
    const edges = "edges" in graphRecord && Array.isArray(graphRecord.edges) ? graphRecord.edges : [];
    const typedNodes = nodes as unknown as BatchNode[];
    const typedEdges = edges as unknown as BatchEdge[];
    const apiDefinition = generateApiDefinition(typedNodes, parametersFromSchema(body.inputSchema));
    if (apiDefinition.issues.length) {
      const diagnostics: GraphDiagnostic[] = apiDefinition.issues.map((issue) => ({ code: issue.code, message: issue.message, severity: "error", ...(issue.nodeId ? { nodeId: issue.nodeId } : {}) }));
      return NextResponse.json({ error: "Lo schema API contiene input non validi.", issues: diagnostics.map((item) => item.message), diagnostics }, { status: 400 });
    }
    const inputSchema = apiDefinition.inputSchema;
    const outputSchema = makeOutputSchema();
    const graphDiagnostics = validateGraphDiagnostics(typedNodes, typedEdges);
    if (graphDiagnostics.length) return NextResponse.json({ error: "Il batch non supera la validazione.", issues: graphDiagnostics.map((item) => item.message), diagnostics: graphDiagnostics }, { status: 400 });
    const requestedTools = nodes.flatMap((node) => {
      if (!node || typeof node !== "object" || !("toolId" in node) || typeof node.toolId !== "string") return [];
      const version = "toolVersion" in node && typeof node.toolVersion === "string" ? node.toolVersion : "1.0.0";
      return [{ id: node.toolId, version }];
    });
    for (const tool of requestedTools) {
      if (!getBlockDefinition(tool.id, tool.version)) {
        return NextResponse.json({ error: `Strumento non riconosciuto: ${tool.id}@${tool.version}.` }, { status: 400 });
      }
    }
    const membership = await prisma.organizationMembership.findFirst({
      where: { userId, organization: { batches: { some: { id: batchId } } } },
      select: { role: true },
    });
    if (!membership || !["OWNER", "ADMIN", "DESIGNER"].includes(membership.role)) return forbidden();

    const batch = await prisma.batch.findUnique({ where: { id: batchId }, select: { id: true, organizationId: true, name: true, updatedAt: true } });
    if (!batch) return NextResponse.json({ error: "Batch non trovato." }, { status: 404 });
    const ifMatch = request.headers.get("if-match")?.match(/^"(.+)"$/)?.[1];
    if (!ifMatch || Number.isNaN(Date.parse(ifMatch))) {
      return NextResponse.json({ error: "Precondizione If-Match con updatedAt ISO richiesta.", updatedAt: batch.updatedAt }, { status: 428 });
    }

    let compiledPlan;
    try {
      const inputProperties = inputSchema.properties as Record<string, unknown>;
      const apiParameterTypes = Object.fromEntries(Object.entries(inputProperties).flatMap(([name, property]) => {
        const type = property && typeof property === "object" && "type" in property ? property.type : undefined;
        return typeof type === "string" ? [[name, type === "integer" ? "number" : type]] : [];
      }));
      const apiRequired = new Set(inputSchema.required);
      const apiParameterManifest = Object.entries(inputProperties).map(([name, property]) => {
        const spec = property && typeof property === "object" ? property as Record<string, unknown> : {};
        const type = typeof spec.type === "string" ? (spec.type === "integer" ? "number" : spec.type) : "json";
        return { name, type, required: apiRequired.has(name), ...(Object.hasOwn(spec, "default") ? { defaultValue: spec.default } : {}) };
      });
      const graphVariables = Array.isArray(graphRecord.variables) ? graphRecord.variables.filter((item): item is { name: string; type?: string; defaultValue?: unknown } => Boolean(item && typeof item === "object" && "name" in item && typeof item.name === "string")) : [];
      const variableTypes = Object.fromEntries(graphVariables.flatMap((item) => typeof item.type === "string" ? [[item.name, item.type]] : []));
      const variableManifest = graphVariables.flatMap((item) => typeof item.type === "string" ? [{ name: item.name, type: item.type, required: false, ...(Object.hasOwn(item, "defaultValue") ? { defaultValue: item.defaultValue } : {}) }] : []);
      compiledPlan = compileGraph(typedNodes, typedEdges, { apiParameters: Object.keys(inputProperties), variables: graphVariables.map((item) => item.name), apiParameterTypes, variableTypes, apiParameterManifest, variableManifest });
    } catch (error) {
      const issues = error instanceof Error && "issues" in error ? (error as { issues: string[] }).issues : ["Il grafo non può essere compilato."];
      const diagnostics: GraphDiagnostic[] = error instanceof Error && "diagnostics" in error ? (error as { diagnostics: GraphDiagnostic[] }).diagnostics : [];
      if (!diagnostics.length) for (const message of issues) {
        const node = typedNodes.find((item) => item.data?.label && message.startsWith(`${item.data.label}:`));
        diagnostics.push({ code: "NODE_COMPILE_ERROR", message, severity: "error", ...(node ? { nodeId: node.id } : {}) });
      }
      return NextResponse.json({ error: "Compilazione del batch non riuscita.", issues, diagnostics }, { status: 400 });
    }
    // Keep the existing JSON manifest field and make it a versioned, executable plan.
    const toolManifest = { ...compiledPlan, graph: body.graph };
    const hashInput = stableStringify({ graph: body.graph, inputSchema, outputSchema, toolManifest });
    const configHash = createHash("sha256").update(hashInput).digest("hex");
    const result = await prisma.$transaction(async (tx) => {
      const write = await tx.batch.updateMany({ where: { id: batchId, organizationId: batch.organizationId, updatedAt: new Date(ifMatch) }, data: { updatedAt: new Date(), ...(body.batchName ? { name: body.batchName } : {}) } });
      if (write.count === 0) return { conflict: true as const };
      const current = await tx.batchVersion.aggregate({ where: { batchId }, _max: { version: true } });
      if (body.publish) await tx.batchVersion.deleteMany({ where: { batchId, publishedAt: null } });
      const data = {
        graph: body.graph as Prisma.InputJsonValue,
        inputSchema: inputSchema as Prisma.InputJsonValue,
        outputSchema: outputSchema as Prisma.InputJsonValue,
        toolManifest: JSON.parse(JSON.stringify(toolManifest)) as Prisma.InputJsonValue,
        configHash,
      };
      let created;
      if (!body.publish) {
        const draft = await tx.batchVersion.findFirst({ where: { batchId, publishedAt: null }, orderBy: { version: "desc" } });
        if (draft) created = await tx.batchVersion.update({ where: { id: draft.id }, data });
      }
      if (!created) {
        created = await tx.batchVersion.create({ data: {
          batchId,
          version: (current._max.version ?? 0) + 1,
          ...data,
          publishedAt: body.publish ? new Date() : null,
        } });
      }
      if (body.publish) {
        await tx.batch.update({ where: { id: batchId }, data: { activeVersionId: created.id, status: "PUBLISHED" } });
        const previousSnapshot = await tx.batchDraftRevision.findFirst({ where: { organizationId: batch.organizationId, batchId }, orderBy: { revision: "desc" } });
        const publishedBatchName = body.batchName ?? batch.name;
        const sameSnapshot = previousSnapshot && JSON.stringify({ graph: previousSnapshot.graph, inputSchema: previousSnapshot.inputSchema, outputSchema: previousSnapshot.outputSchema, batchName: previousSnapshot.batchName }) === JSON.stringify({ graph: body.graph, inputSchema, outputSchema, batchName: publishedBatchName });
        if (!sameSnapshot) await tx.batchDraftRevision.create({ data: { organizationId: batch.organizationId, batchId, revision: (previousSnapshot?.revision ?? 0) + 1, batchName: publishedBatchName, graph: body.graph as Prisma.InputJsonValue, inputSchema: inputSchema as Prisma.InputJsonValue, outputSchema: outputSchema as Prisma.InputJsonValue, actorId: userId } });
        await tx.auditEvent.create({ data: { organizationId: batch.organizationId, actorId: userId, action: "batch.published", resourceType: "BatchVersion", resourceId: created.id, metadata: { batchId, version: created.version, configHash } } });
      }
      return { conflict: false as const, version: created };
    });
    if (result.conflict) return NextResponse.json({ error: "Il batch è stato modificato da un'altra sessione. Ricarica la versione più recente.", updatedAt: batch.updatedAt }, { status: 412 });
    const version = result.version;
    return NextResponse.json(batchVersionSchema.parse(version), { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Versione concorrente rilevata. Riprova." }, { status: 409 });
    }
    return validationError(error);
  }
}
