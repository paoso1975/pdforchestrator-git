"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";

export function RestoreBatchDraftButton({ batchId, sourceRevision }: { batchId: string; sourceRevision: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function restore() {
    setBusy(true); setError("");
    try {
      const draftResponse = await fetch(`/api/batches/${batchId}/draft`, { cache: "no-store" });
      if (!draftResponse.ok) throw new Error("Impossibile leggere la revisione corrente.");
      const current = await draftResponse.json() as { revision?: number } | null;
      const response = await fetch(`/api/batches/${batchId}/draft/restore`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceRevision, expectedRevision: current?.revision ?? null }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Ripristino non riuscito.");
      router.push(`/dashboard/batches/${batchId}/edit`); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Errore di rete."); }
    finally { setBusy(false); }
  }
  return <div className="flex flex-col items-end gap-1"><button onClick={() => void restore()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-[#2b3b47] px-2.5 py-2 text-[10px] text-slate-300 hover:bg-[#17232d] disabled:opacity-50"><RotateCcw size={12}/>{busy ? "Ripristino…" : "Ripristina"}</button>{error && <span role="alert" className="max-w-56 text-right text-[9px] text-red-300">{error}</span>}</div>;
}
