import { NextResponse } from "next/server";
import { getCurrentAdminId } from "@/lib/admin-auth";
import { checkExternalServices } from "@/lib/admin-service-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await getCurrentAdminId())) return NextResponse.json({ error: "Accesso riservato agli amministratori." }, { status: 403 });
  try {
    const health = await checkExternalServices();
    return NextResponse.json(health, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    console.error("Admin external services check failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "Impossibile completare i controlli dei servizi." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
