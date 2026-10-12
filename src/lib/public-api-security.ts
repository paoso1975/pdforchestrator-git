export function isSecurePublicRequest(request: Request, environment = process.env.NODE_ENV): boolean {
  if (environment !== "production") return true;
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim().toLowerCase();
  return forwardedProto === "https" || new URL(request.url).protocol === "https:";
}

export function parseIdempotencyKey(value: string | null): { key?: string; error?: string } {
  if (value === null) return {};
  if (value.length < 1 || value.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(value)) return { error: "Idempotency-Key non valida: usare 1–128 caratteri ASCII alfanumerici, punto, trattino, underscore o due punti." };
  return { key: value };
}

export function versionScopeAllows(versionIds: readonly string[], versionId: string): boolean {
  return versionIds.length === 0 || versionIds.includes(versionId);
}

export function positiveIntegerConfig(raw: string | undefined, fallback: number): number {
  const parsed = raw ? Number.parseInt(raw, 10) : fallback;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function positiveBigIntConfig(raw: string | undefined, fallback: bigint): bigint {
  if (!raw || !/^\d+$/.test(raw)) return fallback;
  try { const parsed = BigInt(raw); return parsed > BigInt(0) ? parsed : fallback; } catch { return fallback; }
}

export function safeRequestId(value: string | null, fallback: () => string): string {
  return value && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : fallback();
}
export const publicBatchSlugSchema = z.string().trim().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/i, "Slug batch non valido.");

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

import { z } from "zod";

