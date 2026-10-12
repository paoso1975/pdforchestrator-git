import "server-only";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { authenticatePublicRequest, consumeRequestLimit } from "@/lib/public-api-auth";
import { PayloadTooLargeError, readBoundedRequestBytes } from "@/lib/http-body";
import { isSecurePublicRequest, safeRequestId } from "@/lib/public-api-security";

export async function authorizePublicRequest(request: Request, body: Uint8Array, isJob = false) {
  const requestId = safeRequestId(request.headers.get("x-request-id"), randomUUID);
  if (!isSecurePublicRequest(request)) return { response: NextResponse.json({ error: "L'API richiede una connessione HTTPS.", requestId }, { status: 400, headers: { "x-request-id": requestId } }) };
  const result = await authenticatePublicRequest(request, body);
  if ("status" in result) {
    console.warn("public_api_auth_rejected", { requestId, status: result.status });
    return { response: NextResponse.json({ error: result.error, requestId }, { status: result.status, headers: { "x-request-id": requestId } }) };
  }
  if (!(await consumeRequestLimit(result.credential.id, isJob))) {
    console.warn("public_api_rate_limited", { requestId, credentialId: result.credential.id });
    return { response: NextResponse.json({ error: "Limite richieste superato.", requestId }, { status: 429, headers: { "retry-after": "60", "x-request-id": requestId } }) };
  }
  return { credential: result.credential, requestId };
}

export async function readBody(request: Request) {
  try { return { bytes: await readBoundedRequestBytes(request, 1_048_576) }; }
  catch (error) {
    if (error instanceof PayloadTooLargeError) return { bytes: new Uint8Array(), error: NextResponse.json({ error: "Body oltre il limite di 1 MiB." }, { status: 413 }) };
    throw error;
  }
}

export function publicApiError(error: unknown, request: Request) {
  const requestId = safeRequestId(request.headers.get("x-request-id"), randomUUID);
  if (error instanceof ZodError) return NextResponse.json({ error: "Dati non validi.", issues: error.issues.map(({ path, message, code }) => ({ path, message, code })), requestId }, { status: 400, headers: { "x-request-id": requestId } });
  const errorCode = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code.slice(0, 40) : "UNEXPECTED_ERROR";
  console.error("public_api_request_failed", { requestId, errorCode });
  return NextResponse.json({ error: "Errore interno.", requestId }, { status: 500, headers: { "x-request-id": requestId } });
}

