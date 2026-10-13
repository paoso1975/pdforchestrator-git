export type ExecutionLogStep = {
  nodeId: string;
  toolId?: string;
  toolVersion?: string;
  status: string;
  progress?: number;
  attempts?: number;
  input?: unknown;
  parameters?: unknown;
  variablesIn?: unknown;
  variablesOut?: unknown;
  executionString?: string | null;
  output?: unknown;
  error?: unknown;
  createdAt?: string | Date | null;
  startedAt?: string | Date | null;
  completedAt?: string | Date | null;
};

export type ExecutionLogEvent = { id: string; type: string; payload: unknown; createdAt: string | Date };
export type ExecutionLogData = {
  id: string;
  status: string;
  progress?: number;
  input?: unknown;
  origin?: string;
  requestedByUserId?: string | null;
  credentialId?: string | null;
  requestId?: string | null;
  requestMethod?: string | null;
  requestPath?: string | null;
  executionString?: string;
  output?: unknown;
  error?: unknown;
  createdAt?: string | Date | null;
  startedAt?: string | Date | null;
  completedAt?: string | Date | null;
  events?: ExecutionLogEvent[];
  steps?: ExecutionLogStep[];
  batch?: { name?: string } | null;
  batchVersion?: { version?: number; graph?: unknown } | null;
};

export type ExecutionLogDetail = { label: string; value: string };
export type ExecutionLogEntry = { id: string; timestamp: string | Date | null; heading: string; state: string; details: ExecutionLogDetail[] };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function redact(value: unknown, key?: string): unknown {
  if (key && /(secret|password|passwd|token|authorization|api[-_]?key|access[-_]?key|private[-_]?key)/i.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.slice(0, 250).map((item) => redact(item));
  const object = record(value);
  if (object) return Object.fromEntries(Object.entries(object).slice(0, 250).map(([name, item]) => [name, redact(item, name)]));
  if (typeof value === "string" && value.length > 8_000) return `${value.slice(0, 8_000)}… contenuto abbreviato`;
  return value;
}

function printable(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    const serialized = JSON.stringify(redact(value), null, 2);
    if (serialized === undefined) return String(value);
    return serialized.length > 12000 ? `${serialized.slice(0, 12000)}\n… contenuto abbreviato` : serialized;
  } catch { return "Valore non serializzabile"; }
}

function graphNodeLabels(graph: unknown): Map<string, string> {
  const nodes = record(graph)?.nodes;
  if (!Array.isArray(nodes)) return new Map();
  const labels = new Map<string, string>();
  for (const item of nodes) {
    const node = record(item);
    const data = record(node?.data);
    if (typeof node?.id === "string") labels.set(node.id, typeof data?.label === "string" ? data.label : typeof data?.toolId === "string" ? data.toolId : node.id);
  }
  return labels;
}

function detailsFrom(value: Record<string, unknown>, includeProgress: boolean): ExecutionLogDetail[] {
  const details: ExecutionLogDetail[] = [];
  if (value.input !== undefined) details.push({ label: "Input blocco", value: printable(value.input) });
  if (value.parameters !== undefined) details.push({ label: "Parametri risolti", value: printable(value.parameters) });
  if (value.variablesIn !== undefined) details.push({ label: "Variabili in ingresso (workflow/loop)", value: printable(value.variablesIn) });
  if (value.variablesOut !== undefined) details.push({ label: "Variabili in uscita (workflow/loop)", value: printable(value.variablesOut) });
  if (value.output !== undefined) details.push({ label: "Output blocco", value: printable(value.output) });
  if (typeof value.executionString === "string" && value.executionString) details.push({ label: "Stringa di esecuzione", value: value.executionString });
  if (value.error !== undefined) details.push({ label: "Errore", value: printable(value.error) });
  if (includeProgress && typeof value.progress === "number") details.push({ label: "Avanzamento blocco", value: `${value.progress}%` });
  if (typeof value.attempts === "number") details.push({ label: "Tentativi", value: String(value.attempts) });
  if (typeof value.workerEvent === "string") details.push({ label: "Evento", value: value.workerEvent });
  return details;
}

