import "server-only";
import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { prisma } from "@/lib/prisma";
import { createStorageClient, getStorageConfig } from "@/lib/storage";
import { describeHealthVariable, serviceHealthSchema, type ServiceHealth } from "@/lib/admin-service-health-schema";

type Variable = ServiceHealth["services"][number]["variables"][number];
type ServiceResult = ServiceHealth["services"][number];
const timeoutMs = 5_000;
const staleAfterMs = 90_000;

class SafeHealthError extends Error {}

function envVariable(name: string, options: { aliases?: string[]; sensitive?: boolean; transform?: (value: string) => string } = {}): Variable {
  return describeHealthVariable(process.env, name, options);
}

function hostOnly(value: string) {
  try { const url = new URL(value); return url.host; } catch { return "Valore configurato"; }
}

async function timed(id: string, label: string, variables: Variable[], check: () => Promise<{ message: string; details?: string[]; status?: ServiceResult["status"] }>): Promise<ServiceResult> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([check(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Timeout dopo 5 secondi.")), timeoutMs); })]);
    return { id, label, status: result.status ?? "ok", message: result.message, durationMs: Date.now() - started, variables, details: result.details ?? [] };
  } catch (error) {
    let message = "Controllo non riuscito; i dettagli tecnici sono stati omessi per proteggere la configurazione.";
    if (error instanceof SafeHealthError) message = error.message;
    else if (error instanceof Error && error.name === "TimeoutError") message = "Timeout dopo 5 secondi.";
    else if (error instanceof Error && /^Supabase Auth ha risposto HTTP \d+\.$/.test(error.message)) message = error.message;
    else if (error instanceof Error && /^API worker ha risposto HTTP \d+\.$/.test(error.message)) message = error.message;
    else if (typeof error === "object" && error !== null && "$metadata" in error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status) message = `Il server filesystem ha risposto HTTP ${status}.`;
    }
    return { id, label, status: "error", message, durationMs: Date.now() - started, variables, details: [] };
  } finally { if (timer) clearTimeout(timer); }
}

