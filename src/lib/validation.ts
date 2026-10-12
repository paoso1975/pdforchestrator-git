import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function validationError(error: unknown, requestId?: string) {
  if (error instanceof ZodError) {
    return NextResponse.json({ error: "Dati non validi.", issues: error.issues }, { status: 400 });
  }
  console.error("API request failed", { requestId, error });
  return NextResponse.json({ error: "Errore interno." }, { status: 500 });
}

export function unauthorized() {
  return NextResponse.json({ error: "Autenticazione richiesta." }, { status: 401 });
}

export function forbidden() {
  return NextResponse.json({ error: "Accesso non consentito." }, { status: 403 });
}
