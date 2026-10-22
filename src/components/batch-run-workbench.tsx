"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCircle2, CircleAlert, Copy, Download, File, LoaderCircle, Play, UploadCloud } from "lucide-react";
import { buildBatchRunRequest, buildDashboardExecutionRequestPreview, buildPublicBatchRunCurlPreview, getBatchRunFields, missingRequiredRunInputs, type RunInputField } from "@/lib/batch-run-input";
import { buildExecutionLog, executionLogPlainText, type ExecutionLogEvent, type ExecutionLogStep } from "@/lib/execution-log";
/* MODIFICATO */

export type RunnableBatch = {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  version: number;
  inputSchema: unknown;
  outputSchema: unknown;
  graph: unknown;
};

type UploadedPdf = { id: string; filename: string; size: number };
type AvailableInputFile = { id: string; filename: string; sizeBytes: string; sha256: string; createdAt: string };
type ExecutionState = { id: string; status: string; progress: number; currentStepId?: string | null; error?: unknown; output?: unknown; input?: unknown; origin?: string; requestedByUserId?: string | null; credentialId?: string | null; requestId?: string | null; requestMethod?: string | null; requestPath?: string | null; executionString?: string; createdAt?: string; startedAt?: string | null; completedAt?: string | null; events?: ExecutionLogEvent[]; steps?: ExecutionLogStep[]; batch?: { name?: string }; batchVersion?: { version?: number; graph?: unknown } };
type OutputFile = { id: string; filename: string; mimeType: string; sizeBytes: string; sha256: string; downloadUrl: string; expiresIn: number };

function errorMessage(value: unknown, fallback: string) {
  if (value && typeof value === "object" && "error" in value && typeof value.error === "string") return value.error;
  return fallback;
}

