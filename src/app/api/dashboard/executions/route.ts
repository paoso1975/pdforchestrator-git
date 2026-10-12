import { NextResponse } from "next/server";
import { getAuthenticatedUserId } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const userId = await getAuthenticatedUserId();
  if (!userId) return NextResponse.json({ error: "Autenticazione richiesta." }, { status: 401 });
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const query = url.searchParams.get("q")?.trim().slice(0, 100);
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const where = {
    organization: { memberships: { some: { userId } } },
    ...(status && ["QUEUED", "RUNNING", "COMPLETED", "SUCCEEDED", "FAILED", "CANCEL_REQUESTED", "CANCELLED"].includes(status) ? { status: status as "QUEUED" | "RUNNING" | "COMPLETED" | "SUCCEEDED" | "FAILED" | "CANCEL_REQUESTED" | "CANCELLED" } : {}),
    ...(query ? { OR: [{ id: { contains: query, mode: "insensitive" as const } }, { batch: { name: { contains: query, mode: "insensitive" as const } } }] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.batchExecution.findMany({ where, include: { batch: { select: { name: true } }, batchVersion: { select: { version: true } }, credential: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 30, skip: (page - 1) * 30 }),
    prisma.batchExecution.count({ where }),
  ]);
  return NextResponse.json({ items: items.map((item) => ({ id: item.id, batchId: item.batchId, batch: item.batch.name, version: item.batchVersion.version, origin: item.credential?.name ?? "Dashboard", status: item.status, progress: item.progress, durationMs: item.durationMs, pagesProcessed: item.pagesProcessed, createdAt: item.createdAt, completedAt: item.completedAt })), total, page, pageSize: 30 });
}
