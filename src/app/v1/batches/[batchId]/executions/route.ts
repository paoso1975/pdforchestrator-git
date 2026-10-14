import { Prisma } from "@/generated/prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createStorageClient } from "@/lib/storage";
import { authorizePublicRequest, publicApiError, readBody } from "@/lib/public-api";
import { applySchemaDefaults } from "@/lib/api-schema";
import { canonicalJson, parseIdempotencyKey, positiveIntegerConfig, publicBatchSlugSchema } from "@/lib/public-api-security";
import { verifyStoredPdfUpload } from "@/lib/upload-verification";
import { credentialCanAccessBatchVersion } from "@/lib/credential-scopes";
import { buildExecutionRequestString, safeExecutionLogValue } from "@/lib/execution-audit";
import { collectPdfFileReferences, PdfFileReferenceError, validatePdfInputFileRecords } from "@/lib/pdf-file-references";

export const runtime = "nodejs";
type Context = { params: Promise<{ batchId: string }> };
const requestSchema = z.object({ input: z.record(z.string(), z.unknown()) }).strict();
function validateValue(value: unknown, schema: unknown, path: string): string[] {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return [];
  const spec = schema as { type?: string; properties?: Record<string, unknown>; required?: string[]; additionalProperties?: boolean; enum?: unknown[]; minimum?: number; maximum?: number; minLength?: number; maxLength?: number; minItems?: number; maxItems?: number; pattern?: string; format?: string; contentMediaType?: string; uniqueItems?: boolean; items?: unknown };
  const invalid = () => [`Valore non valido per ${path}`];
  if (spec.enum && !spec.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) return invalid();
  if (spec.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
    const record = value as Record<string, unknown>; const errors: string[] = [];
    for (const key of spec.required ?? []) if (!Object.hasOwn(record, key)) errors.push(`Parametro obbligatorio mancante: ${path}${path ? "." : ""}${key}`);
    if (spec.additionalProperties === false) for (const key of Object.keys(record)) if (!(key in (spec.properties ?? {}))) errors.push(`Parametro non previsto: ${path}${path ? "." : ""}${key}`);
    for (const [key, item] of Object.entries(record)) if (spec.properties?.[key]) errors.push(...validateValue(item, spec.properties[key], `${path}${path ? "." : ""}${key}`));
    return errors;
  }
  if (spec.type === "array") {
    if (!Array.isArray(value) || (spec.minItems !== undefined && value.length < spec.minItems) || (spec.maxItems !== undefined && value.length > spec.maxItems)) return invalid();
    if (spec.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) return invalid();
    return spec.items ? value.flatMap((item, index) => validateValue(item, spec.items, `${path}[${index}]`)) : [];
  }
  if (spec.type === "string") {
    let patternValid = true;
    if (spec.pattern !== undefined) { try { patternValid = new RegExp(spec.pattern).test(value as string); } catch { patternValid = false; } }
    if (typeof value !== "string" || (spec.minLength !== undefined && value.length < spec.minLength) || (spec.maxLength !== undefined && value.length > spec.maxLength) || !patternValid) return invalid();
    if (spec.contentMediaType === "application/pdf" && !z.string().uuid().safeParse(value).success) return [`${path} deve essere un fileId UUID del filesystem`];
    if (spec.format === "date-time" && !Number.isFinite(Date.parse(value))) return invalid();
    return [];
  }
  if (spec.type === "number" || spec.type === "integer") return typeof value !== "number" || !Number.isFinite(value) || (spec.type === "integer" && !Number.isInteger(value)) || (spec.minimum !== undefined && value < spec.minimum) || (spec.maximum !== undefined && value > spec.maximum) ? invalid() : [];
  if (spec.type === "boolean") return typeof value === "boolean" ? [] : invalid();
  if (spec.type === "null") return value === null ? [] : invalid();
  return [];
}
function schemaErrors(value: unknown, schema: unknown) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema) || (schema as { type?: string }).type !== "object") return ["Lo schema input pubblicato non è un oggetto valido"];
  return validateValue(value, schema, "input");
}

