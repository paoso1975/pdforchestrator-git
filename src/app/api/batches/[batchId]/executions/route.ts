import { Prisma } from "@/generated/prisma/client";
import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthenticatedUserId } from "@/lib/api-auth";
import { buildExecutionRequestString, executionRequestId, safeExecutionLogValue } from "@/lib/execution-audit";
import { prisma } from "@/lib/prisma";
import { createStorageClient } from "@/lib/storage";
import { verifyStoredPdfUpload } from "@/lib/upload-verification";
import { collectPdfFileReferences, PdfFileReferenceError, validatePdfInputFileRecords } from "@/lib/pdf-file-references";
import { validationError } from "@/lib/validation";

export const runtime = "nodejs";
type Context = { params: Promise<{ batchId: string }> };
const requestSchema = z.object({ input: z.record(z.string(), z.unknown()) }).strict();

function validateJsonSchema(value: unknown, schema: unknown): string[] {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return [];
  const s = schema as { type?: string; properties?: Record<string, { type?: string; minimum?: number; maximum?: number; minLength?: number; maxLength?: number; enum?: unknown[]; format?: string; contentMediaType?: string; items?: { type?: string } }>; required?: string[]; additionalProperties?: boolean };
  const errors: string[] = [];
  if (s.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return ["L'input deve essere un oggetto."];
    const record = value as Record<string, unknown>;
    for (const key of s.required ?? []) if (!(key in record)) errors.push(`Parametro obbligatorio mancante: ${key}.`);
    if (s.additionalProperties === false) for (const key of Object.keys(record)) if (!(key in (s.properties ?? {}))) errors.push(`Parametro sconosciuto: ${key}.`);
    for (const [key, val] of Object.entries(record)) {
      const field = s.properties?.[key]; if (!field) continue;
      if ((field.type === "number" || field.type === "integer") && (typeof val !== "number" || !Number.isFinite(val) || (field.type === "integer" && !Number.isInteger(val)) || (field.minimum !== undefined && val < field.minimum) || (field.maximum !== undefined && val > field.maximum))) errors.push(field.type === "integer" ? `Il parametro ${key} deve essere un numero intero compreso nei limiti.` : `Valore non valido per ${key}.`);
      if (field.type === "boolean" && typeof val !== "boolean") errors.push(`Valore non valido per ${key}.`);
      if (field.type === "string") {
        if (typeof val !== "string" || (field.minLength !== undefined && val.length < field.minLength) || (field.maxLength !== undefined && val.length > field.maxLength) || (field.enum && !field.enum.includes(val))) errors.push(`Valore non valido per ${key}.`);
        if (field.contentMediaType === "application/pdf" && (typeof val !== "string" || !z.string().uuid().safeParse(val).success)) errors.push(`Il parametro file ${key} deve contenere un fileId UUID del filesystem.`);
      }
      if (field.type === "array" && (!Array.isArray(val) || (field.items?.type === "string" && val.some((item) => typeof item !== "string")) || (field.items?.type === "number" && val.some((item) => typeof item !== "number" || !Number.isFinite(item))))) errors.push(`Valore non valido per ${key}.`);
    }
  }
  return errors;
}

