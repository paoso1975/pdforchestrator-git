"""Real local integration check: editor API -> Neon -> Cubbit -> worker -> API artifact.

This test deliberately uses a dedicated tenant and creates a published batch/key.
It does not mock Next.js, PostgreSQL, Cubbit, HMAC, or the worker.
"""
from __future__ import annotations

import concurrent.futures
import hashlib
import hmac
import json
import os
import secrets
import sys
import time
import urllib.parse
import uuid
from pathlib import Path

import httpx
from pypdf import PdfReader


ROOT = Path(__file__).resolve().parent
FIXTURE_DIR = ROOT / "fixtures"
EMPTY_SCHEMA = {"type": "object", "properties": {}, "required": [], "additionalProperties": False}
EXPECTED_HANDLERS = ("pdf.merge", "pdf.qr.readAll", "logic.if", "pdf.page.delete", "pdf.ocr", "pdf.page.normalize", "pdf.convert.pdfa", "pdf.output")


def canonical_query(raw: str) -> str:
    pairs = urllib.parse.parse_qsl(raw, keep_blank_values=True)
    pairs.sort(key=lambda pair: (pair[0], pair[1]))
    quote = lambda value: urllib.parse.quote(value, safe="~-._")
    return "&".join(f"{quote(key)}={quote(value)}" for key, value in pairs)


def signed_headers(key_id: str, secret: str, method: str, path_and_query: str, body: bytes = b"") -> dict[str, str]:
    parsed = urllib.parse.urlsplit(path_and_query)
    timestamp = str(int(time.time()))
    nonce = secrets.token_urlsafe(24)
    digest = hashlib.sha256(body).hexdigest()
    canonical = "\n".join((method.upper(), parsed.path, canonical_query(parsed.query), timestamp, nonce, digest))
    signature = hmac.new(secret.encode("utf-8"), canonical.encode("utf-8"), hashlib.sha256).hexdigest()
    return {
        "X-PFO-Key": key_id,
        "X-PFO-Timestamp": timestamp,
        "X-PFO-Nonce": nonce,
        "X-PFO-Content-SHA256": digest,
        "X-PFO-Signature": signature,
    }