function formatBytes(value: number) {
  return value < 1024 * 1024 ? `${(value / 1024).toFixed(0)} KB` : `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

async function describeStorageUploadError(response: Response, filename: string) {
  const body = await response.text().catch(() => "");
  let code = "";
  let message = "";
  let storageRequestId = "";
  if (body) {
    try {
      const xml = new DOMParser().parseFromString(body, "application/xml");
      if (!xml.querySelector("parsererror")) {
        code = xml.querySelector("Code")?.textContent?.trim() ?? "";
        message = xml.querySelector("Message")?.textContent?.trim() ?? "";
        storageRequestId = xml.querySelector("RequestId")?.textContent?.trim() ?? "";
      }
    } catch {
      // Keep the generic status when the S3 gateway returns a non-XML error page.
    }
  }
  const detail = [code, message].filter(Boolean).join(": ");
  const requestId = storageRequestId || response.headers.get("x-amz-request-id") || response.headers.get("x-amz-id-2");
  return {
    message: `Cubbit ha rifiutato ${filename} (HTTP ${response.status})${detail ? ` — ${detail}` : ""}${requestId ? ` [request ID ${requestId}]` : ""}.`,
    code,
    storageMessage: message,
    storageRequestId: requestId ?? "",
  };
}

async function reportUploadFailure(report: {
  fileId: string;
  requestId: string;
  phase: "PUT_REJECTED" | "PUT_NETWORK_ERROR";
  httpStatus?: number;
  storageCode?: string;
  storageMessage?: string;
  storageRequestId?: string;
}) {
  try {
    await fetch("/api/files/upload-report", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(report),
      keepalive: true,
    });
  } catch {
    // The original storage error remains visible even when diagnostic reporting fails.
  }
}

function isTerminal(status: string) {
  return ["COMPLETED", "SUCCEEDED", "FAILED", "CANCELLED"].includes(status);
}

export function BatchRunWorkbench({ batches }: { batches: RunnableBatch[] }) {
  const [batchId, setBatchId] = useState(batches[0]?.id ?? "");
  const batch = batches.find((item) => item.id === batchId) ?? null;
  const fields = useMemo(() => getBatchRunFields(batch?.inputSchema), [batch]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [jsonDrafts, setJsonDrafts] = useState<Record<string, string>>({});
  const [jsonErrors, setJsonErrors] = useState<Record<string, string>>({});
  const [uploads, setUploads] = useState<Record<string, UploadedPdf[]>>({});
  const [availableFiles, setAvailableFiles] = useState<AvailableInputFile[]>([]);
  const [availableFilesOrganizationId, setAvailableFilesOrganizationId] = useState<string | null>(null);
  const [availableFilesLoading, setAvailableFilesLoading] = useState(false);
  const [availableFilesNotice, setAvailableFilesNotice] = useState("");
  const [uploading, setUploading] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [notice, setNotice] = useState("");
  const [run, setRun] = useState<ExecutionState | null>(null);
  const [outputs, setOutputs] = useState<OutputFile[]>([]);
  const [pollInterval, setPollInterval] = useState(2500);
  const [logCopied, setLogCopied] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const executionLog = useMemo(() => run ? buildExecutionLog(run, batch?.graph) : [], [run, batch?.graph]);
  const executionLogText = useMemo(() => executionLogPlainText(executionLog), [executionLog]);

  useEffect(() => {
    const defaults = Object.fromEntries(fields.flatMap((field) => field.defaultValue === undefined ? [] : [[field.name, field.defaultValue]]));
    const drafts = Object.fromEntries(fields.filter((field) => field.kind === "json" && field.defaultValue !== undefined).map((field) => [field.name, JSON.stringify(field.defaultValue, null, 2)]));
    setValues(defaults);
    setJsonDrafts(drafts);
    setJsonErrors({});
    setUploads({});
    setRun(null);
    setOutputs([]);
    setNotice("");
  }, [batchId, fields]);

  useEffect(() => {
    if (!batch?.organizationId) {
      setAvailableFiles([]);
      setAvailableFilesOrganizationId(null);
      return;
    }
    setAvailableFiles([]);
    setAvailableFilesOrganizationId(null);
    const controller = new AbortController();
    setAvailableFilesLoading(true);
    setAvailableFilesNotice("");
    void fetch(`/api/files/available?organizationId=${encodeURIComponent(batch.organizationId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as AvailableInputFile[] | { error?: string };
        if (!response.ok || !Array.isArray(data)) throw new Error(errorMessage(data, "Impossibile leggere i file esistenti in Cubbit."));
        setAvailableFiles(data);
        setAvailableFilesOrganizationId(batch.organizationId);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setAvailableFilesNotice(cause instanceof Error ? cause.message : "Errore durante la lettura dei file Cubbit.");
      })
      .finally(() => { if (!controller.signal.aborted) setAvailableFilesLoading(false); });
    return () => controller.abort();
  }, [batch?.organizationId]);

  const requestBody = useMemo(() => buildBatchRunRequest(fields, values), [fields, values]);
  const requestPreview = useMemo(() => batch ? buildDashboardExecutionRequestPreview(batch.id, requestBody, idempotencyKey || "<UUID generato prima dell’invio>") : "", [batch, requestBody, idempotencyKey]);
  const publicCurlPreview = useMemo(() => batch ? buildPublicBatchRunCurlPreview(
    batch.slug,
    requestBody,
    idempotencyKey || "<UUID generato prima dell’invio>",
    process.env.NEXT_PUBLIC_API_URL || "https://api.pdforchestrator.com",
  ) : "", [batch, requestBody, idempotencyKey]);
  const missing = useMemo(() => missingRequiredRunInputs(fields, values), [fields, values]);
  const activeRunId = run?.id ?? null;
  const runStatus = run?.status ?? null;
  const completedRunId = run && ["COMPLETED", "SUCCEEDED"].includes(run.status) ? run.id : null;

  useEffect(() => {
    setIdempotencyKey(crypto.randomUUID());
  }, []);

  useEffect(() => {
    if (!activeRunId || !runStatus || isTerminal(runStatus)) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const response = await fetch(`/api/executions/${encodeURIComponent(activeRunId)}`, { cache: "no-store" });
        const data = await response.json() as ExecutionState & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "Impossibile leggere lo stato del job.");
        if (disposed) return;
        setRun(data);
        if (isTerminal(data.status)) return;
      } catch (cause) {
        if (!disposed) setNotice(cause instanceof Error ? cause.message : "Errore durante l’aggiornamento dello stato.");
      }
      if (!disposed) timer = setTimeout(poll, pollInterval);
    };
    timer = setTimeout(poll, pollInterval);
    return () => { disposed = true; if (timer) clearTimeout(timer); };
  }, [activeRunId, runStatus, pollInterval]);

  useEffect(() => {
    if (!completedRunId) return;
    let disposed = false;
    void fetch(`/api/executions/${encodeURIComponent(completedRunId)}/outputs`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as OutputFile[] | { error?: string };
        if (!response.ok) throw new Error(errorMessage(data, "Impossibile caricare l’elenco degli output."));
        if (!disposed) setOutputs(data as OutputFile[]);
      })
      .catch((cause: unknown) => { if (!disposed) setNotice(cause instanceof Error ? cause.message : "Errore durante il caricamento degli output."); });
    return () => { disposed = true; };
  }, [completedRunId]);

  function setValue(name: string, value: unknown) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  async function uploadFiles(field: RunInputField, selected: FileList | null) {
    if (!batch || !selected?.length) return;
    const files = Array.from(selected);
    const current = uploads[field.name] ?? [];
    const maxItems = field.kind === "pdf-list" ? field.maxItems : 1;
    if (field.kind === "pdf" && current.length) {
      setNotice(`Il campo ${field.name} accetta un solo PDF. Rimuovi prima il file attuale.`);
      return;
    }
    if (maxItems !== undefined && current.length + files.length > maxItems) {
      setNotice(`Il campo ${field.name} accetta al massimo ${maxItems} PDF.`);
      return;
    }
    setNotice("");
    setUploading(field.name);
    try {
      const uploaded: UploadedPdf[] = [];
      for (const file of files) {
        if (!file.name.toLowerCase().endsWith(".pdf") || file.size < 5 || file.size > 100 * 1024 * 1024) {
          throw new Error(`${file.name}: seleziona un PDF valido fino a 100 MB.`);
        }
        const content = await file.arrayBuffer();
        const signature = new TextDecoder().decode(content.slice(0, 5));
        if (signature !== "%PDF-") throw new Error(`${file.name}: il contenuto non ha la firma di un PDF.`);
        const digest = await crypto.subtle.digest("SHA-256", content);
        const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
        const signResponse = await fetch("/api/files/upload-url", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ organizationId: batch.organizationId, filename: file.name, sizeBytes: file.size, sha256 }),
        });
        const signed = await signResponse.json() as { fileId?: string; requestId?: string; uploadUrl?: string; headers?: Record<string, string>; error?: string };
        if (!signResponse.ok || !signed.fileId || !signed.requestId || !signed.uploadUrl) throw new Error(signed.error ?? `Impossibile preparare l’upload di ${file.name}.`);
        let uploadResponse: Response;
        try {
          uploadResponse = await fetch(signed.uploadUrl, { method: "PUT", headers: signed.headers, body: file });
        } catch {
          await reportUploadFailure({ fileId: signed.fileId, requestId: signed.requestId, phase: "PUT_NETWORK_ERROR" });
          throw new Error(`Connessione a Cubbit non riuscita per ${file.name}. Se il browser segnala un errore CORS, verifica che il bucket consenta PUT dall'origine ${window.location.origin} con gli header firmati; controlla anche endpoint e HTTPS.`);
        }
        if (!uploadResponse.ok) {
          const storageError = await describeStorageUploadError(uploadResponse, file.name);
          await reportUploadFailure({
            fileId: signed.fileId,
            requestId: signed.requestId,
            phase: "PUT_REJECTED",
            httpStatus: uploadResponse.status,
            storageCode: storageError.code,
            storageMessage: storageError.storageMessage,
            storageRequestId: storageError.storageRequestId,
          });
          throw new Error(storageError.message);
        }
        uploaded.push({ id: signed.fileId, filename: file.name, size: file.size });
        const next = field.kind === "pdf-list" ? [...current, ...uploaded] : uploaded;
        setUploads((state) => ({ ...state, [field.name]: next }));
        setValue(field.name, field.kind === "pdf-list" ? next.map((item) => item.id) : next[0]?.id);
      }
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Upload non riuscito.");
    } finally {
      setUploading(null);
    }
  }

  function removeUpload(field: RunInputField, fileId: string) {
    const next = (uploads[field.name] ?? []).filter((item) => item.id !== fileId);
    setUploads((state) => ({ ...state, [field.name]: next }));
    setValue(field.name, field.kind === "pdf-list" ? next.map((item) => item.id) : undefined);
  }

  function selectExistingFile(field: RunInputField, fileId: string) {
    if (!batch || availableFilesOrganizationId !== batch.organizationId) return;
    const file = availableFiles.find((item) => item.id === fileId);
    if (!file) return;
    const current = uploads[field.name] ?? [];
    if (current.some((item) => item.id === file.id)) return;
    const maxItems = field.kind === "pdf-list" ? field.maxItems : 1;
    if (maxItems !== undefined && current.length >= maxItems) {
      setNotice(`Il campo ${field.name} accetta al massimo ${maxItems} PDF.`);
      return;
    }
    const next = [...current, { id: file.id, filename: file.filename, size: Number(file.sizeBytes) }];
    setUploads((state) => ({ ...state, [field.name]: next }));
    setValue(field.name, field.kind === "pdf-list" ? next.map((item) => item.id) : file.id);
  }

  function updateJsonField(field: RunInputField, draft: string) {
    setJsonDrafts((state) => ({ ...state, [field.name]: draft }));
    try {
      const parsed: unknown = JSON.parse(draft);
      if (parsed === null || typeof parsed !== "object") throw new Error("Inserisci un oggetto o un elenco JSON.");
      setJsonErrors((state) => ({ ...state, [field.name]: "" }));
      setValue(field.name, parsed);
    } catch (cause) {
      setJsonErrors((state) => ({ ...state, [field.name]: cause instanceof Error ? cause.message : "JSON non valido." }));
    }
  }

  async function startExecution(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!batch) return;
    if (missing.length) { setNotice(`Compila i campi obbligatori: ${missing.join(", ")}.`); return; }
    const invalidJson = Object.entries(jsonErrors).filter(([, value]) => value).map(([key]) => key);
    if (invalidJson.length) { setNotice(`Correggi il JSON dei campi: ${invalidJson.join(", ")}.`); return; }
    setSubmitting(true);
    const requestIdempotencyKey = idempotencyKey || crypto.randomUUID();
    setIdempotencyKey(requestIdempotencyKey);
    setNotice("");
    setOutputs([]);
    try {
      const response = await fetch(`/api/batches/${encodeURIComponent(batch.id)}/executions`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": requestIdempotencyKey },
        body: JSON.stringify(requestBody),
      });
      const data = await response.json() as ExecutionState & { error?: string; issues?: Array<{ message?: string }> };
      if (!response.ok) throw new Error(data.issues?.map((issue) => issue.message).filter(Boolean).join(" ") || data.error || "Impossibile avviare il batch.");
      setRun({ ...data, batch: { name: batch.name }, batchVersion: { version: batch.version, graph: batch.graph } });
      setIdempotencyKey(crypto.randomUUID());
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Errore durante l’avvio dell’esecuzione.");
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelExecution() {
    if (!run) return;
    const response = await fetch(`/api/executions/${encodeURIComponent(run.id)}/cancel`, { method: "POST" });
    const data = await response.json() as ExecutionState & { error?: string };
    if (!response.ok) { setNotice(data.error ?? "Impossibile annullare il job."); return; }
    setRun((current) => current ? { ...current, ...data, events: current.events, steps: current.steps, batch: current.batch, batchVersion: current.batchVersion } : data);
  }

  async function copyExecutionLog() {
    try {
      const html = logRef.current?.innerHTML ?? "";
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write && html) {
        await navigator.clipboard.write([new ClipboardItem({
          "text/html": new Blob([`<div>${html}</div>`], { type: "text/html" }),
          "text/plain": new Blob([executionLogText], { type: "text/plain" }),
        })]);
      } else {
        await navigator.clipboard.writeText(executionLogText);
      }
      setLogCopied(true);
      window.setTimeout(() => setLogCopied(false), 1800);
    } catch {
      setNotice("Non è stato possibile copiare il log. Verifica i permessi degli appunti del browser.");
    }
  }

  if (!batches.length) return <section className="rounded-xl border border-[#293744] bg-[#101923] p-8 text-center"><p className="text-sm font-medium">Nessun batch pubblicato disponibile</p><p className="mt-2 text-xs text-slate-500">Servono un batch pubblicato e un ruolo OWNER, ADMIN o OPERATOR nell’organizzazione.</p></section>;

  return <>
    <label className="mb-5 block max-w-xl text-xs text-slate-400">Batch pubblicato
      <select value={batchId} onChange={(event) => setBatchId(event.target.value)} className="mt-2 block w-full rounded-lg border border-[#293744] bg-[#101923] px-3 py-3 text-sm text-slate-100 outline-none focus:border-[#4b6b9a]">
        {batches.map((item) => <option key={item.id} value={item.id}>{item.name} · v{item.version} · {item.slug}</option>)}
      </select>
    </label>

    {notice && <div role="alert" className="mb-5 flex gap-2 rounded-lg border border-amber-900/50 bg-amber-950/20 p-3 text-xs leading-5 text-amber-100"><CircleAlert size={16} className="mt-0.5 shrink-0"/>{notice}</div>}

    <div className="grid items-start gap-4 xl:grid-cols-[minmax(260px,0.95fr)_minmax(330px,1.2fr)_minmax(260px,0.95fr)]">
      <section className="min-w-0 rounded-xl border border-[#293744] bg-[#101923] p-4 sm:p-5">
        <div className="flex items-center justify-between"><div><p className="text-[10px] uppercase tracking-[.16em] text-[#2E7BFA]">1 · Request</p><h2 className="mt-1 text-sm font-semibold">JSON di esecuzione</h2></div><span className="rounded border border-[#2b3b47] px-2 py-1 text-[10px] text-slate-500">v{batch?.version}</span></div>
        <p className="mt-2 text-[11px] leading-5 text-slate-500">Body JSON della chiamata: usa i nomi pubblici definiti nello schema del batch. I PDF sono riferiti tramite ID StoredFile.</p>
        <pre className="mt-4 max-h-[480px] min-h-44 overflow-auto rounded-lg border border-[#202d38] bg-[#0b141d] p-3 text-[10px] leading-5 text-[#c3cddc]">{JSON.stringify(requestBody, null, 2)}</pre>
        <h3 className="mt-5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">cURL API pubblica · HMAC-SHA256</h3>
        <p className="mt-1 text-[9px] leading-4 text-slate-600">Include URL, batch, body, timestamp, nonce, hash, firma e chiave di idempotenza richiesti in produzione. Imposta PFO_KEY_ID e PFO_SECRET nell’ambiente della shell prima di eseguirlo.</p>
        <pre aria-label="Comando cURL completo per l’API pubblica" className="mt-2 max-h-[420px] overflow-auto whitespace-pre-wrap break-all rounded-lg border border-[#202d38] bg-[#0b141d] p-3 font-mono text-[9px] leading-4 text-[#c3cddc]">{publicCurlPreview}</pre>
        <p className="mt-3 break-all font-mono text-[10px] text-slate-600">Endpoint dashboard: POST /api/batches/{batch?.id}/executions</p>
        {missing.length > 0 && <p className="mt-3 text-[10px] text-amber-300">Richiesti: {missing.join(", ")}</p>}
      </section>

      <form onSubmit={startExecution} className="min-w-0 rounded-xl border border-[#293744] bg-[#101923] p-4 sm:p-5">
        <div><p className="text-[10px] uppercase tracking-[.16em] text-[#2E7BFA]">2 · Input</p><h2 className="mt-1 text-sm font-semibold">Parametri del batch</h2></div>
        {!fields.length ? <p className="mt-5 rounded-lg border border-[#293744] p-4 text-xs text-slate-500">Questo batch non dichiara parametri di input.</p> : <div className="mt-4 space-y-4">
          {fields.map((field) => <InputControl key={field.name} field={field} value={values[field.name]} jsonDraft={jsonDrafts[field.name]} jsonError={jsonErrors[field.name]} uploads={uploads[field.name] ?? []} availableFiles={availableFilesOrganizationId === batch?.organizationId ? availableFiles : []} availableFilesLoading={availableFilesLoading} uploading={uploading === field.name} onValue={(value) => setValue(field.name, value)} onJson={(draft) => updateJsonField(field, draft)} onFiles={(files) => void uploadFiles(field, files)} onExisting={(fileId) => selectExistingFile(field, fileId)} onRemove={(fileId) => removeUpload(field, fileId)}/>) }
        </div>}
        {availableFilesNotice && <p role="status" className="mt-3 text-[10px] text-amber-300">{availableFilesNotice}</p>}
        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-[#25313c] pt-4">
          <button type="submit" disabled={submitting || Boolean(uploading) || Boolean(run && !isTerminal(run.status)) || missing.length > 0 || Object.values(jsonErrors).some(Boolean)} className="inline-flex items-center gap-2 rounded-lg bg-[#136EF9] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#2E7BFA] disabled:cursor-not-allowed disabled:opacity-40"><Play size={14}/>{submitting ? "Accodamento…" : "Avvia batch"}</button>
          <span className="text-[10px] text-slate-600">L’esecuzione viene elaborata dal worker esterno.</span>
        </div>
        <label className="mt-5 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Anteprima chiamata API</label>
        <p className="mt-1 text-[9px] leading-4 text-slate-600">Questa pagina usa la sessione dashboard; il browser invia il cookie same-origin. Non genera né espone Access Key o Secret.</p>
        <textarea readOnly aria-label="Anteprima completa della chiamata API del batch" value={requestPreview} rows={12} spellCheck={false} className="mt-2 block w-full resize-y rounded-lg border border-[#263541] bg-[#0b141d] p-3 font-mono text-[9px] leading-4 text-[#b9c9df] outline-none focus:border-[#136EF9]"/>
      </form>

      <section className="min-w-0 rounded-xl border border-[#293744] bg-[#101923] p-4 sm:p-5">
        <div><p className="text-[10px] uppercase tracking-[.16em] text-[#2E7BFA]">3 · Output</p><h2 className="mt-1 text-sm font-semibold">Risultato e download</h2></div>
        {run ? <div className="mt-4">
          <div className="flex items-center justify-between gap-3"><span className="font-mono text-[10px] text-slate-500">{run.id}</span><span className={`rounded-full px-2.5 py-1 text-[10px] ${["COMPLETED", "SUCCEEDED"].includes(run.status) ? "bg-emerald-950 text-emerald-300" : run.status === "FAILED" ? "bg-red-950 text-red-300" : "bg-[#142236] text-[#84a8de]"}`}>{run.status}</span></div>
          <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-[#7aadff] transition-all" style={{ width: `${Math.max(0, Math.min(100, run.progress ?? 0))}%` }}/></div>
          <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500"><span>{run.currentStepId ? `Step: ${run.currentStepId}` : isTerminal(run.status) ? "Elaborazione terminata" : "In coda o in elaborazione"}</span><span>{run.progress ?? 0}%</span></div>
          {!isTerminal(run.status) && <div className="mt-3 flex items-center justify-between"><button onClick={() => void cancelExecution()} className="text-[10px] text-rose-300 hover:text-rose-200">Annulla job</button><label className="flex items-center gap-2 text-[10px] text-slate-500">Polling<select value={pollInterval} onChange={(event) => setPollInterval(Number(event.target.value))} className="rounded border border-[#293744] bg-[#0b141d] px-2 py-1 text-[10px] text-slate-300"><option value={1500}>1,5 s</option><option value={2500}>2,5 s</option><option value={5000}>5 s</option><option value={10000}>10 s</option></select></label></div>}
          {!isTerminal(run.status) && <p className="mt-4 flex items-center gap-2 text-[10px] text-slate-500"><LoaderCircle size={13} className="animate-spin"/>Il job è asincrono; questa pagina aggiorna lo stato via HTTP.</p>}
          <div className="mt-5 border-t border-[#25313c] pt-4">
            <div className="flex items-center justify-between gap-2"><div><h3 className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Log dettagliato del job</h3><p className="mt-1 text-[9px] text-slate-600">Timestamp, stati, input, output e variabili registrati dal worker.</p></div><button type="button" onClick={() => void copyExecutionLog()} disabled={!executionLog.length} className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#34465b] px-2.5 py-1.5 text-[10px] text-[#a9c8f6] transition hover:bg-[#15243a] disabled:opacity-40" aria-label="Copia il log dettagliato">{logCopied ? <Check size={12}/> : <Copy size={12}/>} {logCopied ? "Copiato" : "Copia"}</button></div>
            <div ref={logRef} role="textbox" aria-label="Log RTF di avanzamento del batch" aria-readonly="true" tabIndex={0} className="mt-3 max-h-[380px] min-h-28 overflow-auto whitespace-pre-wrap rounded-lg border border-[#263541] bg-[#0b141d] p-3 text-[10px] leading-5 text-slate-300">
              {executionLog.map((entry) => <article key={entry.id} className="mb-4 last:mb-0"><div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5"><strong className="font-semibold text-[#c6d9f5]">{entry.heading}</strong><time className="font-mono text-[9px] text-slate-600">{entry.timestamp ? new Date(entry.timestamp).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "medium" }) : "Timestamp non disponibile"}</time></div><p className="mt-0.5 text-[9px] text-slate-400">Stato: <u className="decoration-[#7eafff] underline-offset-2">{entry.state}</u></p>{entry.details.map((detail) => <div key={`${entry.id}:${detail.label}`} className="mt-1"><span className="font-medium text-slate-400">{detail.label}:</span><pre className="mt-0.5 overflow-x-auto rounded bg-[#081019] p-2 font-mono text-[9px] leading-4 text-slate-300">{detail.value}</pre></div>)}</article>)}
              {!executionLog.length && <p className="text-[10px] text-slate-600">In attesa dei dati persistenti del job…</p>}
            </div>
          </div>
          {run.status === "FAILED" && <pre className="mt-4 max-h-32 overflow-auto rounded-lg border border-red-900/40 bg-red-950/20 p-3 text-[10px] text-red-200">{JSON.stringify(run.error ?? { message: "Il worker ha segnalato un errore." }, null, 2)}</pre>}
          {outputs.length > 0 ? <div className="mt-4 space-y-2">{outputs.map((file) => <article key={file.id} className="flex items-center gap-3 rounded-lg border border-[#293744] bg-[#0d1720] p-3"><File size={16} className="shrink-0 text-[#93bcff]"/><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{file.filename}</p><p className="mt-1 text-[10px] text-slate-500">{file.mimeType} · {formatBytes(Number(file.sizeBytes))}</p></div><a href={file.downloadUrl} download={file.filename} className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#36455b] px-2.5 py-2 text-[10px] text-[#8dafe2] hover:bg-[#131f30]"><Download size={13}/>Scarica</a></article>)}</div> : ["COMPLETED", "SUCCEEDED"].includes(run.status) ? <p className="mt-4 flex items-center gap-2 text-xs text-amber-200"><CheckCircle2 size={15}/>Esecuzione completata senza artifact PDF registrati.</p> : null}
          {run.output !== undefined && <><h3 className="mt-5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Dati output</h3><pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-[#0b141d] p-3 text-[10px] leading-5 text-slate-300">{JSON.stringify(run.output, null, 2)}</pre></>}
        </div> : null}
      </section>
    </div>
  </>;
}

function InputControl({ field, value, jsonDraft, jsonError, uploads, availableFiles, availableFilesLoading, uploading, onValue, onJson, onFiles, onExisting, onRemove }: {
  field: RunInputField;
  value: unknown;
  jsonDraft?: string;
  jsonError?: string;
  uploads: UploadedPdf[];
  availableFiles: AvailableInputFile[];
  availableFilesLoading: boolean;
  uploading: boolean;
  onValue: (value: unknown) => void;
  onJson: (draft: string) => void;
  onFiles: (files: FileList | null) => void;
  onExisting: (fileId: string) => void;
  onRemove: (fileId: string) => void;
}) {
  const base = "mt-1.5 block w-full rounded-lg border border-[#2b3b47] bg-[#0b141d] px-3 py-2.5 text-xs text-slate-100 outline-none focus:border-[#4b6b9a]";
  return <label className="block text-xs text-slate-300"><span className="flex items-center gap-2 font-medium">{field.label}{field.required && <span className="text-[9px] uppercase tracking-wide text-amber-300">obbligatorio</span>}</span>
    {field.description && <span className="mt-1 block text-[10px] leading-4 text-slate-500">{field.description}</span>}
    {field.kind === "pdf" || field.kind === "pdf-list" ? <div className="mt-2 rounded-lg border border-dashed border-[#354650] bg-[#0d1720] p-3">
      <span className="flex items-center gap-2 text-[10px] text-slate-400"><UploadCloud size={14} className="text-[#779ed9]"/>{field.kind === "pdf-list" ? "Carica uno o più PDF; l’ordine della selezione determina l’ordine della lista." : "Carica un PDF."}</span>
      <input type="file" accept="application/pdf,.pdf" multiple={field.kind === "pdf-list"} disabled={uploading} onChange={(event) => { onFiles(event.currentTarget.files); event.currentTarget.value = ""; }} className="mt-3 block w-full text-[10px] text-slate-400 file:mr-3 file:rounded-md file:border-0 file:bg-[#202e42] file:px-3 file:py-2 file:text-[10px] file:font-medium file:text-[#b5ccef] disabled:opacity-40"/>
      <label className="mt-3 block text-[10px] text-slate-500">Oppure seleziona un PDF già presente in Cubbit<select value="" disabled={availableFilesLoading || !availableFiles.length} onChange={(event) => { if (event.target.value) onExisting(event.target.value); }} className="mt-1.5 block w-full rounded-md border border-[#2b3b47] bg-[#0b141d] px-2.5 py-2 text-[10px] text-slate-200 disabled:opacity-50"><option value="">{availableFilesLoading ? "Caricamento file…" : availableFiles.length ? "Scegli un file esistente…" : "Nessun PDF disponibile"}</option>{availableFiles.map((file) => <option key={file.id} value={file.id}>{file.filename} · {formatBytes(Number(file.sizeBytes))}</option>)}</select></label>
      {uploading && <p className="mt-2 flex items-center gap-2 text-[10px] text-[#89abdd]"><LoaderCircle size={12} className="animate-spin"/>Upload verso Cubbit…</p>}
      {uploads.length > 0 && <ol className="mt-3 space-y-1.5">{uploads.map((file, index) => <li key={file.id} className="flex items-center gap-2 rounded border border-[#263540] px-2 py-2 text-[10px]"><span className="w-5 text-slate-600">{field.kind === "pdf-list" ? `${index + 1}.` : ""}</span><File size={13} className="shrink-0 text-[#789ed8]"/><span className="min-w-0 flex-1 truncate">{file.filename}</span><span className="shrink-0 text-slate-600">{formatBytes(file.size)}</span><button type="button" onClick={() => onRemove(file.id)} aria-label={`Rimuovi ${file.filename}`} className="px-1 text-rose-300">×</button></li>)}</ol>}
      {typeof value === "string" && field.kind === "pdf" && <span className="sr-only">File ID {value}</span>}
    </div> : field.kind === "json" ? <><textarea value={jsonDraft ?? (value === undefined ? "" : JSON.stringify(value, null, 2))} onChange={(event) => onJson(event.target.value)} rows={5} spellCheck={false} placeholder={field.defaultValue === undefined ? "{}" : undefined} className={`${base} resize-y font-mono text-[10px]`} aria-invalid={Boolean(jsonError)}/>{jsonError && <span className="mt-1 block text-[10px] text-rose-300">{jsonError}</span>}</>
    : field.enumValues?.length ? <select value={value === undefined ? "" : String(value)} onChange={(event) => { const found = field.enumValues?.find((entry) => String(entry) === event.target.value); onValue(found); }} className={base}><option value="" disabled>Seleziona…</option>{field.enumValues.map((entry) => <option key={String(entry)} value={String(entry)}>{String(entry)}</option>)}</select>
    : field.kind === "boolean" ? <select value={value === undefined ? "" : String(value)} onChange={(event) => onValue(event.target.value === "" ? undefined : event.target.value === "true")} className={base}><option value="">Seleziona…</option><option value="true">Sì</option><option value="false">No</option></select>
    : field.kind === "number" ? <input type="number" step={field.integer ? 1 : "any"} value={typeof value === "number" ? value : ""} min={field.minimum} max={field.maximum} onChange={(event) => onValue(event.target.value === "" ? undefined : Number(event.target.value))} className={base}/>
    : <input type="text" value={typeof value === "string" ? value : ""} minLength={field.minLength} maxLength={field.maxLength} pattern={field.pattern} onChange={(event) => onValue(event.target.value === "" && !field.required ? undefined : event.target.value)} className={base}/>
    }
  </label>;
}
