import { NextResponse } from "next/server";
import { ZodError } from "zod";

/** Credential endpoints deliberately avoid logging exception messages or request bodies. */
export function credentialApiError(error: unknown) {
  if (error instanceof ZodError) return NextResponse.json({ error: "Dati non validi.", issues: error.issues.map(({ path, message, code }) => ({ path, message, code })) }, { status: 400 });
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code.slice(0, 40) : "UNEXPECTED_ERROR";
  console.error("credential_api_request_failed", { errorCode: code });
  return NextResponse.json({ error: "Operazione credenziale non riuscita." }, { status: 500 });
}
