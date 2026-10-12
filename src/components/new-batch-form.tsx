"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, LoaderCircle, Sparkles } from "lucide-react";
import Link from "next/link";

type Organization = { id: string; name: string; role: "OWNER" | "ADMIN" | "DESIGNER" | "OPERATOR" | "VIEWER" };

export function NewBatchForm() {
  const router = useRouter();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { void fetch("/api/organizations", { cache: "no-store" }).then((response) => response.json()).then((result: Organization[]) => { setOrganizations(result); setOrganizationId(result[0]?.id ?? ""); if (!result.length) setError("Nessuna organizzazione disponibile: chiedi a un amministratore di aggiungerti a un’organizzazione."); }).catch(() => setError("Impossibile caricare le organizzazioni.")); }, []);
  const changeName = (value: string) => { setName(value); setSlug(value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")); };
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const response = await fetch("/api/batches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId, name, slug, description: description || null }) });
      const result = await response.json() as { id?: string; error?: string };
      if (!response.ok || !result.id) throw new Error(result.error ?? "Impossibile creare il batch.");
      router.push(`/dashboard/batches/${result.id}/edit`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Errore di rete."); setSaving(false); }
  }

  return <main className="min-h-dvh bg-[#0a1017] px-5 py-8 text-slate-100"><div className="mx-auto max-w-2xl"><Link href="/dashboard/batches" className="inline-flex items-center gap-2 text-xs text-slate-500 hover:text-slate-200"><ArrowLeft size={14}/>Tutti i batch</Link><section className="mt-7 rounded-2xl border border-[#273641] bg-[#101923] p-6 sm:p-8"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1a273b] text-[#6b99dd]"><Sparkles size={18}/></span><h1 className="mt-5 text-2xl font-semibold">Crea un batch</h1><p className="mt-2 text-sm text-slate-500">Imposta i dettagli iniziali, poi costruisci il flusso nell’editor.</p>
    {!organizations.length && !error ? <p className="mt-6 text-xs text-slate-500">Caricamento organizzazioni…</p> : !organizations.length && error ? <p className="mt-6 rounded-lg bg-red-950/30 p-3 text-xs text-red-200">{error}</p> : <form onSubmit={create} className="mt-7 space-y-4"><label className="block text-xs font-medium text-slate-300">Organizzazione<select required value={organizationId} onChange={(event) => setOrganizationId(event.target.value)} className="mt-2 block w-full rounded-lg border border-[#2b3b47] bg-[#0b141d] px-3 py-2.5 text-sm">{organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name} · {organization.role}</option>)}</select></label><label className="block text-xs font-medium text-slate-300">Nome<input required maxLength={120} value={name} onChange={(event) => changeName(event.target.value)} placeholder="Elaborazione fatture" className="mt-2 block w-full rounded-lg border border-[#2b3b47] bg-[#0b141d] px-3 py-2.5 text-sm outline-none focus:border-[#5485cf]"/></label><label className="block text-xs font-medium text-slate-300">Slug<input required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" maxLength={100} value={slug} onChange={(event) => setSlug(event.target.value)} className="mt-2 block w-full rounded-lg border border-[#2b3b47] bg-[#0b141d] px-3 py-2.5 font-mono text-xs outline-none focus:border-[#5485cf]"/><span className="mt-1 block text-[10px] font-normal text-slate-600">Identificativo URL univoco nell’organizzazione.</span></label><label className="block text-xs font-medium text-slate-300">Descrizione <span className="font-normal text-slate-600">(facoltativa)</span><textarea maxLength={2000} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Descrivi lo scopo di questo batch" className="mt-2 block w-full resize-y rounded-lg border border-[#2b3b47] bg-[#0b141d] px-3 py-2.5 text-sm outline-none focus:border-[#5485cf]"/></label>{error && <p role="alert" className="text-xs text-red-300">{error}</p>}<button disabled={saving || !organizationId} className="flex items-center gap-2 rounded-lg bg-[#136EF9] px-4 py-2.5 text-xs font-semibold disabled:opacity-50">{saving && <LoaderCircle size={14} className="animate-spin"/>}Crea e apri l’editor</button></form>}
    </section></div></main>;
}
