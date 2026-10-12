import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { signOut } from "./actions";
import { redirect } from "next/navigation";
import Link from "next/link";
import { isOrganizationAdmin } from "@/lib/admin-auth";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const canManageUsers = await isOrganizationAdmin(user.id);

  const memberships = await prisma.organizationMembership.findMany({ where: { userId: user.id }, select: { organizationId: true } });
  const organizationIds = memberships.map((item) => item.organizationId);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - 7);
  const [batchTotal, batchPublished, executionsToday, jobsRunning, jobsFailed, pages, durations, files, daily, statuses, tools] = await Promise.all([
    prisma.batch.count({ where: { organizationId: { in: organizationIds } } }),
    prisma.batch.count({ where: { organizationId: { in: organizationIds }, status: "PUBLISHED" } }),
    prisma.batchExecution.count({ where: { organizationId: { in: organizationIds }, createdAt: { gte: today } } }),
    prisma.batchExecution.count({ where: { organizationId: { in: organizationIds }, status: { in: ["RUNNING", "CANCEL_REQUESTED"] } } }),
    prisma.batchExecution.count({ where: { organizationId: { in: organizationIds }, status: "FAILED" } }),
    prisma.batchExecution.aggregate({ where: { organizationId: { in: organizationIds }, status: { in: ["COMPLETED", "SUCCEEDED"] } }, _sum: { pagesProcessed: true } }),
    prisma.batchExecution.aggregate({ where: { organizationId: { in: organizationIds }, status: { in: ["COMPLETED", "SUCCEEDED"] }, durationMs: { not: null } }, _avg: { durationMs: true } }),
    prisma.storedFile.aggregate({ where: { organizationId: { in: organizationIds } }, _sum: { sizeBytes: true } }),
    prisma.batchExecution.findMany({ where: { organizationId: { in: organizationIds }, createdAt: { gte: weekStart } }, select: { createdAt: true, status: true, durationMs: true } }),
    prisma.batchExecution.groupBy({ by: ["status"], where: { organizationId: { in: organizationIds } }, _count: { _all: true } }),
    prisma.stepExecution.groupBy({ by: ["toolId"], where: { execution: { organizationId: { in: organizationIds } } }, _count: { _all: true }, orderBy: { _count: { toolId: "desc" } }, take: 5 }),
  ]);
  const dailyCounts = Array.from({ length: 7 }, (_, index) => { const day = new Date(); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() - (6 - index)); const rows = daily.filter((item) => item.createdAt.toDateString() === day.toDateString()); const timed = rows.filter((item) => item.durationMs !== null); return { day, count: rows.length, averageDuration: timed.length ? timed.reduce((sum, item) => sum + (item.durationMs ?? 0), 0) / timed.length : null }; });
  const maxDaily = Math.max(1, ...dailyCounts.map((item) => item.count));
  const bytes = Number(files._sum.sizeBytes ?? BigInt(0));
  const formatBytes = (value: number) => value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KB` : `${(value / (1024 * 1024)).toFixed(1)} MB`;

  return (
    <main className="min-h-dvh bg-[#0a1017] px-5 py-8 text-slate-100 sm:px-10">
      <div className="mx-auto max-w-6xl">
        <header className="flex items-center justify-between border-b border-[#25313c] pb-6">
          <Link href="/dashboard" className="text-lg font-bold tracking-tight text-white">PDF<span className="text-[#2E7BFA]">Orchestrator</span></Link>
          <form action={signOut}><button className="rounded-lg border border-[#2A5FB8] px-4 py-2 text-sm font-medium text-slate-300 transition hover:border-[#136EF9] hover:bg-[#13213a] hover:text-white">Esci</button></form>
        </header>
        <section className="py-10">
          <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-[#2E7BFA]">Workspace</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-2 text-sm text-slate-500">Accesso effettuato come {user.email}</p>
          <nav className="mt-6 flex flex-wrap gap-2">{canManageUsers && <><Link href="/dashboard/users" className="rounded-lg border border-[#293744] bg-[#101923] px-4 py-2 text-xs font-medium text-slate-300 transition hover:border-[#2A5FB8] hover:text-white">Gestione utenti</Link><Link href="/dashboard/services" className="rounded-lg border border-[#293744] bg-[#101923] px-4 py-2 text-xs font-medium text-slate-300 transition hover:border-[#2A5FB8] hover:text-white">Servizi e configurazione</Link></>}<Link href="/dashboard/batches" className="rounded-lg bg-[#136EF9] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#2E7BFA]">Designer batch</Link><Link href="/dashboard/execute" className="rounded-lg border border-[#2A5FB8] bg-[#131d2d] px-4 py-2 text-xs font-semibold text-[#9bb9e5] transition hover:bg-[#19273d]">Avvia un batch</Link><Link href="/dashboard/credentials" className="rounded-lg border border-[#293744] bg-[#101923] px-4 py-2 text-xs font-medium text-slate-300 transition hover:border-[#2A5FB8] hover:text-white">Credenziali API</Link><Link href="/dashboard/executions" className="rounded-lg border border-[#293744] bg-[#101923] px-4 py-2 text-xs font-medium text-slate-300 transition hover:border-[#2A5FB8] hover:text-white">Esecuzioni</Link></nav>
          <section className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[["Batch totali",batchTotal],["Pubblicati",batchPublished],["Esecuzioni oggi",executionsToday],["Job in corso",jobsRunning],["Job falliti",jobsFailed],["Pagine elaborate",pages._sum.pagesProcessed ?? 0],["Durata media",durations._avg.durationMs == null ? "—" : `${(durations._avg.durationMs / 1000).toFixed(1)} s`],["Storage utilizzato",formatBytes(bytes)]].map(([label,value])=><article key={String(label)} className="rounded-xl border border-[#263540] bg-[#101923] p-4 text-slate-100"><p className="text-xs text-slate-400">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p></article>)}</section>
          <section className="mt-5 grid gap-4 lg:grid-cols-2"><article className="rounded-xl border border-[#263540] bg-[#101923] p-5 text-slate-100"><h2 className="text-sm font-semibold">Esecuzioni per giorno · 7 giorni</h2><div className="mt-5 flex h-32 items-end gap-3">{dailyCounts.map((item)=><div key={item.day.toISOString()} className="flex h-full flex-1 flex-col justify-end text-center"><div title={`${item.count} esecuzioni`} className="mx-auto w-full max-w-10 rounded-t bg-[#2E7BFA]" style={{height:`${Math.max(4,item.count/maxDaily*100)}%`}}/><span className="mt-2 text-[9px] text-slate-500">{item.day.toLocaleDateString("it-IT",{weekday:"short"})}</span></div>)}</div><h3 className="mt-5 text-xs font-semibold">Durata media per giorno</h3><div className="mt-2 flex flex-wrap gap-3">{dailyCounts.map(item=><span key={item.day.toISOString()} className="rounded bg-[#0b141d] px-2 py-1 text-[10px] text-slate-400">{item.day.toLocaleDateString("it-IT",{weekday:"short"})}: {item.averageDuration === null ? "—" : `${(item.averageDuration/1000).toFixed(1)} s`}</span>)}</div></article><article className="rounded-xl border border-[#263540] bg-[#101923] p-5 text-slate-100"><h2 className="text-sm font-semibold">Esiti</h2><div className="mt-4 space-y-2">{statuses.map(item=><div key={item.status} className="flex justify-between text-xs"><span className="text-slate-400">{item.status}</span><span>{item._count._all}</span></div>)}{!statuses.length&&<p className="text-xs text-slate-500">Nessuna esecuzione registrata.</p>}</div><h3 className="mt-5 text-xs font-semibold">Strumenti più usati</h3><div className="mt-2 space-y-1">{tools.map(item=><div key={item.toolId} className="flex justify-between text-xs"><span className="text-slate-400">{item.toolId}</span><span>{item._count._all}</span></div>)}</div></article></section>
        </section>
      </div>
    </main>
  );
}
