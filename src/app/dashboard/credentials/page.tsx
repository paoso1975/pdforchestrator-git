import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import CredentialsManager from "@/components/credentials-manager";
import { Prisma } from "@/generated/prisma/client";

export const runtime = "nodejs";
export default async function CredentialsPage() {
  const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser(); if (!user) redirect("/login");
  const organizations = await prisma.organization.findMany({ where: { memberships: { some: { userId: user.id, role: { in: ["OWNER", "ADMIN"] } } } }, select: { id: true, name: true, batches: { where: { status: "PUBLISHED", activeVersionId: { not: null } }, select: { id: true, name: true, versions: { where: { publishedAt: { not: null } }, select: { id: true, version: true }, orderBy: { version: "desc" } } }, orderBy: { name: "asc" } } }, orderBy: { name: "asc" } });
  const credentials = await prisma.apiCredential.findMany({ where: { organization: { memberships: { some: { userId: user.id, role: { in: ["OWNER", "ADMIN"] } } } } }, select: { id: true, organizationId: true, name: true, keyId: true, tokenPrefix: true, createdAt: true, expiresAt: true, revokedAt: true, lastUsedAt: true, grants: { include: { batch: { select: { id: true, name: true } } } }, _count: { select: { executions: true } } }, orderBy: { createdAt: "desc" } });
  const usage = credentials.length ? await prisma.$queryRaw<Array<{ credentialId: string; requests: number }>>(Prisma.sql`SELECT "credentialId", SUM("requestCount")::int AS "requests" FROM "ApiRateBucket" WHERE "credentialId" IN (${Prisma.join(credentials.map((item) => Prisma.sql`${item.id}::uuid`))}) AND "windowStart" >= NOW() - INTERVAL '30 days' GROUP BY "credentialId"`) : [];
  const requestCounts = new Map(usage.map((item) => [item.credentialId, item.requests]));
  const safeCredentials = credentials.map((item) => ({ id: item.id, organizationId: item.organizationId, name: item.name, keyId: item.keyId ?? item.tokenPrefix, createdAt: item.createdAt.toISOString(), expiresAt: item.expiresAt?.toISOString() ?? null, revokedAt: item.revokedAt?.toISOString() ?? null, lastUsedAt: item.lastUsedAt?.toISOString() ?? null, executions: item._count.executions, requests30d: requestCounts.get(item.id) ?? 0, batchIds: item.grants.map((g) => g.batchId), batchNames: item.grants.map((g) => g.batch.name), versionScopes: Object.fromEntries(item.grants.filter((g) => g.batchVersionIds.length).map((g) => [g.batchId, g.batchVersionIds])) }));
  return <main className="min-h-screen bg-[#0a1017] px-5 py-8 text-slate-100 sm:px-10">
    <div className="mx-auto max-w-6xl">
      <header className="flex items-center justify-between border-b border-[#25313c] pb-6">
        <a href="/dashboard" className="text-lg font-bold tracking-tight text-white">PDF<span className="text-[#2E7BFA]">Orchestrator</span></a>
        <a href="/dashboard" className="rounded-lg border border-[#2A5FB8] px-4 py-2 text-sm font-medium text-slate-300 transition hover:border-[#136EF9] hover:bg-[#13213a] hover:text-white">← Dashboard</a>
      </header>
      <p className="mt-8 text-xs font-semibold uppercase tracking-[0.2em] text-blue-300">Sicurezza API</p>
      <h1 className="mt-2 text-3xl font-semibold">Credenziali</h1>
      <p className="mt-2 max-w-2xl text-sm text-slate-400">Crea chiavi HMAC con accesso limitato ai batch pubblicati. Il Secret viene mostrato una sola volta al momento della creazione o rotazione.</p>
      <p>Il tuo account è in versione DEMO. <b><a href="mailto:info@pdforchestrator.com">Contattaci</a></b> per ricevere il listino prezzi e attivare il contratto per eseguire i tuoi batch.</p>
      <div className="mt-8">
        <CredentialsManager organizations={organizations} initialCredentials={safeCredentials} />
      </div>
    </div>
    </main>;
}
