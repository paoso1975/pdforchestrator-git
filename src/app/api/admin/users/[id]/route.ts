import { NextResponse, type NextRequest } from "next/server";
import { getCurrentAdminId, isCurrentUserAdmin } from "@/lib/admin-auth";
import { syncProfile, toManagedUser } from "@/lib/admin-users";
import { prisma } from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
type RouteContext = { params: Promise<{ id: string }> };

function unauthorized() {
  return NextResponse.json({ error: "Accesso riservato agli amministratori." }, { status: 403 });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  if (!await isCurrentUserAdmin()) return unauthorized();
  const { id } = await context.params;
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Dati non validi." }, { status: 400 });

  const fields = body as Record<string, unknown>;
  if (fields.email !== undefined && (typeof fields.email !== "string" || !/^\S+@\S+\.\S+$/.test(fields.email.trim()))) {
    return NextResponse.json({ error: "Inserisci un indirizzo email valido." }, { status: 400 });
  }
  if (fields.displayName !== undefined && (typeof fields.displayName !== "string" || fields.displayName.trim().length > 100)) {
    return NextResponse.json({ error: "Il nome può contenere al massimo 100 caratteri." }, { status: 400 });
  }
  if (fields.role !== undefined && fields.role !== "user" && fields.role !== "admin") {
    return NextResponse.json({ error: "Ruolo non valido." }, { status: 400 });
  }
  if (fields.email === undefined && fields.displayName === undefined && fields.role === undefined) {
    return NextResponse.json({ error: "Nessun campo da aggiornare." }, { status: 400 });
  }
  if (id === await getCurrentAdminId() && fields.role === "user") {
    return NextResponse.json({ error: "Non puoi rimuovere il tuo ruolo di amministratore." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: found, error: getError } = await admin.auth.admin.getUserById(id);
  if (getError || !found.user) return NextResponse.json({ error: "Utente non trovato." }, { status: 404 });
  const user = found.user;
  const { data, error } = await admin.auth.admin.updateUserById(id, {
    ...(typeof fields.email === "string" ? { email: fields.email.trim() } : {}),
    ...(typeof fields.displayName === "string" ? {
      user_metadata: { ...user.user_metadata, display_name: fields.displayName.trim() },
    } : {}),
    ...(fields.role === "user" || fields.role === "admin" ? {
      app_metadata: { ...user.app_metadata, role: fields.role },
    } : {}),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await syncProfile(data.user);
  return NextResponse.json({ user: toManagedUser(data.user) });
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  if (!await isCurrentUserAdmin()) return unauthorized();
  const { id } = await context.params;
  if (id === await getCurrentAdminId()) return NextResponse.json({ error: "Non puoi eliminare il tuo account amministratore." }, { status: 400 });

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await prisma.userProfile.deleteMany({ where: { id } });
  return NextResponse.json({ success: true });
}
