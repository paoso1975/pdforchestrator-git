"use client";

import { useEffect, useState } from "react";
import { ArrowRight, FileStack, LoaderCircle, Plus, Search, Workflow } from "lucide-react";
import Link from "next/link";

type Organization = { id: string; name: string; role: string };
type Batch = { id: string; name: string; slug: string; status: string; updatedAt: string; _count?: { versions: number; executions: number } };

export function BatchList() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [batches, setBatches] = useState<Batch[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [organizationForm, setOrganizationForm] = useState(false);
  const [organizationName, setOrganizationName] = useState("");
  const [organizationSlug, setOrganizationSlug] = useState("");
  const [creatingOrganization, setCreatingOrganization] = useState(false);

  useEffect(() => {
    void fetch("/api/organizations", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("Impossibile caricare le organizzazioni.");
      const result = await response.json() as Organization[];
      setOrganizations(result); setOrganizationId(result[0]?.id ?? "");
      if (!result.length) setLoading(false);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Errore di rete."));
  }, []);

  useEffect(() => {
    if (!organizationId) return;
    void fetch(`/api/batches?organizationId=${encodeURIComponent(organizationId)}`, { cache: "no-store" }).then(async (response) => {
      const result = await response.json() as Batch[] | { error?: string };
      if (!response.ok) throw new Error("error" in result ? result.error : "Impossibile caricare i batch.");
      setBatches(result as Batch[]);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Errore di rete.")).finally(() => setLoading(false));
  }, [organizationId]);

  const filtered = batches.filter((batch) => `${batch.name} ${batch.slug}`.toLowerCase().includes(query.toLowerCase()));
  async function createOrganization(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setCreatingOrganization(true); setError("");
    try {
      const response = await fetch("/api/organizations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: organizationName, slug: organizationSlug }) });
      const result = await response.json() as Organization & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Impossibile creare l’organizzazione.");
      setOrganizations((current) => [...current, result]); setOrganizationId(result.id); setOrganizationForm(false); setOrganizationName(""); setOrganizationSlug("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Errore di rete."); }
    finally { setCreatingOrganization(false); }
  }
  return <main className="min-h-dvh bg-[#0a1017] text-slate-100"><header className="border-b border-[#25313c] bg-[#0d151e]"><div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4"><Link href="/dashboard" className="text-lg font-bold tracking-tight text-white">PDF<span className="text-[#2E7BFA]">Orchestrator</span></Link><Link href="/dashboard" className="rounded-lg border border-[#2A5FB8] px-4 py-2 text-sm font-medium text-slate-300 transition hover:border-[#136EF9] hover:bg-[#13213a] hover:text-white">← Dashboard</Link></div></header><section className="mx-auto max-w-7xl px-6 py-12"><div className="flex flex-wrap items-end justify-between gap-5"><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-[#2E7BFA]">Progettazione</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">I tuoi batch</h1><p className="mt-2 text-sm text-slate-500">Progetta flussi PDF e pubblicali come API.</p></div><div className="flex gap-2"><Link href="/dashboard/execute" className="flex items-center gap-2 rounded-lg border border-[#35445a] bg-[#141f30] px-4 py-2.5 text-xs font-semibold text-[#9bb9e5] hover:bg-[#1a283e]">Avvia un batch</Link><Link href="/dashboard/batches/new" className="flex items-center gap-2 rounded-lg bg-[#136EF9] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#2E7BFA]"><Plus size={15}/>Nuovo batch</Link></div></div>
    {organizations.length > 1 && <label className="mt-8 block max-w-sm text-xs text-slate-400">Organizzazione<select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} className="mt-2 block w-full rounded-lg border border-[#293744] bg-[#111b25] px-3 py-2.5 text-sm text-slate-200">{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name} · {organization.role}</option>)}</select></label>}
    <div className="mt-7 flex max-w-sm items-center gap-2 rounded-lg border border-[#293744] bg-[#111b25] px-3 py-2.5"><Search size={14} className="text-slate-500"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cerca un batch…" className="w-full bg-transparent text-xs outline-none placeholder:text-slate-600"/></div>
    {error && <p className="mt-5 rounded-lg border border-red-900/40 bg-red-950/20 p-3 text-xs text-red-200">{error}</p>}
    {!organizations.length && !error && !loading && <div className="mt-8 rounded-xl border border-dashed border-[#354450] bg-[#0f1821] px-6 py-12 text-center"><Workflow size={25} className="mx-auto text-[#6996d9]"/><h2 className="mt-3 text-sm font-semibold">Crea il tuo workspace</h2><p className="mx-auto mt-2 max-w-md text-xs leading-5 text-slate-500">Crea un’organizzazione per iniziare. Il tuo account ne diventerà il proprietario.</p>{organizationForm ? <form onSubmit={createOrganization} className="mx-auto mt-5 grid max-w-md gap-2 text-left"><input required minLength={2} maxLength={120} value={organizationName} onChange={(event) => { const name = event.target.value; setOrganizationName(name); setOrganizationSlug(name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")); }} placeholder="Nome organizzazione" className="rounded-lg border border-[#2b3b47] bg-[#0b141d] px-3 py-2.5 text-xs"/><input required minLength={2} maxLength={80} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={organizationSlug} onChange={(event) => setOrganizationSlug(event.target.value)} placeholder="slug-organizzazione" className="rounded-lg border border-[#2b3b47] bg-[#0b141d] px-3 py-2.5 font-mono text-xs"/><button disabled={creatingOrganization} className="mt-1 rounded-lg bg-[#136EF9] px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50">{creatingOrganization ? "Creazione…" : "Crea organizzazione"}</button></form> : <button onClick={() => setOrganizationForm(true)} className="mt-5 rounded-lg bg-[#136EF9] px-4 py-2.5 text-xs font-semibold text-white">Crea organizzazione</button>}</div>}
    {loading ? <div className="mt-10 flex items-center justify-center gap-2 text-xs text-slate-500"><LoaderCircle size={15} className="animate-spin"/>Caricamento batch…</div> : filtered.length ? <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{filtered.map((batch) => <Link key={batch.id} href={`/dashboard/batches/${batch.id}/edit`} className="group rounded-xl border border-[#263540] bg-[#101923] p-5 transition hover:border-[#2A5FB8] hover:bg-[#111d27]"><div className="flex items-start justify-between"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#1a2639] text-[#6b97d8]"><FileStack size={17}/></span><span className={`rounded-full px-2 py-1 text-[9px] ${batch.status === "PUBLISHED" ? "bg-emerald-950 text-emerald-300" : "bg-amber-950/50 text-amber-300"}`}>{batch.status === "PUBLISHED" ? "Pubblicato" : batch.status === "ARCHIVED" ? "Archiviato" : "Bozza"}</span></div><h2 className="mt-4 text-sm font-semibold">{batch.name}</h2><p className="mt-1 font-mono text-[10px] text-slate-600">{batch.slug}</p><div className="mt-5 flex items-center justify-between border-t border-[#263540] pt-3 text-[10px] text-slate-500"><span>Aggiornato {new Intl.DateTimeFormat("it-IT", { dateStyle: "medium" }).format(new Date(batch.updatedAt))}</span><ArrowRight size={14} className="text-slate-600 group-hover:text-[#729cdc]"/></div></Link>)}</div> : organizations.length > 0 && <div className="mt-8 rounded-xl border border-dashed border-[#354450] px-6 py-12 text-center"><Workflow size={25} className="mx-auto text-slate-600"/><p className="mt-3 text-sm font-medium">{query ? "Nessun risultato" : "Qui inizia il tuo flusso"}</p><p className="mt-1 text-xs text-slate-500">{query ? "Prova un altro termine di ricerca." : "Crea il primo batch PDF per iniziare."}</p></div>}
    </section></main>;
}