class E2E:
    def __init__(self, base_url: str, cookie: str, organization_id: str, timeout: int) -> None:
        self.base_url = base_url.rstrip("/")
        self.organization_id = organization_id
        self.timeout_seconds = timeout
        self.client = httpx.Client(timeout=45, headers={"cookie": cookie})
        self.key_id: str | None = None
        self.secret: str | None = None
        self.credential_id: str | None = None

    def admin(self, method: str, path: str, payload: object | None = None, **kwargs) -> httpx.Response:
        content = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode() if payload is not None else None
        headers = {"content-type": "application/json"} if content is not None else {}
        response = self.client.request(method, f"{self.base_url}{path}", content=content, headers=headers, **kwargs)
        return response

    def public(self, method: str, path: str, payload: object | None = None, *, idempotency_key: str | None = None,
               credential: tuple[str, str] | None = None, reuse_headers: dict[str, str] | None = None) -> httpx.Response:
        key_id, secret = credential or (self.key_id, self.secret)
        if not key_id or not secret:
            raise RuntimeError("API credential non inizializzata")
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode() if payload is not None else b""
        headers = dict(reuse_headers or signed_headers(key_id, secret, method, path, body))
        headers["content-type"] = "application/json"
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        return self.client.request(method, f"{self.base_url}{path}", content=body, headers=headers)

    def require(self, response: httpx.Response, expected: int | tuple[int, ...], label: str) -> dict:
        accepted = (expected,) if isinstance(expected, int) else expected
        if response.status_code not in accepted:
            raise AssertionError(f"{label}: atteso HTTP {accepted}, ricevuto {response.status_code}: {response.text[:1000]}")
        if not response.content:
            return {}
        try:
            return response.json()
        except ValueError as error:
            raise AssertionError(f"{label}: risposta non JSON") from error

    def create_and_publish_pipeline(self, graph: dict) -> tuple[str, str]:
        slug = f"e2e-pipeline-{uuid.uuid4().hex[:12]}"
        created = self.require(self.admin("POST", "/api/batches", {
            "organizationId": self.organization_id,
            "name": f"E2E pipeline {slug}",
            "slug": slug,
            "description": "Batch temporaneo creato dal collaudo integrato.",
        }), 201, "creazione batch")
        batch_id = created["id"]
        graph_payload = {key: graph[key] for key in ("nodes", "edges", "viewport")}
        draft_request = {
            "expectedRevision": None,
            "graph": graph_payload,
            "inputSchema": EMPTY_SCHEMA,
            "outputSchema": EMPTY_SCHEMA,
            "batchName": created["name"],
        }
        self.require(self.admin("PUT", f"/api/batches/{batch_id}/draft", draft_request), 201, "salvataggio draft editor")
        restored = self.require(self.admin("GET", f"/api/batches/{batch_id}/draft"), 200, "riapertura draft editor")
        if restored["graph"] != graph_payload or restored["revision"] != 1:
            raise AssertionError("Canvas ricaricato diverso dal grafo salvato o revision inattesa")

        current = self.require(self.admin("GET", f"/api/batches/{batch_id}"), 200, "lettura batch pre-pubblicazione")
        publish_payload = {"graph": graph_payload, "inputSchema": EMPTY_SCHEMA, "outputSchema": EMPTY_SCHEMA,
                           "toolManifest": {}, "publish": True, "batchName": created["name"]}
        self.require(self.admin("POST", f"/api/batches/{batch_id}/versions", publish_payload,
                                headers={"if-match": f'"{current["updatedAt"]}"'}), 201, "pubblicazione batch")
        return batch_id, slug

    def create_credential(self, batch_id: str) -> None:
        result = self.require(self.admin("POST", "/api/credentials", {
            "organizationId": self.organization_id,
            "name": f"E2E {uuid.uuid4().hex[:8]}",
            "batchIds": [batch_id],
        }), 201, "creazione credenziale batch")
        self.key_id = result["credential"]["keyId"]
        self.secret = result["secret"]
        self.credential_id = result["credential"]["id"]

    def assert_public_schema(self, slug: str) -> None:
        public_schema = self.require(self.public("GET", f"/api/public/v1/batches/{slug}/schema"), 200, "schema API pubblica")
        input_schema = public_schema["inputSchema"]
        if input_schema.get("properties", {}).get("documents", {}).get("items", {}).get("format") != "uri":
            raise AssertionError(f"Input documents[] non pubblicato come riferimenti PDF: {input_schema}")

    def upload(self, path: Path, *, filename: str | None = None) -> str:
        content = path.read_bytes()
        upload_name = filename or path.name
        init = self.require(self.public("POST", "/api/public/v1/uploads", {
            "filename": upload_name,
            "sizeBytes": len(content),
            "sha256": hashlib.sha256(content).hexdigest(),
        }), 201, f"inizializzazione upload {upload_name}")
        if init["state"] != "PENDING" or init["method"] != "PUT":
            raise AssertionError(f"Flusso upload singola parte non atteso: {init}")
        uploaded = httpx.put(init["uploadUrl"], content=content, headers=init["headers"], timeout=120)
        uploaded.raise_for_status()
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            state = self.require(self.public("GET", f"/api/public/v1/uploads/{init['fileId']}"), 200, "conferma upload sul server filesystem")
            if state["state"] == "UPLOADED":
                return init["fileId"]
            if state["state"] == "INVALID":
                raise AssertionError(f"Upload rifiutato: {path.name}")
            time.sleep(1)
        raise TimeoutError(f"Il server filesystem non ha confermato upload {path.name}")

    def run_and_wait(self, slug: str, file_ids: list[str], idempotency: str, *, expected_status: str = "COMPLETED") -> tuple[str, dict]:
        payload = {"input": {"documents": file_ids}}
        response = self.public("POST", f"/api/public/v1/batches/{slug}/runs", payload, idempotency_key=idempotency)
        initial = self.require(response, (200, 202), "accodamento run asincrono")
        run_id = initial["runId"]
        if initial["status"] not in {"QUEUED", "RUNNING", "COMPLETED", "FAILED"}:
            raise AssertionError(f"Stato iniziale inatteso: {initial['status']}")

        def submit_same_key() -> str:
            duplicate = self.require(self.public("POST", f"/api/public/v1/batches/{slug}/runs", payload, idempotency_key=idempotency), (200, 202), "idempotenza concorrente")
            return duplicate["runId"]

        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            duplicate_ids = list(pool.map(lambda _: submit_same_key(), range(4)))
        if any(item != run_id for item in duplicate_ids):
            raise AssertionError(f"Chiave idempotenza ha creato run differenti: {duplicate_ids}")

        deadline = time.monotonic() + self.timeout_seconds
        while time.monotonic() < deadline:
            status = self.require(self.public("GET", f"/api/public/v1/runs/{run_id}"), 200, "poll stato run")
            print(f"{status['status']} progress={status['progress']} step={status.get('currentStepId')} run={run_id}")
            if status["status"] in {"COMPLETED", "FAILED", "CANCELLED"}:
                break
            time.sleep(2)
        else:
            raise TimeoutError(f"Run {run_id} non terminata in {self.timeout_seconds}s")
        if status["status"] != expected_status:
            raise AssertionError(f"Run in stato {status['status']}; atteso {expected_status}: {status.get('error')}")
        return run_id, status

    def assert_pipeline_artifact(self, run_id: str) -> None:
        steps = self.require(self.public("GET", f"/api/public/v1/runs/{run_id}/steps"), 200, "stati step")
        completed = {step["nodeId"]: step for step in steps}
        expected_nodes = ("merge", "qr", "if-qr", "delete", "ocr", "normalize", "pdfa", "output")
        for node_id in expected_nodes:
            step = completed.get(node_id)
            if not step or step["status"] != "SUCCEEDED":
                raise AssertionError(f"Step {node_id} non completato correttamente: {step}")
        if completed["fallback"]["status"] != "SKIPPED":
            raise AssertionError(f"Ramo fallback atteso SKIPPED: {completed['fallback']}")

        outputs = self.require(self.public("GET", f"/api/public/v1/runs/{run_id}/outputs"), 200, "elenco artifact")
        if len(outputs) != 1 or outputs[0]["filename"] != "pipeline-result.pdf":
            raise AssertionError(f"Artifact prodotto inatteso: {outputs}")
        result = httpx.get(outputs[0]["downloadUrl"], timeout=120)
        result.raise_for_status()
        downloaded = FIXTURE_DIR / f"result-{run_id}.pdf"
        downloaded.write_bytes(result.content)
        try:
            reader = PdfReader(str(downloaded), strict=True)
            if len(reader.pages) != 1:
                raise AssertionError(f"Il PDF finale deve contenere la sola pagina scansionata, trovato {len(reader.pages)}")
            width = float(reader.pages[0].mediabox.width); height = float(reader.pages[0].mediabox.height)
            if abs(width - 595.276) > 3 or abs(height - 841.89) > 3:
                raise AssertionError(f"La pagina finale non è A4 portrait: {width:.1f} x {height:.1f} pt")
            if "1042" not in (reader.pages[0].extract_text() or ""):
                raise AssertionError("Il testo OCR non è selezionabile nel PDF scaricato")
        finally:
            downloaded.unlink(missing_ok=True)

    def check_security_cases(self, slug: str, run_id: str) -> None:
        bad_signature = signed_headers(self.key_id or "", self.secret or "", "GET", f"/api/public/v1/batches/{slug}/schema")
        bad_signature["X-PFO-Signature"] = "0" * 64
        self.require(self.public("GET", f"/api/public/v1/batches/{slug}/schema", reuse_headers=bad_signature), 401, "firma HMAC errata")

        replay_path = f"/api/public/v1/batches/{slug}/schema"
        replay_headers = signed_headers(self.key_id or "", self.secret or "", "GET", replay_path)
        self.require(self.public("GET", replay_path, reuse_headers=replay_headers), 200, "richiesta firmata prima del replay")
        self.require(self.public("GET", replay_path, reuse_headers=replay_headers), 409, "rifiuto replay nonce")

        invalid = self.public("POST", f"/api/public/v1/batches/{slug}/runs", {"input": {}}, idempotency_key=f"invalid-{uuid.uuid4().hex}")
        self.require(invalid, 400, "schema input incompleto")

        foreign_slug = os.environ.get("PDFORCH_E2E_FOREIGN_BATCH_SLUG")
        if foreign_slug:
            self.require(self.public("GET", f"/api/public/v1/batches/{foreign_slug}/schema"), 404, "isolamento tenant batch")
        foreign_run = os.environ.get("PDFORCH_E2E_FOREIGN_RUN_ID")
        if foreign_run:
            self.require(self.public("GET", f"/api/public/v1/runs/{foreign_run}"), 404, "isolamento tenant esecuzione")

        revoked_key = os.environ.get("PDFORCH_E2E_REVOKED_KEY_ID")
        revoked_secret = os.environ.get("PDFORCH_E2E_REVOKED_SECRET")
        if revoked_key and revoked_secret:
            response = self.public("GET", f"/api/public/v1/batches/{slug}/schema", credential=(revoked_key, revoked_secret))
            self.require(response, 401, "credenziale revocata")

        bad_pdf = self.upload(FIXTURE_DIR / "pipeline-corrupt.pdf", filename="pipeline-scan-page.pdf")
        good_pdf = self.upload(FIXTURE_DIR / "pipeline-qr-page.pdf")
        _, failed = self.run_and_wait(slug, [bad_pdf, good_pdf], f"corrupt-{uuid.uuid4().hex}", expected_status="FAILED")
        if not failed.get("error"):
            raise AssertionError("Il PDF corrotto deve produrre un errore leggibile")
        if failed.get("output"):
            raise AssertionError("Il PDF corrotto non deve produrre artifact")

        self.require(self.public("GET", f"/api/public/v1/runs/{os.environ.get('PDFORCH_E2E_FOREIGN_RUN_ID', run_id)}"), 200, "run tenant corrente")

    def revoke_credential(self) -> None:
        if self.credential_id:
            revoked = self.require(self.admin("DELETE", f"/api/credentials/{self.credential_id}"), 200, "revoca chiave E2E")
            if revoked.get("revoked") is not True:
                raise AssertionError("La chiave E2E deve risultare revocata")

    def archive_batch(self, batch_id: str) -> None:
        current = self.require(self.admin("GET", f"/api/batches/{batch_id}"), 200, "lettura batch per archivio")
        self.require(self.admin("PATCH", f"/api/batches/{batch_id}", {"status": "ARCHIVED"},
                                headers={"if-match": f'"{current["updatedAt"]}"'}), 200, "archiviazione batch E2E")


