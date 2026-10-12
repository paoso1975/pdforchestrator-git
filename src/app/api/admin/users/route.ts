import { NextResponse, type NextRequest } from "next/server";
import { isCurrentUserAdmin } from "@/lib/admin-auth";
import { toManagedUser } from "@/lib/admin-users";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function unauthorized() {
  return NextResponse.json({ error: "Accesso riservato agli amministratori." }, { status: 403 });
}

export async function GET(request: NextRequest) {
  if (!await isCurrentUserAdmin()) return unauthorized();

  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") ?? 1));
  const perPage = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get("perPage") ?? 100)));
  const query = request.nextUrl.searchParams.get("q")?.trim().toLocaleLowerCase("it") ?? "";
  const admin = createAdminClient();
  const collected = [];
  let total: number | null = null;
  if (query) {
    for (let currentPage = 1; ; currentPage += 1) {
      const { data, error } = await admin.auth.admin.listUsers({ page: currentPage, perPage: 1000 });
      if (error) return NextResponse.json({ error: error.message }, { status: 502 });
      total = data.total ?? total;
      collected.push(...data.users);
      if (data.users.length < 1000) break;
    }
  } else {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) return NextResponse.json({ error: error.message }, { status: 502 });
    total = data.total ?? null;
    collected.push(...data.users);
  }

  const filtered = collected.map(toManagedUser).filter((user) =>
    !query || user.email?.toLocaleLowerCase("it").includes(query) || user.displayName.toLocaleLowerCase("it").includes(query),
  );
  const users = query ? filtered.slice((page - 1) * perPage, page * perPage) : filtered;
  return NextResponse.json({ users, page, perPage, total: query ? filtered.length : total });
}

export async function POST(request: NextRequest) {
  if (!await isCurrentUserAdmin()) return unauthorized();

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Dati non validi." }, { status: 400 });
  const { email, displayName, role } = body as Record<string, unknown>;
  if (typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email.trim())) {
    return NextResponse.json({ error: "Inserisci un indirizzo email valido." }, { status: 400 });
  }
  if (typeof displayName !== "string" || displayName.trim().length > 100) {
    return NextResponse.json({ error: "Il nome può contenere al massimo 100 caratteri." }, { status: 400 });
  }
  if (role !== "user" && role !== "admin") return NextResponse.json({ error: "Ruolo non valido." }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email.trim(), {
    data: { display_name: displayName.trim() },
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/confirm?next=/dashboard`,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(data.user.id, {
    app_metadata: { ...data.user.app_metadata, role },
    user_metadata: { ...data.user.user_metadata, display_name: displayName.trim() },
  });
  if (updateError) return NextResponse.json({ error: `Account invitato, ma ruolo non aggiornato: ${updateError.message}` }, { status: 502 });
  await syncProfile(updated.user);
  return NextResponse.json({ user: toManagedUser(updated.user) }, { status: 201 });
}