export async function POST(request: NextRequest, context: Context) {
  try {
    const userId = await getAuthenticatedUserId();
    const { batchId } = await context.params;
    const body = requestSchema.parse(await request.json());
    const batch = await prisma.batch.findFirst({ where: { id: batchId, status: "PUBLISHED", activeVersion: { isNot: null } }, include: { activeVersion: true } });
    if (!batch?.activeVersion) return NextResponse.json({ error: "Batch pubblicato non trovato." }, { status: 404 });
    let credentialId: string | null = null;
    const membership = userId ? await prisma.organizationMembership.findFirst({ where: { organizationId: batch.organizationId, userId, role: { in: ["OWNER", "ADMIN", "OPERATOR"] } }, select: { userId: true } }) : null;
    if (!membership) {
      const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
      if (!bearer || bearer.length > 512) return NextResponse.json({ error: "Ruolo operator o API credential richiesti." }, { status: 403 });
      const tokenHash = createHash("sha256").update(bearer).digest("hex");
      const credential = await prisma.apiCredential.findFirst({ where: { tokenHash, keyId: null, organizationId: batch.organizationId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }], grants: { some: { batchId } } }, select: { id: true } });
      if (!credential) return NextResponse.json({ error: "Credential non valido o senza grant per questo batch." }, { status: 401 });
      credentialId = credential.id;
      await prisma.apiCredential.update({ where: { id: credential.id }, data: { lastUsedAt: new Date() } });
    }
    const issues = validateJsonSchema(body.input, batch.activeVersion.inputSchema);
    if (issues.length) return NextResponse.json({ error: "Input non valido.", issues }, { status: 400 });
    let fileReferences;
    try { fileReferences = collectPdfFileReferences(body.input, batch.activeVersion.inputSchema); }
    catch (error) {
      if (error instanceof PdfFileReferenceError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
      throw error;
    }
    const fileIds = [...new Set(fileReferences.map(({ fileId }) => fileId))];
    if (fileIds.length) {
      const files = await prisma.storedFile.findMany({ where: { id: { in: fileIds } } });
      const validation = validatePdfInputFileRecords(fileReferences, files, { organizationId: batch.organizationId });
      if (!validation.valid) return NextResponse.json({ error: validation.error.message, code: validation.error.code }, { status: validation.error.status });
      const storage = createStorageClient();
      for (const file of validation.files) {
        try {
          const verification = await verifyStoredPdfUpload(storage, file);
          if (!verification.valid) return NextResponse.json({ error: `File non valido o incompleto: ${file.filename}.`, code: verification.reason }, { status: 409 });
        } catch { return NextResponse.json({ error: `Upload non disponibile su Cubbit: ${file.filename}.`, code: "FILE_UNAVAILABLE" }, { status: 409 }); }
      }
    }
    const idempotencyKey = request.headers.get("idempotency-key")?.slice(0, 200) ?? null;
    if (idempotencyKey) {
      const previous = await prisma.batchExecution.findFirst({ where: { organizationId: batch.organizationId, idempotencyKey } });
      if (previous) {
        if (previous.batchId !== batch.id || JSON.stringify(previous.input) !== JSON.stringify(body.input)) return NextResponse.json({ error: "Chiave di idempotenza già associata a un'altra richiesta." }, { status: 409 });
        return NextResponse.json(previous, { status: 200 });
      }
    }
    const origin = credentialId ? "API_CREDENTIAL" : "DASHBOARD_SESSION";
    const requestId = executionRequestId(request.headers.get("x-request-id"));
    const requestPath = request.nextUrl.pathname;
    const executionString = buildExecutionRequestString({ method: request.method, path: requestPath, origin, requestId, idempotencyKey, input: body.input });
    const created = await prisma.batchExecution.create({ data: {
      organizationId: batch.organizationId,
      batchId: batch.id,
      batchVersionId: batch.activeVersion.id,
      status: "QUEUED",
      input: body.input as Prisma.InputJsonValue,
      origin,
      requestId,
      requestMethod: request.method,
      requestPath,
      executionString,
      ...(membership ? { requestedByUserId: userId! } : {}),
      ...(credentialId ? { credentialId } : {}),
      ...(idempotencyKey ? { idempotencyKey } : {}),
      events: { create: { type: "QUEUED", payload: { source: origin, requestId, requestMethod: request.method, requestPath, idempotencyKey, input: safeExecutionLogValue(body.input) } as Prisma.InputJsonValue } },
    } });
    return NextResponse.json(created, { status: 202 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "Chiave di idempotenza già usata." }, { status: 409 });
    return validationError(error);
  }
}
