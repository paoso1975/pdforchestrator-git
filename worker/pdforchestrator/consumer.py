from __future__ import annotations

import concurrent.futures
import hashlib
import hmac
import ipaddress
import logging
import os
import socket
import tempfile
import threading
import time
import uuid
from urllib.parse import urlsplit
from pathlib import Path
from typing import Any

import httpx

from .storage import StorageAdapter
from .runtime import cleanup_stale_temp_dirs, is_plan_replay_safe
from .tools import ToolContext, ToolError, build_registry
from .workflow import WorkflowExecutor

log = logging.getLogger("pdforchestrator.worker")


class WorkerApi:
    def __init__(self, base_url: str, secret: str):
        if len(secret) < 32: raise RuntimeError("WORKER_SHARED_SECRET deve contenere almeno 32 caratteri.")
        self.base = base_url.rstrip("/"); self.client = httpx.Client(timeout=30, headers={"authorization": f"Bearer {secret}"})

    def post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        response = self.client.post(f"{self.base}/{path.lstrip('/')}", json=body); response.raise_for_status(); return response.json()

    def claim(self, worker_id: str, lease_seconds: int) -> dict[str, Any] | None:
        data = self.post("jobs/claim", {"workerId": worker_id, "leaseSeconds": lease_seconds}); return data if data.get("job") else None