export async function checkExternalServices(): Promise<ServiceHealth> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  const databaseUrl = process.env.DATABASE_URL;
  const appUrl = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.PUBLIC_API_URL;
  const results = await Promise.all([
    timed("supabase", "Supabase Auth", [
      envVariable("SUPABASE_URL", { transform: hostOnly }),
      envVariable("SUPABASE_PUBLISHABLE_KEY", { aliases: ["SUPABASE_ANON_KEY"], sensitive: true }),
      envVariable("SUPABASE_SERVICE_ROLE_KEY", { sensitive: true }),
    ], async () => {
      if (!supabaseUrl || !supabaseKey) throw new SafeHealthError("SUPABASE_URL o chiave publishable non configurata.");
      const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/health`, { headers: { apikey: supabaseKey }, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
      if (!response.ok) throw new SafeHealthError(`Supabase Auth ha risposto HTTP ${response.status}.`);
      const payload: unknown = await response.json().catch(() => null);
      const details: string[] = [];
      if (typeof payload === "object" && payload !== null) {
        const fields = payload as Record<string, unknown>;
        if (typeof fields.version === "string") details.push(`Versione GoTrue: ${fields.version.slice(0, 40)}`);
        if (typeof fields.name === "string") details.push(`Servizio: ${fields.name.slice(0, 60)}`);
        if (typeof fields.description === "string") details.push(fields.description.slice(0, 160));
      }
      return { message: `Supabase Auth ha risposto HTTP ${response.status}.`, details };
    }),
    timed("cubbit", "Cubbit S3", [
      envVariable("S3_ENDPOINT", { aliases: ["CUBBIT_S3_ENDPOINT"], transform: hostOnly }),
      envVariable("S3_REGION", { aliases: ["CUBBIT_S3_REGION"] }),
      envVariable("S3_BUCKET", { aliases: ["CUBBIT_S3_BUCKET"] }),
      envVariable("S3_ACCESS_KEY_ID", { aliases: ["CUBBIT_S3_ACCESS_KEY_ID"], sensitive: true }),
      envVariable("S3_SECRET_ACCESS_KEY", { aliases: ["CUBBIT_S3_SECRET_ACCESS_KEY"], sensitive: true }),
    ], async () => {
      const config = getStorageConfig();
      const response = await createStorageClient().send(new HeadBucketCommand({ Bucket: config.bucket }), { abortSignal: AbortSignal.timeout(timeoutMs) });
      return { message: `Accesso in lettura al bucket ${config.bucket} riuscito.`, details: [`HeadBucket HTTP ${response.$metadata.httpStatusCode ?? "200"}`, `Region: ${config.region}`, `Path style: ${config.forcePathStyle ? "attivo" : "disattivo"}`] };
    }),
    timed("neon", "Neon PostgreSQL", [
      envVariable("DATABASE_URL", { transform: (value) => { try { const parsed = new URL(value); return `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}/${parsed.pathname.replace(/^\//, "")}`; } catch { return "URL configurato"; } } }),
      envVariable("DIRECT_URL", { transform: (value) => hostOnly(value) }),
      envVariable("DATABASE_POOL_MAX"),
    ], async () => {
      if (!databaseUrl) throw new Error("DATABASE_URL non configurata.");
      const rows = await prisma.$queryRaw<Array<{ result: number }>>`SELECT 1 AS result`;
      return { message: "Query di verifica completata correttamente.", details: [`Risposta SELECT 1: ${rows[0]?.result ?? "nessun risultato"}`, "Connessione runtime tramite DATABASE_URL."] };
    }),
    timed("app-config", "Configurazione applicativa", [
      envVariable("PFO_CREDENTIAL_MASTER_KEY", { sensitive: true }),
      envVariable("NEXT_PUBLIC_SITE_URL", { aliases: ["PUBLIC_API_URL"], transform: hostOnly }),
      envVariable("PFO_RATE_LIMIT_RPM"),
      envVariable("PFO_MAX_UPLOAD_BYTES"),
      envVariable("PFO_RETENTION_DAYS"),
    ], async () => {
      const key = process.env.PFO_CREDENTIAL_MASTER_KEY;
      if (!key) throw new SafeHealthError("PFO_CREDENTIAL_MASTER_KEY non configurata.");
      const decoded = /^[a-f\d]{64}$/i.test(key) ? Buffer.from(key, "hex") : Buffer.from(key, "base64");
      if (decoded.length !== 32) throw new SafeHealthError("PFO_CREDENTIAL_MASTER_KEY non è una chiave AES-256 valida.");
      return { message: "Chiave AES-256 valida; limiti applicativi caricati.", details: ["I valori delle chiavi e dei segreti sono nascosti."] };
    }),
    timed("worker", "Worker Python", [
      envVariable("WORKER_SHARED_SECRET", { sensitive: true }),
      envVariable("NEXT_PUBLIC_SITE_URL", { aliases: ["PUBLIC_API_URL"], transform: hostOnly }),
    ], async () => {
      if (!process.env.WORKER_SHARED_SECRET || process.env.WORKER_SHARED_SECRET.length < 32) throw new SafeHealthError("WORKER_SHARED_SECRET assente o più corto di 32 caratteri.");
      if (!appUrl) throw new SafeHealthError("NEXT_PUBLIC_SITE_URL o PUBLIC_API_URL non configurata.");
      const apiUrl = new URL("/api/internal/worker/health", appUrl);
      const apiResponse = await fetch(apiUrl, { headers: { authorization: `Bearer ${process.env.WORKER_SHARED_SECRET}` }, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
      if (!apiResponse.ok) throw new SafeHealthError(`API worker ha risposto HTTP ${apiResponse.status}.`);
      const cutoff = new Date(Date.now() - staleAfterMs);
      const workers = await prisma.workerHeartbeat.findMany({ where: { lastSeenAt: { gte: cutoff } }, orderBy: { lastSeenAt: "desc" }, take: 20 });
      if (!workers.length) throw new SafeHealthError("Nessun heartbeat ricevuto negli ultimi 90 secondi.");
      const latest = workers[0]!;
      return { message: `API worker raggiungibile; ${workers.length} processo/i worker online; ultimo heartbeat ${Math.max(0, Math.floor((Date.now() - latest.lastSeenAt.getTime()) / 1000))}s fa.`, details: workers.map((worker) => `${worker.workerId} · v${worker.version ?? "n/d"} · concorrenza ${worker.concurrency} · ${worker.lastSeenAt.toISOString()}`) };
    }),
  ]);
  return serviceHealthSchema.parse({ checkedAt: new Date().toISOString(), services: results });
}
