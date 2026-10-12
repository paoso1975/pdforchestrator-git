"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, CircleAlert, CircleX, LoaderCircle, RefreshCw } from "lucide-react";
import { serviceHealthSchema, type ServiceHealth } from "@/lib/admin-service-health-schema";

const statusStyles = {
  ok: { label: "Operativo", Icon: CheckCircle2, color: "text-emerald-400", border: "border-emerald-500/30" },
  warning: { label: "Attenzione", Icon: CircleAlert, color: "text-amber-400", border: "border-amber-500/30" },
  error: { label: "Non disponibile", Icon: CircleX, color: "text-rose-400", border: "border-rose-500/30" },
} as const;

export function AdminServiceHealth() {
  const [data, setData] = useState<ServiceHealth | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await fetch("/api/admin/services/health", { cache: "no-store" });
      const json: unknown = await response.json();
      if (!response.ok) throw new Error(typeof json === "object" && json && "error" in json && typeof json.error === "string" ? json.error : "Controllo non riuscito.");
      setData(serviceHealthSchema.parse(json));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Errore durante i controlli.");
      setData(null);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  return <div className="mt-8">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-slate-400">Controllo live: le verifiche sono di sola lettura e hanno un timeout di 5 secondi.</p>
      <button onClick={() => void refresh()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-[#344653] bg-[#111c26] px-4 py-2 text-sm text-slate-200 hover:border-[#4d6588] disabled:opacity-50">
        {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Aggiorna controlli
      </button>
    </div>
    {error && <p role="alert" className="mt-4 rounded-lg border border-rose-500/30 bg-rose-950/30 p-4 text-sm text-rose-200">{error}</p>}
    {!data && loading && <div className="mt-6 grid gap-4 md:grid-cols-2"><div className="h-48 animate-pulse rounded-xl border border-[#263540] bg-[#101923]"/><div className="h-48 animate-pulse rounded-xl border border-[#263540] bg-[#101923]"/></div>}
    {data && <>
      <p className="mt-4 text-xs text-slate-500">Ultimo controllo: {new Date(data.checkedAt).toLocaleString("it-IT")}</p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {data.services.map((service) => {
          const style = statusStyles[service.status]; const Icon = style.Icon;
          return <article key={service.id} className={`rounded-xl border ${style.border} bg-[#101923] p-5`}>
            <div className="flex items-start justify-between gap-4"><div><h2 className="font-semibold text-slate-100">{service.label}</h2><p className={`mt-1 flex items-center gap-1.5 text-xs ${style.color}`}><Icon className="h-4 w-4"/>{style.label}</p></div><span className="text-xs text-slate-500">{service.durationMs} ms</span></div>
            <p className="mt-4 text-sm text-slate-300">{service.message}</p>
            {service.details.length > 0 && <ul className="mt-3 space-y-1 text-xs text-slate-400">{service.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>}
            <h3 className="mt-5 border-t border-[#25313c] pt-4 text-[10px] font-semibold uppercase tracking-[.16em] text-slate-500">Variabili lette</h3>
            <dl className="mt-2 space-y-1.5">{service.variables.map((variable) => <div key={variable.name} className="flex flex-wrap justify-between gap-2 text-xs"><dt className="font-mono text-slate-400">{variable.name}</dt><dd className={variable.configured ? "text-slate-200" : "text-rose-300"}>{variable.value ?? "Non configurata"}</dd></div>)}</dl>
          </article>;
        })}
      </div>
    </>}
  </div>;
}