export async function POST(request: Request, context: Context) {
  try {
    const { bytes, error } = await readBody(request); if (error) return error;
    const auth = await authorizePublicRequest(request, bytes, true); if (auth.response) return auth.response;
    const selector = (await context.params).batchId;
    const isId = z.string().uuid().safeParse(selector).success;
    if (!isId) publicBatchSlugSchema.parse(selector);
    const url = new URL(request.url);
    const requestedVersionId = url.searchParams.has("versionId") ? z.string().uuid().parse(url.searchParams.get("versionId")) : null;
    let body: z.infer<typeof requestSchema>; try { body = requestSchema.parse(JSON.parse(new TextDecoder().decode(bytes))); } catch (cause) { return publicApiError(cause, request); }
    const batch = await prisma.batch.findFirst({ where: { ...(isId ? { id: selector } : { slug: selector }), organizationId: auth.credential.organizationId, status: "PUBLISHED" }, select: { id: true, name: true, activeVersionId: true } });
    if (!batch) return NextResponse.json({ error: "Batch non trovato o non autorizzato." }, { status: 404 });
    const batchId = batch.id;
    const versionId = requestedVersionId ?? batch.activeVersionId;
    const batchVersion = versionId ? await prisma.batchVersion.findFirst({ where: { id: versionId, batchId, publishedAt: { not: null } } }) : null;
    if (!batchVersion || !await credentialCanAccessBatchVersion(auth.credential.id, batchId, batchVersion.id)) return NextResponse.json({ error: "Batch non trovato o non autorizzato per questa versione." }, { status: 404 });
    const executionInput = applySchemaDefaults(body.input, batchVersion.inputSchema) as Record<string, unknown>;
    const issues = schemaErrors(executionInput, batchVersion.inputSchema); if (issues.length) return NextResponse.json({ error: "Input non valido.", issues }, { status: 400 });
    let fileReferences;
    try { fileReferences = collectPdfFileReferences(executionInput, batchVersion.inputSchema); }
    catch (cause) {
      if (cause instanceof PdfFileReferenceError) return NextResponse.json({ error: cause.message, code: cause.code }, { status: cause.status });
      throw cause;
    }
    const fileIds = [...new Set(fileReferences.map(({ fileId }) => fileId))];
    const records = fileIds.length ? await prisma.storedFile.findMany({ where: { id: { in: fileIds } } }) : [];
    const fileValidation = validatePdfInputFileRecords(fileReferences, records, { organizationId: auth.credential.organizationId, credentialId: auth.credential.id });
    if (!fileValidation.valid) return NextResponse.json({ error: fileValidation.error.message, code: fileValidation.error.code }, { status: fileValidation.error.status });
    const files = fileValidation.files;
    const storage = createStorageClient();
    for (const file of files) { try { const verification = await verifyStoredPdfUpload(storage, file); if (!verification.valid) return NextResponse.json({ error: "Upload non valido: dimensione, MIME, riferimento o firma PDF non corrispondono.", reason: verification.reason }, { status: 409 }); } catch { return NextResponse.json({ error: "Upload non disponibile sul server." }, { status: 409 }); } }
    const idempotency = parseIdempotencyKey(request.headers.get("idempotency-key"));
    if (idempotency.error) return NextResponse.json({ error: idempotency.error }, { status: 400 });
    const idempotencyKey = idempotency.key ?? null;
    if (idempotencyKey) { const previous = await prisma.batchExecution.findFirst({ where: { organizationId: auth.credential.organizationId, credentialId: auth.credential.id, idempotencyKey } }); if (previous) return previous.batchId === batchId && previous.batchVersionId === batchVersion.id && canonicalJson(previous.input) === canonicalJson(executionInput) ? NextResponse.json({ id: previous.id, runId: previous.id, status: previous.status, statusUrl: new URL(request.url).pathname.startsWith("/api/public/v1/") ? `/api/public/v1/runs/${previous.id}` : `/v1/executions/${previous.id}` }, { status: 200 }) : NextResponse.json({ error: "Chiave idempotenza già usata." }, { status: 409 }); }
    const concurrency = positiveIntegerConfig(process.env.PFO_MAX_CONCURRENT_JOBS, 10);
    const batchVersionId = batchVersion.id;
    const requestPath = new URL(request.url).pathname + (requestedVersionId ? `?versionId=${encodeURIComponent(requestedVersionId)}` : "");
    const executionString = buildExecutionRequestString({ method: request.method, path: requestPath, origin: "API_CREDENTIAL", requestId: auth.requestId, idempotencyKey, input: executionInput });
    const outcome = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "ApiCredential" WHERE "id" = ${auth.credential.id}::uuid FOR UPDATE`;
      if (idempotencyKey) {
        const previous = await tx.batchExecution.findFirst({ where: { organizationId: auth.credential.organizationId, credentialId: auth.credential.id, idempotencyKey }, select: { id: true, batchId: true, batchVersionId: true, input: true, status: true } });
        if (previous) return { kind: "existing" as const, matches: previous.batchId === batchId && previous.batchVersionId === batchVersion.id && canonicalJson(previous.input) === canonicalJson(executionInput), execution: { id: previous.id, status: previous.status, createdAt: null } };
      }
      const active = await tx.batchExecution.count({ where: { organizationId: auth.credential.organizationId, credentialId: auth.credential.id, status: { in: ["QUEUED", "RUNNING"] } } });
      if (active >= concurrency) return { kind: "limit" as const };
      const created = await tx.batchExecution.create({ data: {
        organizationId: auth.credential.organizationId,
        batchId,
        batchVersionId,
        credentialId: auth.credential.id,
        input: executionInput as Prisma.InputJsonValue,
        origin: "API_CREDENTIAL",
        requestId: auth.requestId,
        requestMethod: request.method,
        requestPath,
        executionString,
        ...(idempotencyKey ? { idempotencyKey } : {}),
        status: "QUEUED",
        events: { create: { type: "QUEUED", payload: { source: "API_CREDENTIAL", requestId: auth.requestId, requestMethod: request.method, requestPath, idempotencyKey, input: safeExecutionLogValue(executionInput) } as Prisma.InputJsonValue } },
      }, select: { id: true, status: true, createdAt: true } });
      await tx.auditEvent.create({ data: { organizationId: auth.credential.organizationId, action: "public.batch_run.queued", resourceType: "BatchExecution", resourceId: created.id, requestId: auth.requestId, metadata: { batchId, batchVersionId, credentialId: auth.credential.id, idempotent: Boolean(idempotencyKey) } } });
      if (files.length) {
        const retentionDays = Math.max(1, Number.parseInt(process.env.PFO_RETENTION_DAYS ?? "30", 10) || 30);
        await tx.storedFile.updateMany({ where: { id: { in: files.map((file) => file.id) } }, data: { expiresAt: new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000) } });
      }
      return { kind: "created" as const, execution: created };
    });
    if (outcome.kind === "limit") return NextResponse.json({ error: "Limite di job concorrenti superato." }, { status: 429 });
    if (outcome.kind === "existing" && !outcome.matches) return NextResponse.json({ error: "Chiave idempotenza già usata." }, { status: 409 });
    const publicPrefix = new URL(request.url).pathname.startsWith("/api/public/v1/");
    const execution = outcome.execution;
    return NextResponse.json({ ...execution, runId: execution.id, statusUrl: publicPrefix ? `/api/public/v1/runs/${execution.id}` : `/v1/executions/${execution.id}` }, { status: outcome.kind === "existing" ? 200 : 202 });
  } catch (cause) { if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002") return NextResponse.json({ error: "Chiave idempotenza già usata." }, { status: 409 }); return publicApiError(cause, request); }
}
