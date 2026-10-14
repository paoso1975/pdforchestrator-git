import { z } from "zod";

export type PdfFileReference = { fileId: string; path: string };
export type PdfInputFileRecord = {
  id: string;
  organizationId: string;
  credentialId?: string | null;
  kind: string;
  uploadState: string;
  expiresAt: Date | null;
};

export type PdfFileValidationError = {
  status: 400 | 409;
  code: "INVALID_FILE_REFERENCE" | "FILE_NOT_FOUND" | "FILE_NOT_AUTHORIZED" | "FILE_NOT_UPLOADED" | "FILE_EXPIRED" | "FILE_UNAVAILABLE";
  message: string;
  fileId?: string;
};

/**
 * PDF file references are discovered only from explicit PDF media types or the
 * legacy x-file-reference marker. A UUID in an ordinary string field is data,
 * not a storage reference.
 */
export function collectPdfFileReferences(input: unknown, publishedSchema: unknown): PdfFileReference[] {
  const references: PdfFileReference[] = [];

  const visit = (value: unknown, rawSchema: unknown, path: string): void => {
    if (!rawSchema || typeof rawSchema !== "object" || Array.isArray(rawSchema)) return;
    const schema = rawSchema as {
      type?: string;
      contentMediaType?: string;
      "x-file-reference"?: boolean;
      properties?: Record<string, unknown>;
      items?: unknown;
    };
    const isFile = schema.contentMediaType === "application/pdf" || schema["x-file-reference"] === true;
    if (isFile) {
      const parsed = z.string().uuid().safeParse(value);
      if (!parsed.success) throw new PdfFileReferenceError({
        status: 400,
        code: "INVALID_FILE_REFERENCE",
        message: `Il campo ${path} deve contenere l'ID UUID di un file PDF caricato.`,
      });
      references.push({ fileId: parsed.data, path });
      return;
    }
    if (schema.type === "array" && Array.isArray(value)) {
      value.forEach((item, index) => visit(item, schema.items, `${path}[${index}]`));
      return;
    }
    if (schema.type === "object" && value !== null && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      for (const [key, child] of Object.entries(record)) {
        if (Object.hasOwn(schema.properties ?? {}, key)) visit(child, schema.properties?.[key], path ? `${path}.${key}` : key);
      }
    }
  };

  visit(input, publishedSchema, "input");
  return references;
}

export class PdfFileReferenceError extends Error {
  readonly status: PdfFileValidationError["status"];
  readonly code: PdfFileValidationError["code"];
  readonly fileId?: string;

  constructor(details: PdfFileValidationError) {
    super(details.message);
    this.name = "PdfFileReferenceError";
    this.status = details.status;
    this.code = details.code;
    this.fileId = details.fileId;
  }
}

/** Validates tenant, ownership, upload and expiry state; null expiry means no expiry. */
export function validatePdfInputFileRecords<T extends PdfInputFileRecord>(
  references: PdfFileReference[],
  records: T[],
  options: { organizationId: string; credentialId?: string | null; now?: Date },
): { valid: true; files: T[] } | { valid: false; error: PdfFileValidationError } {
  const byId = new Map(records.map((record) => [record.id, record]));
  const uniqueIds = [...new Set(references.map(({ fileId }) => fileId))];
  const now = options.now ?? new Date();
  for (const fileId of uniqueIds) {
    const file = byId.get(fileId);
    if (!file) return { valid: false, error: { status: 400, code: "FILE_NOT_FOUND", fileId, message: `File PDF non trovato: ${fileId}.` } };
    if (file.organizationId !== options.organizationId || (options.credentialId !== undefined && file.credentialId !== options.credentialId)) {
      return { valid: false, error: { status: 400, code: "FILE_NOT_AUTHORIZED", fileId, message: "Uno o più file non appartengono all'organizzazione o alla credenziale autorizzata." } };
    }
    if (file.kind !== "INPUT" || file.uploadState !== "UPLOADED") {
      return { valid: false, error: { status: 409, code: "FILE_NOT_UPLOADED", fileId, message: `Il file ${fileId} non è un input caricato e pronto.` } };
    }
    if (file.expiresAt !== null && file.expiresAt.getTime() <= now.getTime()) {
      return { valid: false, error: { status: 409, code: "FILE_EXPIRED", fileId, message: `Il file ${fileId} è scaduto.` } };
    }
  }
  return { valid: true, files: uniqueIds.map((id) => byId.get(id)!) };
}
