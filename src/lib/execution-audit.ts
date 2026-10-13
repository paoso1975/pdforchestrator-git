import { randomUUID } from "node:crypto";

const MAX_AUDIT_BYTES = 64 * 1024;
const MAX_STRING_LENGTH = 8_000;
const MAX_COLLECTION_ITEMS = 250;
const SECRET_KEY = /(secret|password|passwd|token|authorization|api[-_]?key|access[-_]?key|private[-_]?key)/i;

export function safeExecutionLogValue(value: unknown): unknown {
  const visit = (current: unknown, depth: number, key?: string): unknown => {
    if (key && SECRET_KEY.test(key)) return "[REDACTED]";
    if (depth > 12) return "[DEPTH_LIMIT]";
    if (typeof current === "string") return current.length > MAX_STRING_LENGTH ? `${current.slice(0, MAX_STRING_LENGTH)}…[TRUNCATED]` : current;
    if (Array.isArray(current)) return current.slice(0, MAX_COLLECTION_ITEMS).map((item) => visit(item, depth + 1));
    if (current !== null && typeof current === "object") {
      return Object.fromEntries(Object.entries(current).slice(0, MAX_COLLECTION_ITEMS).map(([name, child]) => [name, visit(child, depth + 1, name)]));
    }
    return current;
  };

  const safe = visit(value, 0);
  const serialized = JSON.stringify(safe);
  if (!serialized || Buffer.byteLength(serialized, "utf8") <= MAX_AUDIT_BYTES) return safe;
  return { truncated: true, preview: serialized.slice(0, MAX_AUDIT_BYTES / 2), originalBytes: Buffer.byteLength(serialized, "utf8") };
}

export function buildExecutionRequestString(input: {
  method: string;
  path: string;
  origin: string;
  requestId: string;
  idempotencyKey: string | null;
  input: unknown;
}): string {
  const lines = [
    `${input.method} ${input.path}`,
    `Provenienza: ${input.origin}`,
    `Request ID: ${input.requestId}`,
    ...(input.idempotencyKey ? [`Idempotency-Key: ${input.idempotencyKey}`] : []),
    "Content-Type: application/json",
    "",
    JSON.stringify(safeExecutionLogValue({ input: input.input }), null, 2),
  ];
  const result = lines.join("\n");
  return Buffer.byteLength(result, "utf8") <= MAX_AUDIT_BYTES ? result : `${result.slice(0, MAX_AUDIT_BYTES / 2)}\n… [richiesta abbreviata per limite log]`;
}

export function executionRequestId(header: string | null): string {
  return header && /^[A-Za-z0-9._:-]{1,128}$/.test(header) ? header : randomUUID();
}