class JobConsumer:
    def __init__(self):
        base = os.environ.get("PDFORCH_API_BASE_URL", "").rstrip("/"); secret = os.environ.get("WORKER_SHARED_SECRET", "")
        if not base: raise RuntimeError("PDFORCH_API_BASE_URL non configurato.")
        self.api = WorkerApi(base, secret); self.storage = StorageAdapter(); self.registry = build_registry()
        self.worker_id = f"{os.environ.get('WORKER_ID', 'worker')}-{socket.gethostname()}-{uuid.uuid4().hex[:8]}"
        self.concurrency = max(1, min(16, int(os.environ.get("WORKER_CONCURRENCY", "1"))))
        self.version = os.environ.get("WORKER_VERSION", "1.0.0")
        self.heartbeat_seconds = max(15, int(os.environ.get("WORKER_HEARTBEAT_SECONDS", "30")))
        self.lease_seconds = max(30, min(900, int(os.environ.get("WORKER_LEASE_SECONDS", "180"))))
        self.poll_seconds = max(1, int(os.environ.get("WORKER_POLL_SECONDS", "3")))
        self.max_bytes = int(os.environ.get("WORKER_MAX_PDF_BYTES", str(100 * 1024 * 1024)))
        self.max_pages = int(os.environ.get("WORKER_MAX_PAGES", "1000"))
        self.job_timeout = int(os.environ.get("WORKER_JOB_TIMEOUT_SECONDS", "3600"))
        self.temp_root = os.environ.get("WORKER_TEMP_ROOT") or str(Path(tempfile.gettempdir()) / "pdf-orchestrator")
        if self.temp_root:
            self.temp_root = str(Path(self.temp_root).resolve())
            Path(self.temp_root).mkdir(parents=True, exist_ok=True)
            removed = cleanup_stale_temp_dirs(self.temp_root, int(os.environ.get("WORKER_TEMP_RETENTION_HOURS", "24")))
            if removed:
                log.info("Removed stale worker temporary directories", extra={"removedCount": removed})
        self.stopping = threading.Event()

    def _heartbeat_loop(self, job: dict[str, Any], worker_id: str, cancelled: threading.Event, started: float) -> None:
        execution_id = job["id"]; interval = max(5, self.lease_seconds // 3)
        while True:
            if self.stopping.wait(interval):
                cancelled.set()
                return
            if time.monotonic() - started > self.job_timeout:
                log.error("Job %s exceeded configured timeout", execution_id); cancelled.set(); return
            try:
                response = self.api.post(f"jobs/{execution_id}/heartbeat", {"workerId": worker_id, "leaseSeconds": self.lease_seconds})
                if response.get("cancelRequested"):
                    log.info("Cancellation requested for %s", execution_id); cancelled.set(); return
            except Exception:
                log.exception("Heartbeat failed for %s; stopping processing", execution_id); cancelled.set(); return

    def _step(self, execution_id: str, worker_id: str, item: dict[str, Any], attempts: int) -> None:
        payload = {"workerId": worker_id, **item}; payload.setdefault("attempts", attempts)
        self.api.post(f"jobs/{execution_id}/steps", payload)

    def _record_unhandled_step_failure(self, execution_id: str, worker_id: str, attempts: int, last_operation: dict[str, Any], error: dict[str, str]) -> None:
        if last_operation.get("status") != "RUNNING": return
        failed = {**last_operation, "status": "FAILED", "progress": 0, "error": error, "event": "STEP_FAILED"}
        try: self._step(execution_id, worker_id, failed, attempts)
        except Exception: log.exception("Could not append failed operation details for %s", execution_id)

    def process(self, claim: dict[str, Any], worker_id: str) -> None:
        job = claim["job"] if "job" in claim else claim; execution_id = job["id"]; started = time.monotonic(); cancelled = threading.Event()
        last_operation: dict[str, Any] = {}
        def report(item: dict[str, Any]) -> None:
            if last_operation.get("nodeId") == item.get("nodeId") and item.get("status") == "RUNNING":
                last_operation.update(item)
            else:
                last_operation.clear()
                last_operation.update(item)
            self._step(execution_id, worker_id, item, int(job.get("attemptCount", 1)))
        replay_safe = is_plan_replay_safe(job.get("batchVersion"), self.registry)
        monitor = threading.Thread(target=self._heartbeat_loop, args=(job, worker_id, cancelled, started), daemon=True); monitor.start()
        log.info("Job started", extra={"executionId": execution_id, "workerId": worker_id, "attempt": job.get("attemptCount", 1), "replaySafe": replay_safe})
        try:
            if int(job.get("attemptCount", 1)) > 1 and not replay_safe:
                self.api.post(f"jobs/{execution_id}/fail", {"workerId": worker_id, "retryable": False, "error": {"code": "UNSAFE_RECOVERY", "message": "Il piano non dichiara handler idempotenti; il replay dopo crash è stato bloccato."}})
                log.error("Job %s recovery refused: plan is not replay-safe", execution_id)
                return
            with tempfile.TemporaryDirectory(prefix=f"pdforch-{execution_id[:8]}-", dir=self.temp_root) as temp:
                workdir = Path(temp).resolve(); downloaded: dict[str, str] = {}
                source_filenames: dict[str, str] = {}; source_file_refs: dict[str, str] = {}
                org_id = job["organizationId"]
                for file in claim.get("files", []):
                    target = (workdir / f"input-{file['id']}.pdf").resolve()
                    if workdir not in target.parents: raise ToolError("TEMP_SCOPE", "Percorso temporaneo fuori directory job.")
                    self.storage.download(file, org_id, target, self.max_bytes); downloaded[file["id"]] = str(target)
                    source_filenames[str(target.resolve())] = Path(file.get("filename") or "document.pdf").name
                    source_file_refs[str(target.resolve())] = str(file["id"])
                    context = ToolContext(workdir, self.max_bytes, self.max_pages)
                    context.pdf(target)
                if cancelled.is_set(): raise ToolError("CANCELLED", "Esecuzione annullata o lease perso.")
                version = job["batchVersion"]; api_input = job["input"]
                context = ToolContext(workdir, self.max_bytes, self.max_pages, timeout_seconds=int(os.environ.get("WORKER_TOOL_TIMEOUT_SECONDS", "900")), cancelled=cancelled.is_set)
                context.source_filenames = source_filenames
                context.source_file_refs = source_file_refs
                def heartbeat(progress: int, step_id: str | None, pages: int) -> None:
                    response = self.api.post(f"jobs/{execution_id}/heartbeat", {"workerId": worker_id, "leaseSeconds": self.lease_seconds, "progress": progress, "currentStepId": step_id, "pagesProcessed": pages})
                    if response.get("cancelRequested"): cancelled.set()
                graph = version["graph"]
                manifest = version.get("toolManifest")
                if isinstance(manifest, dict) and manifest.get("formatVersion") in (1, 2):
                    if manifest.get("graph") != graph:
                        raise ToolError("INVALID_PLAN", "Il grafo non corrisponde al piano compilato.")
                    graph = {**graph, "compiledPlan": manifest}
                result = WorkflowExecutor(self.registry).execute(graph, api_input, downloaded, context, report, heartbeat)
                if cancelled.is_set(): raise ToolError("CANCELLED", "Esecuzione annullata.")
                uploaded = []
                try:
                    for item in result["files"]:
                        uploaded.append(self.storage.upload(Path(item["path"]), org_id, execution_id, int(job.get("attemptCount", 1)), item["nodeId"], item["filename"], item.get("contentType", "application/pdf")))
                except Exception:
                    for file in uploaded:
                        try: self.storage.delete_execution_object(file["objectKey"], org_id, execution_id)
                        except Exception: log.exception("Could not clean a partial output upload for %s", execution_id)
                    raise
                output_files = [{"filename": file["filename"], "mimeType": file["mimeType"], "sha256": file["sha256"], "sizeBytes": file["sizeBytes"], "nodeId": file["nodeId"]} for file in uploaded]
                manifest = {"count": len(output_files), "totalBytes": sum(file["sizeBytes"] for file in uploaded), "files": output_files}
                completion = self.api.post(f"jobs/{execution_id}/complete", {"workerId": worker_id, "output": {"files": output_files, "manifest": manifest}, "files": uploaded, "pagesProcessed": result["pagesProcessed"], "durationMs": int((time.monotonic() - started) * 1000)})
                if completion.get("status") == "CANCELLED":
                    for file in uploaded: self.storage.delete_execution_object(file["objectKey"], org_id, execution_id)
                    log.info("Discarded output objects for cancelled job %s", execution_id)
                    return
                log.info("Job completed", extra={"executionId": execution_id, "workerId": worker_id, "attempt": job.get("attemptCount", 1), "durationMs": int((time.monotonic() - started) * 1000), "pagesProcessed": result["pagesProcessed"], "outputCount": len(uploaded), "progress": 100})
        except ToolError as exc:
            retryable = exc.retryable and replay_safe and not cancelled.is_set()
            log.warning("Job failed", extra={"executionId": execution_id, "workerId": worker_id, "attempt": job.get("attemptCount", 1), "errorCode": exc.code, "retryable": retryable, "durationMs": int((time.monotonic() - started) * 1000)})
            if exc.code != "CANCELLED": self._record_unhandled_step_failure(execution_id, worker_id, int(job.get("attemptCount", 1)), last_operation, {"code": exc.code, "message": str(exc)[:1000]})
            try: self.api.post(f"jobs/{execution_id}/fail", {"workerId": worker_id, "retryable": retryable, "error": {"code": exc.code, "message": str(exc)}})
            except Exception: log.exception("Could not report failure for %s", execution_id)
        except Exception as exc:
            log.exception("Unexpected job error", extra={"executionId": execution_id, "workerId": worker_id, "attempt": job.get("attemptCount", 1), "retryable": replay_safe, "durationMs": int((time.monotonic() - started) * 1000)})
            self._record_unhandled_step_failure(execution_id, worker_id, int(job.get("attemptCount", 1)), last_operation, {"code": "WORKER_ERROR", "message": str(exc)[:1000]})
            try: self.api.post(f"jobs/{execution_id}/fail", {"workerId": worker_id, "retryable": replay_safe, "error": {"code": "WORKER_ERROR", "message": str(exc)[:1000]}})
            except Exception: log.exception("Could not report failure for %s", execution_id)
        finally:
            cancelled.set()
            monitor.join(timeout=1)

    def loop(self, index: int) -> None:
        worker_id = f"{self.worker_id}-{index}"
        while not self.stopping.is_set():
            try:
                claim = self.api.claim(worker_id, self.lease_seconds)
                if claim is not None: self.process(claim, worker_id)
                else: self.stopping.wait(self.poll_seconds)
            except Exception:
                log.exception("Job claim failed"); self.stopping.wait(min(30, self.poll_seconds * 3))

    @staticmethod
    def _validate_webhook_url(url: str) -> None:
        parsed = urlsplit(url)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.port not in (None, 443):
            raise ValueError("Webhook URL must be HTTPS on port 443")
        if parsed.hostname == "localhost" or parsed.hostname.endswith(".localhost"):
            raise ValueError("Webhook host is not public")
        addresses = socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)
        if not addresses:
            raise ValueError("Webhook host did not resolve")
        for address in addresses:
            ip = ipaddress.ip_address(address[4][0])
            if not ip.is_global:
                raise ValueError("Webhook host resolves to a non-public address")

    def webhook_loop(self) -> None:
        while not self.stopping.is_set():
            try:
                claimed = self.api.post("webhooks/claim", {"workerId": self.worker_id})
                item = claimed.get("delivery")
                if not item:
                    self.stopping.wait(max(2, self.poll_seconds)); continue
                success, error = False, None
                try:
                    self._validate_webhook_url(item["url"])
                    payload = __import__("json").dumps(item["payload"], separators=(",", ":"), ensure_ascii=False).encode("utf-8")
                    timestamp = str(int(time.time()))
                    signature = hmac.new(item["secret"].encode(), timestamp.encode() + b"." + payload, hashlib.sha256).hexdigest()
                    response = httpx.post(item["url"], content=payload, headers={"content-type": "application/json", "x-pfo-event": item["payload"]["type"], "x-pfo-event-id": item["eventId"], "x-pfo-timestamp": timestamp, "x-pfo-signature": f"sha256={signature}"}, timeout=15, follow_redirects=False)
                    response.raise_for_status(); success = True
                except Exception as exc:
                    error = str(exc)[:1000]; log.warning("Webhook delivery %s failed: %s", item.get("id", "unknown"), error)
                try:
                    self.api.post(f"webhooks/{item['id']}/result", {"workerId": item["workerId"], "success": success, **({"error": error} if error else {})})
                except Exception:
                    log.exception("Could not record webhook delivery result")
            except Exception:
                log.exception("Webhook claim failed"); self.stopping.wait(min(30, self.poll_seconds * 3))

    def retention_loop(self) -> None:
        while not self.stopping.is_set():
            try:
                claimed = self.api.post("storage/claim-expired", {"workerId": self.worker_id})
                for item in claimed.get("files", []):
                    try:
                        self.storage.cleanup_expired(item)
                        success = True
                    except Exception:
                        log.exception("Could not delete expired object %s", item.get("id", "unknown")); success = False
                    self.api.post(f"storage/{item['id']}/retention-result", {"workerId": self.worker_id, "success": success})
                if not claimed.get("files"): self.stopping.wait(60)
            except Exception:
                log.exception("Storage retention claim failed"); self.stopping.wait(min(60, self.poll_seconds * 5))

    def health_loop(self) -> None:
        while not self.stopping.is_set():
            try:
                self.api.post("heartbeat", {"workerId": self.worker_id, "version": self.version, "concurrency": self.concurrency})
            except Exception:
                log.exception("Worker health heartbeat failed")
            self.stopping.wait(self.heartbeat_seconds)

    def run(self) -> None:
        log.info("Starting PDFOrchestrator worker id=%s concurrency=%s", self.worker_id, self.concurrency)
        with concurrent.futures.ThreadPoolExecutor(max_workers=self.concurrency + 2, thread_name_prefix="pdf-job") as pool:
            futures = [pool.submit(self.loop, index + 1) for index in range(self.concurrency)]
            futures.append(pool.submit(self.webhook_loop))
            futures.append(pool.submit(self.retention_loop))
            futures.append(pool.submit(self.health_loop))
            try:
                for future in futures: future.result()
            except KeyboardInterrupt:
                log.info("Shutdown requested"); self.stopping.set()
                for future in futures: future.cancel()


def main() -> None:
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError: pass
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO").upper(), format="%(asctime)s %(levelname)s %(name)s %(message)s")
    JobConsumer().run()


if __name__ == "__main__": main()
