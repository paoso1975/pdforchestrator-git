import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireWorker } from "@/lib/execution-auth";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  if (!(await requireWorker(request))) return NextResponse.json({ status: "unauthorized" }, { status: 401 });
  try { await prisma.$queryRaw(Prisma.sql`SELECT 1`); return NextResponse.json({ status: "ok", database: "ok", service: "worker-api" }); }
  catch { return NextResponse.json({ status: "degraded", database: "unavailable" }, { status: 503 }); }
}