export function buildExecutionLog(data: ExecutionLogData, fallbackGraph?: unknown): ExecutionLogEntry[] {
  const entries: ExecutionLogEntry[] = [];
  const graph = data.batchVersion?.graph ?? fallbackGraph;
  const labels = graphNodeLabels(graph);
  const createdAt = data.createdAt ?? null;
  entries.push({
    id: `run:${data.id}:start`, timestamp: createdAt, heading: "Avvio job",
    state: data.status,
    details: [{ label: "Run ID", value: data.id }, { label: "Stato job", value: data.status }, ...(data.origin ? [{ label: "Provenienza", value: data.origin }] : []), ...(data.requestedByUserId ? [{ label: "Utente richiedente ID", value: data.requestedByUserId }] : []), ...(data.credentialId ? [{ label: "Credenziale ID", value: data.credentialId }] : []), ...(data.requestId ? [{ label: "Request ID", value: data.requestId }] : []), ...(data.requestMethod && data.requestPath ? [{ label: "Richiesta HTTP", value: `${data.requestMethod} ${data.requestPath}` }] : [])],
  });
  entries.push({
    id: `run:${data.id}:input`, timestamp: createdAt, heading: "Recepimento parametri di ingresso API",
    state: "INPUT RICEVUTO",
    details: [{ label: "Batch", value: data.batch?.name ?? "Batch" }, ...(data.batchVersion?.version ? [{ label: "Versione", value: `v${data.batchVersion.version}` }] : []), { label: "Parametri iniziali", value: printable(data.input ?? {}) }, ...(data.executionString ? [{ label: "Stringa della richiesta", value: data.executionString }] : [])],
  });

  const eventSteps = new Set<string>();
  for (const event of data.events ?? []) {
    const payload = record(event.payload) ?? {};
    const nodeId = typeof payload.nodeId === "string" ? payload.nodeId : null;
    if (nodeId && (event.type === "STEP_UPDATE" || event.type.startsWith("STEP_"))) {
      eventSteps.add(`${nodeId}:${String(payload.status ?? "")}`);
      const toolId = typeof payload.toolId === "string" ? payload.toolId : "blocco";
      const version = typeof payload.toolVersion === "string" ? ` · v${payload.toolVersion}` : "";
      const title = labels.get(nodeId) ?? toolId;
      entries.push({
        id: `event:${event.id}`, timestamp: event.createdAt,
        heading: `${title} · ${toolId}${version}`,
        state: typeof payload.status === "string" ? payload.status : event.type,
        details: [{ label: "Node ID", value: nodeId }, ...detailsFrom(payload, true)],
      });
    } else if (event.type !== "QUEUED") {
      entries.push({
        id: `event:${event.id}`, timestamp: event.createdAt,
        heading: event.type === "WORKER_CLAIMED" ? "Worker attivato" : event.type === "LEASE_RECOVERED" ? "Job recuperato dal worker" : `Evento job: ${event.type}`,
        state: event.type,
        details: Object.keys(payload).length ? [{ label: "Dettagli", value: printable(payload) }] : [],
      });
    }
  }

  for (const step of data.steps ?? []) {
    const title = labels.get(step.nodeId) ?? step.toolId ?? "Blocco";
    const hasLoggedState = eventSteps.has(`${step.nodeId}:${step.status}`);
    if (!hasLoggedState) entries.push({
      id: `step:${step.nodeId}:${step.status}`,
      timestamp: step.completedAt ?? step.startedAt ?? step.createdAt ?? null,
      heading: `${title} · ${step.toolId ?? "blocco"}${step.toolVersion ? ` · v${step.toolVersion}` : ""}`,
      state: step.status,
      details: [{ label: "Node ID", value: step.nodeId }, ...detailsFrom(step as Record<string, unknown>, true)],
    });
  }

  if (data.error !== undefined && data.error !== null) entries.push({ id: `run:${data.id}:error`, timestamp: data.completedAt ?? null, heading: "Errore del job", state: "FAILED", details: [{ label: "Errore", value: printable(data.error) }] });
  if (data.output !== undefined && data.output !== null) entries.push({ id: `run:${data.id}:output`, timestamp: data.completedAt ?? null, heading: "Output finali del job", state: data.status, details: [{ label: "Output finale", value: printable(data.output) }] });

  return entries.map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const aTime = a.entry.timestamp ? new Date(a.entry.timestamp).getTime() : 0;
      const bTime = b.entry.timestamp ? new Date(b.entry.timestamp).getTime() : 0;
      return aTime - bTime || a.index - b.index;
    })
    .map(({ entry }) => entry);
}

export function executionLogPlainText(entries: ExecutionLogEntry[]): string {
  return entries.map((entry) => [
    `${entry.timestamp ? new Date(entry.timestamp).toISOString() : "Timestamp non disponibile"} | ${entry.heading}`,
    `Stato: ${entry.state}`,
    ...entry.details.map((detail) => `${detail.label}:\n${detail.value}`),
  ].join("\n")).join("\n\n");
}
