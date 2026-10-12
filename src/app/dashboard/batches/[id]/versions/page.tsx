import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Clock3, GitBranch, Layers3 } from "lucide-react";
import { getAuthenticatedUserId } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { RestoreBatchDraftButton } from "@/components/restore-batch-draft-button";

export const runtime = "nodejs";

export default async function BatchVersionsPage({ params }: { params: Promise<{ id: string }> }) {
  const userId = await getAuthenticatedUserId();
  if (!userId) notFound();
  const { id } = await params;
  const batch = await prisma.batch.findFirst({
    where: { id, organization: { memberships: { some: { userId } } } },
    include: {
      versions: { select: { id: true, version: true, publishedAt: true, createdAt: true, configHash: true }, orderBy: { version: "desc" } },
      draftRevisions: { select: { id: true, revision: true, batchName: true, createdAt: true }, orderBy: { revision: "desc" }, take: 100 },
    },
  });
  if (!batch) notFound();
  return <main className="min-h-dvh bg-[#0a1017] px-5 py-8 text-slate-100"><div className="mx-auto max-w-4xl"><Link href={`/dashboard/batches/${id}/edit`} className="inline-flex items-center gap-2 text-xs text-slate-500 hover:text-slate-200"><ArrowLeft size={14}/>Torna all’editor</Link><div className="mt-7 flex items-end justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-[#2E7BFA]">Cronologia</p><h1 className="mt-2 text-3xl font-semibold">Versioni</h1><p className="mt-2 text-sm text-slate-500">{batch.name} · {batch.versions.length} versioni</p></div><Link href={`/dashboard/batches/${id}/edit`} className="rounded-lg border border-[#2b3b47] px-3 py-2 text-xs text-slate-300 hover:bg-[#111b25]">Apri editor</Link></div>
    <section className="mt-9"><h2 className="text-lg font-semibold">Revisioni draft</h2><p className="mt-1 text-xs text-slate-500">Ogni autosalvataggio conserva uno snapshot completo del canvas e degli schemi.</p><div className="mt-4 space-y-2">{batch.draftRevisions.map((revision) => <article key={revision.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-[#283744] bg-[#101923] p-4"><div className="min-w-0 flex-1"><p className="text-xs font-medium">Revisione {revision.revision} · {revision.batchName}</p><p className="mt-1 text-[10px] text-slate-500">{new Intl.DateTimeFormat("it-IT", { dateStyle: "long", timeStyle: "short" }).format(revision.createdAt)}</p></div><RestoreBatchDraftButton batchId={id} sourceRevision={revision.revision}/></article>)}</div></section><div className="mt-7 space-y-3">{batch.versions.length ? batch.versions.map((version) => <article key={version.id} className="flex flex-wrap items-center gap-4 rounded-xl border border-[#283744] bg-[#101923] p-4 sm:p-5"><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${version.publishedAt ? "bg-emerald-950/60 text-emerald-300" : "bg-[#1a2639] text-[#719bd9]"}`}>{version.publishedAt ? <CheckCircle2 size={18}/> : <GitBranch size={18}/>}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold">Versione {version.version}</h2><span className={`rounded-full px-2 py-0.5 text-[9px] ${version.publishedAt ? "bg-emerald-950 text-emerald-300" : "bg-[#1d2d37] text-slate-400"}`}>{version.publishedAt ? "Pubblicata" : "Bozza"}</span>{batch.activeVersionId === version.id && <span className="rounded-full bg-[#19263a] px-2 py-0.5 text-[9px] text-[#83a7dc]">Attiva</span>}</div><p className="mt-1 flex items-center gap-1.5 text-[10px] text-slate-500"><Clock3 size={11}/>{new Intl.DateTimeFormat("it-IT", { dateStyle: "long", timeStyle: "short" }).format(version.publishedAt ?? version.createdAt)}</p></div><div className="text-right"><p className="text-[9px] uppercase tracking-wider text-slate-600">Hash configurazione</p><code className="mt-1 block max-w-40 truncate font-mono text-[10px] text-slate-400">{version.configHash}</code></div><div className="hidden items-center gap-1 text-[10px] text-slate-600 sm:flex"><Layers3 size={13}/>V{version.version}</div></article>) : <div className="rounded-xl border border-dashed border-[#364450] p-12 text-center"><GitBranch size={24} className="mx-auto text-slate-600"/><p className="mt-3 text-sm font-medium">Ancora nessuna versione salvata</p><p className="mt-1 text-xs text-slate-500">Le bozze vengono create automaticamente al primo salvataggio.</p></div>}</div></div></main>;
}