def main() -> int:
    base = os.environ.get("PDFORCH_E2E_BASE_URL", "http://localhost:3000").rstrip("/")
    cookie = os.environ.get("PDFORCH_E2E_COOKIE")
    organization_id = os.environ.get("PDFORCH_E2E_ORGANIZATION_ID")
    timeout = int(os.environ.get("PDFORCH_E2E_TIMEOUT_SECONDS", "1800"))
    required_fixtures = ("pipeline-scan-page.pdf", "pipeline-qr-page.pdf", "pipeline-corrupt.pdf")
    if not cookie or not organization_id:
        print("Set PDFORCH_E2E_COOKIE and PDFORCH_E2E_ORGANIZATION_ID for a dedicated local test tenant.", file=sys.stderr)
        return 2
    missing = [name for name in required_fixtures if not (FIXTURE_DIR / name).is_file()]
    if missing:
        print("Generate test documents first: python tests/generate_fixtures.py (missing " + ", ".join(missing) + ")", file=sys.stderr)
        return 2

    graph = json.loads((FIXTURE_DIR / "integration_pipeline.graph.json").read_text(encoding="utf-8"))
    flow = E2E(base, cookie, organization_id, timeout)
    run_id: str | None = None
    try:
        batch_id, slug = flow.create_and_publish_pipeline(graph)
        flow.create_credential(batch_id)
        flow.assert_public_schema(slug)
        file_ids = [flow.upload(FIXTURE_DIR / name) for name in ("pipeline-scan-page.pdf", "pipeline-qr-page.pdf")]
        run_id, status = flow.run_and_wait(slug, file_ids, f"pipeline-{uuid.uuid4().hex}")
        flow.assert_pipeline_artifact(run_id)
        flow.check_security_cases(slug, run_id)
        flow.revoke_credential()
        assert flow.key_id and flow.secret
        revoked = flow.public("GET", f"/api/public/v1/batches/{slug}/schema")
        flow.require(revoked, 401, "rifiuto della credenziale appena revocata")
        flow.archive_batch(batch_id)
        print(f"INTEGRATION OK batch={batch_id} run={run_id} status={status['status']} artifact verificato; credential revocata")
        return 0
    except Exception as error:
        print(f"INTEGRATION FAILED: {error}", file=sys.stderr)
        return 1
    finally:
        if flow.credential_id:
            try:
                flow.revoke_credential()
            except Exception:
                pass
        flow.client.close()


if __name__ == "__main__":
    raise SystemExit(main())
