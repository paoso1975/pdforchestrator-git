from __future__ import annotations

import os
import csv
import io
import json
import math
import re
import sys
import signal
import hashlib
import subprocess
import shutil
import time
import xml.etree.ElementTree as ET
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from pypdf import PdfReader, PdfWriter, Transformation

class ToolError(Exception):
    def __init__(self, code: str, message: str, *, retryable: bool = False):
        super().__init__(message)
        self.code, self.retryable = code, retryable


def _terminate_process_group(process: subprocess.Popen[Any]) -> None:
    if process.poll() is not None:
        return
    try:
        if os.name == "nt":
            process.terminate()
        else:
            os.killpg(process.pid, signal.SIGTERM)
    except (ProcessLookupError, OSError):
        pass
    try:
        process.communicate(timeout=1)
    except subprocess.TimeoutExpired:
        try:
            if os.name == "nt": process.kill()
            else: os.killpg(process.pid, signal.SIGKILL)
        except (ProcessLookupError, OSError):
            pass
        process.communicate()


def _run_isolated(context: "ToolContext", args: list[str], timeout: int) -> subprocess.CompletedProcess[str]:
    """Run a fixed native utility in its own process group and honor cancellation."""
    flags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) if os.name == "nt" else 0
    process = subprocess.Popen(
        args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        start_new_session=os.name != "nt", creationflags=flags,
    )
    deadline = time.monotonic() + timeout
    try:
        while True:
            try:
                context.check()
            except ToolError:
                _terminate_process_group(process)
                raise
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                _terminate_process_group(process)
                raise subprocess.TimeoutExpired(args, timeout)
            try:
                stdout, stderr = process.communicate(timeout=min(0.2, remaining))
                return subprocess.CompletedProcess(args, process.returncode, stdout, stderr)
            except subprocess.TimeoutExpired:
                continue
    except BaseException:
        _terminate_process_group(process)
        raise


@dataclass
class ToolContext:
    workdir: Path
    max_pdf_bytes: int = 100 * 1024 * 1024
    max_pages: int = 1000
    timeout_seconds: int = 120
    progress: Callable[[int, int], None] = lambda _done, _total: None
    cancelled: Callable[[], bool] = lambda: False
    source_filenames: dict[str, str] = field(default_factory=dict)
    source_file_refs: dict[str, str] = field(default_factory=dict)
    binding_resolver: Callable[[Any], Any] | None = None
    _started: float = field(default_factory=time.monotonic)

    def check(self) -> None:
        if self.cancelled():
            raise ToolError("CANCELLED", "Esecuzione annullata.")
        if time.monotonic() - self._started > self.timeout_seconds:
            raise ToolError("TOOL_TIMEOUT", "Tempo massimo dello strumento superato.", retryable=True)

    def pdf(self, path: str | Path) -> PdfReader:
        self.check()
        file = Path(path)
        if not file.is_file() or file.stat().st_size > self.max_pdf_bytes:
            raise ToolError("INVALID_PDF", "PDF assente o oltre il limite dimensioni.")
        with file.open("rb") as stream:
            if stream.read(5) != b"%PDF-":
                raise ToolError("INVALID_PDF", "Il file non ha un'intestazione PDF valida.")
        try:
            import pikepdf
            with pikepdf.open(str(file)) as checked:
                if not 1 <= len(checked.pages) <= self.max_pages:
                    raise ToolError("PAGE_LIMIT", "Numero di pagine non valido o oltre il limite.")
            reader = PdfReader(str(file), strict=True)
            if reader.is_encrypted:
                raise ToolError("ENCRYPTED_PDF", "I PDF protetti da password non sono supportati.")
            if not 1 <= len(reader.pages) <= self.max_pages:
                raise ToolError("PAGE_LIMIT", "Numero di pagine non valido o oltre il limite.")
            self.check()
            return reader
        except ToolError:
            raise
        except Exception as exc:
            raise ToolError("INVALID_PDF", f"PDF non leggibile: {exc}") from exc

    def output_path(self, suffix: str = ".pdf") -> Path:
        return self.workdir / f"out-{len(list(self.workdir.glob('out-*'))):04d}{suffix}"


@dataclass
class ToolResult:
    outputs: dict[str, Any]
    pages_processed: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)


ToolFunction = Callable[[ToolContext, dict[str, Any], dict[str, Any]], ToolResult]


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, tuple[str, ToolFunction, int, bool]] = {}

    def register(self, logical_id: str, version: str, function: ToolFunction, timeout_seconds: int = 120, *, idempotent: bool = False) -> None:
        key = f"{logical_id}@{version}"
        if key in self._tools:
            raise ValueError(f"Tool already registered: {key}")
        self._tools[key] = (logical_id, function, timeout_seconds, idempotent)

    def get(self, logical_id: str, version: str) -> ToolFunction:
        try:
            return self._tools[f"{logical_id}@{version}"][1]
        except KeyError as exc:
            raise ToolError("TOOL_NOT_FOUND", f"Strumento non installato: {logical_id}@{version}") from exc

    def timeout(self, logical_id: str, version: str) -> int:
        try: return self._tools[f"{logical_id}@{version}"][2]
        except KeyError as exc: raise ToolError("TOOL_NOT_FOUND", f"Strumento non installato: {logical_id}@{version}") from exc

    def idempotent(self, logical_id: str, version: str) -> bool:
        try: return self._tools[f"{logical_id}@{version}"][3]
        except KeyError: return False

    def definitions(self) -> list[dict[str, Any]]:
        # handlerId is the shared registry's stable dispatch identifier.
        return [{"id": logical_id, "handlerId": logical_id, "version": key.rsplit("@", 1)[1], "timeoutSeconds": timeout, "idempotent": idempotent} for key, (logical_id, _, timeout, idempotent) in sorted(self._tools.items())]


def _write(writer: PdfWriter, context: ToolContext) -> str:
    path = context.output_path()
    with path.open("wb") as stream:
        writer.write(stream)
    context.pdf(path)
    return str(path)


def _first_pdf(inputs: dict[str, Any]) -> str:
    def find(value: Any) -> str | None:
        if isinstance(value, str) and value.lower().endswith(".pdf") and Path(value).is_file():
            return value
        if isinstance(value, list):
            for item in value:
                found = find(item)
                if found: return found
        if isinstance(value, dict):
            for item in value.values():
                found = find(item)
                if found: return found
        return None
    found = find(inputs)
    if not found:
        raise ToolError("MISSING_INPUT", "Ingresso PDF richiesto non presente.")
    return found


def _all_pdfs(inputs: dict[str, Any]) -> list[str]:
    found: list[str] = []
    def walk(value: Any) -> None:
        if isinstance(value, str) and value.lower().endswith(".pdf") and Path(value).is_file(): found.append(value)
        elif isinstance(value, list):
            for item in value: walk(item)
        elif isinstance(value, dict):
            for item in value.values(): walk(item)
    for value in inputs.values(): walk(value)
    return found


def _pdf_documents(inputs: dict[str, Any], context: ToolContext, *, deduplicate: bool = True) -> list[dict[str, str]]:
    documents: list[dict[str, str]] = []
    def append(path_value: str, filename: str | None = None, file_ref: str | None = None) -> None:
        path = str(Path(path_value).resolve())
        actual_name = Path(filename or context.source_filenames.get(path, Path(path).name)).name
        actual_ref = file_ref or context.source_file_refs.get(path) or actual_name
        if not actual_name or not actual_ref:
            raise ToolError("INVALID_INPUT", "Il PDF in ingresso non ha un identificativo fileRef o un nome file valido.")
        documents.append({"path": path, "filename": actual_name, "fileRef": actual_ref})
    def walk(value: Any) -> None:
        if isinstance(value, str) and value.lower().endswith(".pdf") and Path(value).is_file():
            append(value)
        elif isinstance(value, list):
            for item in value: walk(item)
        elif isinstance(value, dict):
            if isinstance(value.get("path"), str) and isinstance(value.get("filename"), str):
                append(value["path"], value["filename"], value.get("fileRef") if isinstance(value.get("fileRef"), str) else None)
            else:
                for item in value.values(): walk(item)
    for value in inputs.values(): walk(value)
    if not deduplicate: return documents
    unique: dict[str, dict[str, str]] = {}
    for document in documents: unique[document["path"]] = document
    return list(unique.values())


def _merge(context: ToolContext, inputs: dict[str, Any], params: dict[str, Any]) -> ToolResult:
    paths = _all_pdfs(inputs)
    if not paths: raise ToolError("MISSING_INPUT", "Unisci PDF richiede almeno un file.")
    writer = PdfWriter()
    for i, path in enumerate(paths):
        context.check(); reader = context.pdf(path); writer.append(reader, outline_item=Path(path).stem if params.get("bookmark", True) else None); context.progress(i + 1, len(paths))
    return ToolResult({"pdf": _write(writer, context)}, sum(len(context.pdf(p).pages) for p in paths))


def _merge_planned(context: ToolContext, inputs: dict[str, Any], params: dict[str, Any]) -> ToolResult:
    documents = _pdf_documents(inputs, context)
    plan = params.get("mergePlan")
    entries = plan.get("files") if isinstance(plan, dict) else None
    if not documents or not isinstance(entries, list) or not entries:
        raise ToolError("INVALID_PARAMS", "Specificare mergePlan.files con filename e position.")
    names = [item.get("filename") for item in entries if isinstance(item, dict)]
    positions = [item.get("position") for item in entries if isinstance(item, dict)]
    available = [item["filename"] for item in documents]
    if len(names) != len(entries) or len(set(names)) != len(names) or sorted(names) != sorted(available):
        raise ToolError("INVALID_PARAMS", "Il piano deve indicare ogni file di ingresso una sola volta con il nome esatto.")
    if any(not isinstance(position, int) or isinstance(position, bool) for position in positions) or sorted(positions) != list(range(1, len(entries) + 1)):
        raise ToolError("INVALID_PARAMS", "Le posizioni di unione devono essere uniche e consecutive da 1.")
    by_name = {item["filename"]: item["path"] for item in documents}
    ordered = sorted(entries, key=lambda item: item["position"])
    writer = PdfWriter(); pages = 0
    for index, item in enumerate(ordered):
        context.check(); path = by_name[item["filename"]]; reader = context.pdf(path); pages += len(reader.pages)
        writer.append(reader, outline_item=Path(path).stem)
        context.progress(index + 1, len(ordered))
    return ToolResult({"pdf": _write(writer, context)}, pages)


def _merge_ordered(context: ToolContext, inputs: dict[str, Any], params: dict[str, Any]) -> ToolResult:
    documents = _pdf_documents(inputs, context, deduplicate=False)
    entries = params.get("files")
    if not documents or not isinstance(entries, list) or not 1 <= len(entries) <= 100:
        raise ToolError("INVALID_PARAMS", "pdf.merge@1.2 richiede da 1 a 100 fileRef nella configurazione files.")
    by_ref: dict[str, dict[str, str]] = {}
    for document in documents:
        file_ref = document.get("fileRef")
        if not file_ref or file_ref in by_ref:
            raise ToolError("AMBIGUOUS_INPUT", "Ogni PDF collegato deve avere un fileRef univoco.")
        by_ref[file_ref] = document
    refs = [item.get("fileRef") for item in entries if isinstance(item, dict)]
    if len(refs) != len(entries) or any(not isinstance(ref, str) or not ref for ref in refs) or len(set(refs)) != len(refs):
        raise ToolError("INVALID_PARAMS", "files deve contenere fileRef non vuoti e univoci.")
    if set(refs) != set(by_ref):
        missing = sorted(set(by_ref) - set(refs)); unknown = sorted(set(refs) - set(by_ref))
        details = []
        if missing: details.append("mancanti: " + ", ".join(missing))
        if unknown: details.append("sconosciuti: " + ", ".join(unknown))
        raise ToolError("INVALID_PARAMS", "Il piano deve indicare esattamente ogni PDF collegato (" + "; ".join(details) + ").")
    for item in entries:
        if not isinstance(item.get("filename"), str) or not item["filename"].strip() or item["filename"] != by_ref[item["fileRef"]]["filename"]:
            raise ToolError("INVALID_PARAMS", f"Il filename non corrisponde al fileRef '{item.get('fileRef', '')}'.")
        order = item.get("order")
        if not isinstance(order, int) or isinstance(order, bool) or order < 1:
            raise ToolError("INVALID_PARAMS", "order deve essere un intero positivo.")
    # Python's sort is stable: entries sharing the same order retain their JSON order.
    ordered = sorted(enumerate(entries), key=lambda pair: (pair[1]["order"], pair[0]))
    writer = PdfWriter(); page_map: list[dict[str, Any]] = []; total_pages = 0
    for file_position, (_entry_position, item) in enumerate(ordered, start=1):
        context.check(); document = by_ref[item["fileRef"]]; path = document["path"]
        try:
            reader = context.pdf(path)
        except ToolError as error:
            if error.code == "INVALID_PDF":
                try:
                    password_check = PdfReader(path, strict=True)
                    if password_check.is_encrypted:
                        raise ToolError("ENCRYPTED_PDF", f"Il PDF '{document['filename']}' è protetto da password.") from error
                except ToolError:
                    raise
                except Exception:
                    pass
            raise
        if reader.is_encrypted:
            raise ToolError("ENCRYPTED_PDF", f"Il PDF '{document['filename']}' è protetto da password.")
        page_count = len(reader.pages)
        if page_count < 1:
            raise ToolError("INVALID_PDF", f"Il PDF '{document['filename']}' non contiene pagine.")
        if total_pages + page_count > context.max_pages:
            raise ToolError("PAGE_LIMIT", f"La fusione supererebbe il limite di {context.max_pages} pagine.")
        writer.append(reader, outline_item=Path(document["filename"]).stem)
        for source_page in range(1, page_count + 1):
            total_pages += 1
            page_map.append({"destinationPage": total_pages, "fileRef": item["fileRef"], "filename": document["filename"], "sourcePage": source_page})
        context.progress(file_position, len(ordered))
    if not total_pages:
        raise ToolError("INVALID_PDF", "Nessuna pagina PDF valida da unire.")
    artifact_path = _write(writer, context)
    return ToolResult({"pdf": artifact_path, "totalPages": total_pages, "pageMap": page_map}, total_pages)


def _insert_pages(context: ToolContext, inputs: dict[str, Any], params: dict[str, Any]) -> ToolResult:
    """Insert selected one-based source pages before/after a target page."""
    target_path = _first_pdf({"pdf": inputs.get("pdf")})
    target_reader = context.pdf(target_path)
    source_pages = params.get("sourcePages")
    source_ref = params.get("sourceFile")
    target_page = params.get("targetPage")
    position = params.get("position")
    if not isinstance(source_ref, str) or not source_ref.strip():
        raise ToolError("INVALID_PARAMS", "sourceFile deve identificare un PDF collegato.")
    if not isinstance(source_pages, list) or not 1 <= len(source_pages) <= context.max_pages:
        raise ToolError("INVALID_PARAMS", f"sourcePages deve contenere da 1 a {context.max_pages} pagine.")
    if any(not isinstance(page, int) or isinstance(page, bool) or page < 1 for page in source_pages):
        raise ToolError("INVALID_PARAMS", "sourcePages deve contenere numeri interi 1-based positivi.")
    if len(set(source_pages)) != len(source_pages):
        raise ToolError("INVALID_PARAMS", "sourcePages non può contenere riferimenti duplicati.")
    if not isinstance(target_page, int) or isinstance(target_page, bool) or not 1 <= target_page <= len(target_reader.pages):
        raise ToolError("INVALID_PARAMS", "targetPage è fuori dai limiti del documento di destinazione.")
    if position not in {"before", "after"}:
        raise ToolError("INVALID_PARAMS", "position deve essere before oppure after.")

    # Resolve import sources only from the declared documentList input. This keeps
    # sourceFile as a tenant-scoped fileRef and prevents arbitrary path access.
    documents = _pdf_documents({"sources": inputs.get("sources")}, context, deduplicate=False)
    by_ref: dict[str, dict[str, str]] = {}
    for document in documents:
        ref = document["fileRef"]
        if ref in by_ref:
            raise ToolError("AMBIGUOUS_INPUT", f"Il fileRef '{ref}' identifica più PDF collegati.")
        by_ref[ref] = document
    source = by_ref.get(source_ref)
    if source is None:
        raise ToolError("INVALID_PARAMS", "sourceFile non corrisponde a un PDF collegato.")
    source_reader = context.pdf(source["path"])
    if any(page > len(source_reader.pages) for page in source_pages):
        raise ToolError("INVALID_PARAMS", f"sourcePages supera il numero di pagine di '{source['filename']}'.")
    total_pages = len(target_reader.pages) + len(source_pages)
    if total_pages > context.max_pages:
        raise ToolError("PAGE_LIMIT", f"L'inserimento supererebbe il limite di {context.max_pages} pagine.")

    target_path_resolved = str(Path(target_path).resolve())
    target_ref = context.source_file_refs.get(target_path_resolved, "target")
    target_name = context.source_filenames.get(target_path_resolved, Path(target_path).name)
    writer = PdfWriter()
    insertion_index = target_page - 1 + (1 if position == "after" else 0)
    page_map: list[dict[str, Any]] = []
    source_page_by_destination: dict[int, dict[str, Any]] = {}
    for offset, source_page in enumerate(source_pages):
        source_page_by_destination[insertion_index + offset + 1] = {
            "fileRef": source["fileRef"], "filename": source["filename"], "sourcePage": source_page, "inserted": True,
        }

    def insert_source_page(source_page_number: int, destination_index: int) -> None:
        source_page = source_reader.pages[source_page_number - 1]
        rotation = int(source_page.rotation or 0) % 360
        writer.insert_page(source_page, destination_index)
        # pypdf's cross-reader insert_page currently copies the page content and
        # boxes but may drop /Rotate. Reapply that PDF page attribute explicitly.
        if rotation:
            writer.pages[destination_index].rotation = rotation

    output_page = 0
    for target_index, page in enumerate(target_reader.pages):
        if target_index == insertion_index and position == "before":
            for offset, source_page_number in enumerate(source_pages):
                context.check()
                insert_source_page(source_page_number, insertion_index + offset)
                output_page += 1
                page_map.append({"destinationPage": output_page, **source_page_by_destination[output_page]})
                context.progress(output_page, total_pages)
        context.check()
        writer.add_page(page)
        output_page += 1
        page_map.append({"destinationPage": output_page, "fileRef": target_ref, "filename": target_name, "sourcePage": target_index + 1, "inserted": False})
        context.progress(output_page, total_pages)
    # before/after the last page always inserts inside the iteration above, since
    # after last is index == len(target.pages); handle that boundary explicitly.
    if position == "after" and target_page == len(target_reader.pages):
        for offset, source_page_number in enumerate(source_pages):
            context.check()
            insert_source_page(source_page_number, insertion_index + offset)
            output_page += 1
            page_map.append({"destinationPage": output_page, **source_page_by_destination[output_page]})
            context.progress(output_page, total_pages)
    artifact_path = _write(writer, context)
    return ToolResult({"pdf": artifact_path, "insertedCount": len(source_pages), "pageMap": page_map}, total_pages)


def _convert_pdfa(context: ToolContext, inputs: dict[str, Any], params: dict[str, Any]) -> ToolResult:
    """Convert with Ghostscript, then require an independent veraPDF pass."""
    source = _first_pdf(inputs)
    context.pdf(source)
    target = params.get("target")
    profiles = {"PDF/A-1b": "1b", "PDF/A-2b": "2b", "PDF/A-3b": "3b"}
    if target not in profiles:
        raise ToolError("INVALID_PARAMS", "target deve essere PDF/A-1b, PDF/A-2b oppure PDF/A-3b.")
    icc_value = os.environ.get("PDFA_ICC_PROFILE", "").strip()
    if not icc_value:
        raise ToolError("PDFA_CONFIG", "Configurare PDFA_ICC_PROFILE con un profilo ICC RGB valido.")
    icc_path = Path(icc_value).expanduser().resolve()
    try:
        icc_bytes = icc_path.read_bytes()
    except OSError as exc:
        raise ToolError("PDFA_CONFIG", "Il profilo ICC configurato non è leggibile.") from exc
    declared_size = int.from_bytes(icc_bytes[:4], "big") if len(icc_bytes) >= 4 else 0
    if len(icc_bytes) < 128 or declared_size < 128 or declared_size > len(icc_bytes) or icc_bytes[36:40] != b"acsp" or icc_bytes[16:20] != b"RGB ":
        raise ToolError("PDFA_CONFIG", "PDFA_ICC_PROFILE deve indicare un profilo ICC RGB valido.")
    gs = os.environ.get("GHOSTSCRIPT_BIN", "").strip() or shutil.which("gs") or shutil.which("gswin64c") or shutil.which("gswin32c")
    vera = os.environ.get("VERAPDF_BIN", "").strip() or shutil.which("verapdf")
    if not gs or not vera:
        raise ToolError("PDFA_DEPENDENCY", "La conversione richiede Ghostscript e veraPDF installati sul worker.")

    output = context.output_path()
    pdfmark = context.workdir / "pdfa-output-intent.ps"
    # The path comes only from trusted worker configuration; escape PostScript
    # string metacharacters and pass the program as a separate CLI argument.
    profile_ps = str(icc_path).replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    pdfmark.write_text(
        "[/_objdef {icc_PDFA} /type /stream /OBJ pdfmark\n"
        "[{icc_PDFA} << /N 3 >> /PUT pdfmark\n"
        f"[{{icc_PDFA}} ({profile_ps}) /PUTFILE pdfmark\n"
        "[/_objdef {OutputIntent_PDFA} /type /dict /OBJ pdfmark\n"
        "[{OutputIntent_PDFA} << /Type /OutputIntent /S /GTS_PDFA1 "
        "/OutputConditionIdentifier (sRGB) /DestOutputProfile {icc_PDFA} >> /PUT pdfmark\n"
        "[{Catalog} << /OutputIntents [ {OutputIntent_PDFA} ] >> /PUT pdfmark\n",
        encoding="ascii",
    )
    gs_args = [
        gs, "-dSAFER", f"--permit-file-read={icc_path}", "-dBATCH", "-dNOPAUSE", "-sDEVICE=pdfwrite",
        f"-dPDFA={target.split('-')[1][0]}", "-dPDFACompatibilityPolicy=2",
        "-sColorConversionStrategy=RGB", f"-sOutputICCProfile={icc_path}",
        f"-sOutputFile={output}", str(pdfmark), str(Path(source).resolve()),
    ]
    if target != "PDF/A-1b":
        gs_args.insert(-3, "-sBlendConversionStrategy=Managed")
    try:
        converted = _run_isolated(context, gs_args, context.timeout_seconds)
    except subprocess.TimeoutExpired as exc:
        raise ToolError("PDFA_TIMEOUT", "Ghostscript ha superato il timeout di conversione.", retryable=True) from exc
    except OSError as exc:
        raise ToolError("PDFA_CONVERSION", "Avvio di Ghostscript non riuscito.") from exc
    context.check()
    if converted.returncode != 0 or not output.is_file() or output.stat().st_size == 0:
        detail = (converted.stderr or converted.stdout or "").strip()[-1000:]
        raise ToolError("PDFA_CONVERSION", "Ghostscript non ha convertito il documento." + (f" Dettaglio: {detail}" if detail else ""))
    context.pdf(output)

    try:
        validation = _run_isolated(context, [vera, "-f", profiles[target], "--format", "xml", str(output)], context.timeout_seconds)
    except subprocess.TimeoutExpired as exc:
        raise ToolError("PDFA_VALIDATION_TIMEOUT", "veraPDF ha superato il timeout di validazione.", retryable=True) from exc
    except OSError as exc:
        raise ToolError("PDFA_VALIDATOR", "Avvio di veraPDF non riuscito.") from exc
    context.check()
    report_xml = validation.stdout.strip()
    if not report_xml or len(report_xml) > 2_000_000:
        raise ToolError("PDFA_VALIDATOR", "veraPDF non ha restituito un report XML valido.")
    try:
        root = ET.fromstring(report_xml)
        report_node = root.find(".//validationReport")
        details_node = report_node.find("details") if report_node is not None else None
        if report_node is None or report_node.get("isCompliant") not in {"true", "false"}:
            raise ValueError("validationReport assente")
        is_compliant = report_node.get("isCompliant") == "true"
        report = {
            "validator": "veraPDF",
            "profile": target,
            "profileName": report_node.get("profileName"),
            "isCompliant": is_compliant,
            "passedRules": int(details_node.get("passedRules", "0")) if details_node is not None else 0,
            "failedRules": int(details_node.get("failedRules", "0")) if details_node is not None else 0,
            "passedChecks": int(details_node.get("passedChecks", "0")) if details_node is not None else 0,
            "failedChecks": int(details_node.get("failedChecks", "0")) if details_node is not None else 0,
        }
    except (ET.ParseError, ValueError, TypeError) as exc:
        raise ToolError("PDFA_VALIDATOR", "Il report veraPDF non contiene un validationReport leggibile.") from exc
    if validation.returncode != 0 and report["isCompliant"]:
        raise ToolError("PDFA_VALIDATOR", "veraPDF è terminato con errore nonostante un report apparentemente conforme.")
    if not report["isCompliant"]:
        raise ToolError("PDFA_NON_COMPLIANT", f"Il documento non è conforme a {target} (regole fallite: {report['failedRules']}, controlli falliti: {report['failedChecks']}).")
    return ToolResult({"pdf": str(output), "validationReport": report}, len(context.pdf(output).pages))


def _convert_tiff(context: ToolContext, inputs: dict[str, Any], params: dict[str, Any]) -> ToolResult:
    """Render a PDF into page TIFFs and a multipage TIFF, checking source image PPI first."""
    from PIL import Image

    source = _first_pdf(inputs)
    reader = context.pdf(source)
    dpi = params.get("dpi", 300)
    compression = params.get("compression", "tiff_lzw")
    if not isinstance(dpi, int) or isinstance(dpi, bool) or not 72 <= dpi <= 1200:
        raise ToolError("INVALID_PARAMS", "dpi deve essere un numero intero tra 72 e 1200.")
    if compression not in {"tiff_lzw", "tiff_adobe_deflate", "raw"}:
        raise ToolError("INVALID_PARAMS", "compression deve essere tiff_lzw, tiff_adobe_deflate o raw.")

    pdfimages = os.environ.get("PDFIMAGES_BIN", "").strip() or shutil.which("pdfimages")
    if not pdfimages:
        pdftoppm_setting = os.environ.get("POPPLER_BIN", "").strip()
        if pdftoppm_setting:
            sibling = Path(pdftoppm_setting).expanduser().resolve().parent / ("pdfimages.exe" if os.name == "nt" else "pdfimages")
            if sibling.is_file():
                pdfimages = str(sibling)
    if not pdfimages:
        pdfimages = shutil.which("pdfimages.exe") if os.name == "nt" else None
    if not pdfimages:
        raise ToolError("POPPLER_MISSING", "Installare il comando pdfimages di Poppler per verificare la risoluzione raster originale.")
    try:
        listing = _run_isolated(context, [pdfimages, "-list", source], context.timeout_seconds)
    except FileNotFoundError as exc:
        raise ToolError("POPPLER_MISSING", "Il comando pdfimages di Poppler non è disponibile sul worker.") from exc
    except subprocess.TimeoutExpired as exc:
        raise ToolError("PDF_ANALYSIS_TIMEOUT", "Analisi delle immagini incorporate scaduta.", retryable=True) from exc
    if listing.returncode != 0:
        raise ToolError("PDF_ANALYSIS_FAILED", "Poppler non è riuscito a leggere le immagini incorporate nel PDF.")

    embedded_dpi: list[float] = []
    embedded_image_rows = 0
    for line in listing.stdout.splitlines():
        columns = line.split()
        if len(columns) < 3 or columns[2].lower() not in {"image", "mask", "smask", "stencil"}:
            continue
        embedded_image_rows += 1
        if len(columns) < 14:
            continue
        try:
            x_dpi, y_dpi = float(columns[12]), float(columns[13])
        except (ValueError, OverflowError):
            continue
        if math.isfinite(x_dpi) and math.isfinite(y_dpi) and x_dpi > 0 and y_dpi > 0:
            embedded_dpi.append(min(x_dpi, y_dpi))
    if embedded_image_rows and len(embedded_dpi) != embedded_image_rows:
        raise ToolError("PDF_RESOLUTION_UNKNOWN", "Poppler ha rilevato immagini incorporate ma non ne ha determinato la risoluzione effettiva.")
    minimum_embedded_dpi = min(embedded_dpi) if embedded_dpi else None
    # pdfimages prints integer-rounded PPI, so allow half a point for rounding.
    if minimum_embedded_dpi is not None and dpi > minimum_embedded_dpi + 0.5:
        raise ToolError("SOURCE_RESOLUTION_TOO_LOW", f"Il DPI richiesto ({dpi}) supera la risoluzione raster originale più bassa ({minimum_embedded_dpi:g} DPI).")

    # Bound worker memory and temporary storage before asking Poppler to render.
    max_pixels_per_page = 50_000_000
    max_total_pixels = 300_000_000
    total_pixels = 0
    for page_number, page in enumerate(reader.pages, 1):
        width_points, height_points = float(page.cropbox.width), float(page.cropbox.height)
        if int(page.get("/Rotate", 0) or 0) % 180:
            width_points, height_points = height_points, width_points
        pixels = math.ceil(width_points * dpi / 72) * math.ceil(height_points * dpi / 72)
        if pixels <= 0 or pixels > max_pixels_per_page or total_pixels + pixels > max_total_pixels:
            raise ToolError("TIFF_RESOURCE_LIMIT", f"La pagina {page_number} a {dpi} DPI supera il limite di pixel del worker.")
        total_pixels += pixels

    source_path = str(Path(source).resolve())
    original_name = context.source_filenames.get(source_path, Path(source).name)
    basename = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(original_name).stem).strip("._-") or "document"
    page_files: list[dict[str, Any]] = []
    tiff_paths: list[Path] = []
    for page_number in range(1, len(reader.pages) + 1):
        context.check()
        rendered = _render_page(context, source, page_number, f"tiff-render-{page_number:04d}", dpi=dpi)
        page_path = context.output_path(".tiff")
        try:
            with Image.open(rendered) as rendered_image:
                page_image = rendered_image.convert("RGB")
                try:
                    page_image.save(page_path, format="TIFF", compression=compression, dpi=(dpi, dpi))
                finally:
                    page_image.close()
        except Exception as exc:
            raise ToolError("TIFF_ENCODE_FAILED", f"Codifica TIFF non riuscita per la pagina {page_number}.") from exc
        tiff_paths.append(page_path)
        page_files.append({"path": str(page_path), "filename": f"{basename}-page-{page_number:04d}.tiff", "contentType": "image/tiff", "page": page_number})
        context.progress(page_number, len(reader.pages) * 2)

    multipage_path = context.output_path(".tiff")
    try:
        frames = [Image.open(path) for path in tiff_paths]
        try:
            frames[0].save(multipage_path, format="TIFF", save_all=True, append_images=frames[1:], compression=compression, dpi=(dpi, dpi))
        finally:
            for frame in frames:
                frame.close()
    except Exception as exc:
        raise ToolError("TIFF_ENCODE_FAILED", "Creazione del TIFF multipagina non riuscita.") from exc
    context.check()
    context.progress(len(reader.pages) * 2, len(reader.pages) * 2)
    source_resolution = {
        "kind": "raster" if minimum_embedded_dpi is not None else "vector_or_no_embedded_images",
        "embeddedImageCount": len(embedded_dpi),
        "minimumEmbeddedDpi": minimum_embedded_dpi,
        "requestedDpi": dpi,
    }
    return ToolResult({"pages": page_files, "multipage": str(multipage_path), "pageCount": len(reader.pages), "sourceResolution": source_resolution}, len(reader.pages))


def _convert_tiff_pages(context: ToolContext, inputs: dict[str, Any], params: dict[str, Any]) -> ToolResult:
    """Render PDF pages sequentially and return only the ordered single-page TIFF list."""
    from PIL import Image

    source = _first_pdf(inputs)
    reader = context.pdf(source)
    dpi = params.get("dpi", 300)
    compression = params.get("compression", "tiff_lzw")
    if not isinstance(dpi, int) or isinstance(dpi, bool) or not 72 <= dpi <= 1200:
        raise ToolError("INVALID_PARAMS", "dpi deve essere un numero intero tra 72 e 1200.")
    if compression not in {"tiff_lzw", "tiff_adobe_deflate", "raw"}:
        raise ToolError("INVALID_PARAMS", "compression deve essere tiff_lzw, tiff_adobe_deflate o raw.")

    pdfimages = os.environ.get("PDFIMAGES_BIN", "").strip() or shutil.which("pdfimages")
    if not pdfimages:
        pdftoppm_setting = os.environ.get("POPPLER_BIN", "").strip()
        if pdftoppm_setting:
            sibling = Path(pdftoppm_setting).expanduser().resolve().parent / ("pdfimages.exe" if os.name == "nt" else "pdfimages")
            if sibling.is_file():
                pdfimages = str(sibling)
    if not pdfimages:
        pdfimages = shutil.which("pdfimages.exe") if os.name == "nt" else None
    if not pdfimages:
        raise ToolError("POPPLER_MISSING", "Installare il comando pdfimages di Poppler per verificare la risoluzione raster originale.")
    try:
        listing = _run_isolated(context, [pdfimages, "-list", source], context.timeout_seconds)
    except FileNotFoundError as exc:
        raise ToolError("POPPLER_MISSING", "Il comando pdfimages di Poppler non è disponibile sul worker.") from exc
    except subprocess.TimeoutExpired as exc:
        raise ToolError("PDF_ANALYSIS_TIMEOUT", "Analisi delle immagini incorporate scaduta.", retryable=True) from exc
    if listing.returncode != 0:
        raise ToolError("PDF_ANALYSIS_FAILED", "Poppler non è riuscito a leggere le immagini incorporate nel PDF.")

    embedded_dpi: list[float] = []
    embedded_image_rows = 0
    for line in listing.stdout.splitlines():
        columns = line.split()
        if len(columns) < 3 or columns[2].lower() not in {"image", "mask", "smask", "stencil"}:
            continue
        embedded_image_rows += 1
        if len(columns) < 14:
            continue
        try:
            x_dpi, y_dpi = float(columns[12]), float(columns[13])
        except (ValueError, OverflowError):
            continue
        if math.isfinite(x_dpi) and math.isfinite(y_dpi) and x_dpi > 0 and y_dpi > 0:
            embedded_dpi.append(min(x_dpi, y_dpi))
    if embedded_image_rows and len(embedded_dpi) != embedded_image_rows:
        raise ToolError("PDF_RESOLUTION_UNKNOWN", "Poppler ha rilevato immagini incorporate ma non ne ha determinato la risoluzione effettiva.")
    minimum_embedded_dpi = min(embedded_dpi) if embedded_dpi else None
    if minimum_embedded_dpi is not None and dpi > minimum_embedded_dpi + 0.5:
        raise ToolError("SOURCE_RESOLUTION_TOO_LOW", f"Il DPI richiesto ({dpi}) supera la risoluzione raster originale più bassa ({minimum_embedded_dpi:g} DPI).")

    source_path = str(Path(source).resolve())
    original_name = context.source_filenames.get(source_path, Path(source).name)
    basename = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(original_name).stem).strip("._-") or "document"
    page_files: list[dict[str, Any]] = []
    for page_number, page in enumerate(reader.pages, 1):
        context.check()
        width_points, height_points = float(page.cropbox.width), float(page.cropbox.height)
        if int(page.get("/Rotate", 0) or 0) % 180:
            width_points, height_points = height_points, width_points
        pixels = math.ceil(width_points * dpi / 72) * math.ceil(height_points * dpi / 72)
        if pixels <= 0 or pixels > 50_000_000:
            raise ToolError("TIFF_PAGE_RESOURCE_LIMIT", f"La pagina {page_number} a {dpi} DPI supera il limite di 50 milioni di pixel per singola pagina.")
        rendered = _render_page(context, source, page_number, f"tiff-page-{page_number:04d}", dpi=dpi)
        page_path = context.output_path(".tiff")
        try:
            with Image.open(rendered) as rendered_image:
                page_image = rendered_image.convert("RGB")
                try:
                    page_image.save(page_path, format="TIFF", compression=compression, dpi=(dpi, dpi))
                finally:
                    page_image.close()
        except Exception as exc:
            raise ToolError("TIFF_ENCODE_FAILED", f"Codifica TIFF non riuscita per la pagina {page_number}.") from exc
        page_files.append({"path": str(page_path), "filename": f"{basename}-page-{page_number:04d}.tiff", "contentType": "image/tiff", "page": page_number})
        context.progress(page_number, len(reader.pages))

    source_resolution = {
        "kind": "raster" if minimum_embedded_dpi is not None else "vector_or_no_embedded_images",
        "embeddedImageCount": len(embedded_dpi),
        "minimumEmbeddedDpi": minimum_embedded_dpi,
        "requestedDpi": dpi,
    }
    return ToolResult({"pages": page_files, "pageCount": len(reader.pages), "sourceResolution": source_resolution}, len(reader.pages))


def _split(context: ToolContext, inputs: dict[str, Any], params: dict[str, Any]) -> ToolResult:
    reader = context.pdf(_first_pdf(inputs)); ranges = params.get("ranges") or []
    if not ranges: raise ToolError("INVALID_PARAMS", "Specificare intervalli di pagine.")
    outputs = []
    for item in ranges:
        match = re.fullmatch(r"\s*(\d+)\s*(?:-\s*(\d+)\s*)?", str(item))
        if not match: raise ToolError("INVALID_PARAMS", f"Intervallo non valido: {item}")
        start, end = int(match.group(1)), int(match.group(2) or match.group(1))
        if start < 1 or end < start or end > len(reader.pages): raise ToolError("INVALID_PARAMS", f"Intervallo fuori documento: {item}")
        writer = PdfWriter()
        for page in reader.pages[start - 1:end]: writer.add_page(page)
        outputs.append(_write(writer, context)); context.progress(len(outputs), len(ranges))
    return ToolResult({"pdfs": outputs}, len(reader.pages))


def _split_v11(context: ToolContext, inputs: dict[str, Any], params: dict[str, Any]) -> ToolResult:
    """Split by inclusive, one-based ranges with safe, deterministic artifact names."""
    source = _first_pdf(inputs)
    reader = context.pdf(source)
    ranges = params.get("ranges")
    mode = params.get("mode")
    template = params.get("filenameTemplate", "{basename}-{index}.pdf")
    if mode not in {"document", "documents"} or not isinstance(ranges, list) or not 1 <= len(ranges) <= 100:
        raise ToolError("INVALID_PARAMS", "Specificare una modalità valida e da 1 a 100 intervalli.")
    if mode == "document" and len(ranges) != 1:
        raise ToolError("INVALID_PARAMS", "La modalità documento richiede esattamente un intervallo.")
    allowed = {"basename", "index", "daPagina", "aPagina"}
    if not isinstance(template, str) or len(template) > 200 or "/" in template or "\\" in template or ".." in template or not template.lower().endswith(".pdf"):
        raise ToolError("INVALID_PARAMS", "filenameTemplate deve essere un nome file PDF senza percorsi.")
    if re.sub(r"\{(?:basename|index|daPagina|aPagina)\}", "", template).find("{") >= 0 or re.search(r"\{[^{}]+\}", re.sub(r"\{(?:basename|index|daPagina|aPagina)\}", "", template)):
        raise ToolError("INVALID_PARAMS", "Placeholder filenameTemplate non riconosciuto.")
    if any(name not in allowed for name in re.findall(r"\{([^{}]+)\}", template)):
        raise ToolError("INVALID_PARAMS", "Placeholder ammessi: {basename}, {index}, {daPagina}, {aPagina}.")
    parsed: list[tuple[int, int]] = []
    total_output_pages = 0
    for item in ranges:
        if not isinstance(item, dict) or set(item) != {"daPagina", "aPagina"}:
            raise ToolError("INVALID_PARAMS", "Ogni intervallo richiede daPagina e aPagina.")
        start, end = item["daPagina"], item["aPagina"]
        if any(not isinstance(number, int) or isinstance(number, bool) for number in (start, end)) or start < 1 or end < start or end > len(reader.pages):
            raise ToolError("INVALID_PARAMS", f"Intervallo non valido: pagine {start}–{end}; il documento contiene {len(reader.pages)} pagine.")
        total_output_pages += end - start + 1
        parsed.append((start, end))
    if total_output_pages > context.max_pages:
        raise ToolError("PAGE_LIMIT", f"Gli artifact supererebbero il limite complessivo di {context.max_pages} pagine.")

    basename = Path(context.source_filenames.get(str(Path(source).resolve()), Path(source).name)).stem
    basename = re.sub(r"[^A-Za-z0-9._-]+", "_", basename).strip("._-") or "document"
    outputs: list[dict[str, Any]] = []
    units_done = 0
    metadata = reader.metadata or {}
    safe_metadata = {str(key): str(value) for key, value in metadata.items() if value is not None and str(key).startswith("/")}
    for index, (start, end) in enumerate(parsed, start=1):
        context.check()
        writer = PdfWriter()
        try:
            if safe_metadata:
                writer.add_metadata(safe_metadata)
        except (TypeError, ValueError):
            # Metadata is best-effort: malformed source entries must not corrupt output pages.
            pass
        for page_number in range(start, end + 1):
            context.check()
            writer.add_page(reader.pages[page_number - 1])
            units_done += 1
            context.progress(units_done, total_output_pages)
        filename = template.replace("{basename}", basename).replace("{index}", str(index)).replace("{daPagina}", str(start)).replace("{aPagina}", str(end))
        filename = re.sub(r"[^A-Za-z0-9._-]+", "_", filename).strip("._-")
        if not filename or not filename.lower().endswith(".pdf"):
            raise ToolError("INVALID_PARAMS", "Il nome file generato non è valido.")
        outputs.append({"path": _write(writer, context), "filename": filename, "daPagina": start, "aPagina": end})
    if mode == "document":
        return ToolResult({"pdf": outputs[0]["path"], "totalPages": total_output_pages}, total_output_pages)
    return ToolResult({"documents": outputs, "totalPages": total_output_pages}, total_output_pages)


def _select_pages(context: ToolContext, inputs: dict[str, Any], params: dict[str, Any], mode: str) -> ToolResult:
    reader = context.pdf(_first_pdf(inputs)); numbers = params.get("pages") if mode != "reorder" else params.get("order")
    if mode == "reorder" and isinstance(params.get("orderPlan"), dict):
        entries = params["orderPlan"].get("pages")
        if not isinstance(entries, list) or len(entries) != len(reader.pages) or any(not isinstance(item, dict) for item in entries):
            raise ToolError("INVALID_PARAMS", "Il piano deve indicare ogni pagina corrente una sola volta.")
        current = [item.get("currentPage") for item in entries]
        positions = [item.get("outputPosition") for item in entries]
        expected = list(range(1, len(reader.pages) + 1))
        if any(not isinstance(number, int) or isinstance(number, bool) for number in current + positions) or sorted(current) != expected or sorted(positions) != expected:
            raise ToolError("INVALID_PARAMS", "Pagine correnti e posizioni output devono essere permutazioni complete da 1.")
        numbers = [item["currentPage"] for item in sorted(entries, key=lambda item: item["outputPosition"])]
    if not isinstance(numbers, list) or not numbers: raise ToolError("INVALID_PARAMS", "Elenco pagine obbligatorio.")
    indexes = [int(number) - 1 for number in numbers]
    if any(index < 0 or index >= len(reader.pages) for index in indexes): raise ToolError("INVALID_PARAMS", "Numero pagina fuori documento.")
    if mode == "delete": indexes = [i for i in range(len(reader.pages)) if i not in set(indexes)]
    if mode == "extract" and len(set(indexes)) != len(indexes): raise ToolError("INVALID_PARAMS", "Pagine duplicate non ammesse.")
    if not indexes: raise ToolError("INVALID_PARAMS", "Il risultato non può essere vuoto.")
    writer = PdfWriter()
    for i, index in enumerate(indexes): writer.add_page(reader.pages[index]); context.progress(i + 1, len(indexes))
    return ToolResult({"pdf": _write(writer, context)}, len(indexes))


def _page_delete(context: ToolContext, inputs: dict[str, Any], params: dict[str, Any]) -> ToolResult:
    source = _first_pdf(inputs)
    reader = context.pdf(source)
    selectors = [key for key in ("page", "pages", "pageId") if key in params]
    if len(selectors) != 1:
        raise ToolError("INVALID_PARAMS", "Specificare esattamente uno tra page, pages e pageId.")
    selector = selectors[0]
    if selector == "page":
        values = [params["page"]]
    elif selector == "pages":
        values = params["pages"]
        if not isinstance(values, list) or not 1 <= len(values) <= 1000:
            raise ToolError("INVALID_PARAMS", "pages deve contenere da 1 a 1000 numeri di pagina.")
    else:
        values = [params["pageId"]]

    if selector in {"page", "pages"}:
        if any(not isinstance(value, int) or isinstance(value, bool) for value in values):
            raise ToolError("INVALID_PARAMS", "I riferimenti di pagina devono essere interi 1-based.")
        requested = set(values)
    else:
        page_id = values[0]
        match = re.fullmatch(r"([a-f0-9]{16}):page:([1-9][0-9]*)", page_id) if isinstance(page_id, str) else None
        if not match:
            raise ToolError("INVALID_PARAMS", "pageId non ha il formato stabile hash:page:n.")
        digest = hashlib.sha256(Path(source).read_bytes()).hexdigest()[:16]
        if match.group(1) != digest:
            raise ToolError("PAGE_IDENTITY_LOST", "pageId appartiene a un PDF diverso o modificato.")
        requested = {int(match.group(2))}

    if any(page < 1 or page > len(reader.pages) for page in requested):
        raise ToolError("INVALID_PARAMS", f"Un riferimento di pagina è fuori documento (1–{len(reader.pages)}).")
    deleted = sorted(requested)
    if len(deleted) >= len(reader.pages):
        raise ToolError("EMPTY_DOCUMENT", "L'operazione non può eliminare tutte le pagine del PDF.")

    # Select against the immutable source page index, so multiple removals cannot shift later references.
    writer = PdfWriter()
    for index, page in enumerate(reader.pages, start=1):
        context.check()
        if index not in requested:
            writer.add_page(page)
        context.progress(index, len(reader.pages))
    metadata = {str(key): str(value) for key, value in (reader.metadata or {}).items() if value is not None}
    if metadata:
        writer.add_metadata(metadata)
    output = _write(writer, context)
    digest = hashlib.sha256(Path(source).read_bytes()).hexdigest()[:16]
    deleted_ids = [f"{digest}:page:{page}" for page in deleted]
    return ToolResult({"pdf": output, "deletedPages": deleted, "deletedPageIds": deleted_ids}, len(reader.pages))


def _rotate(context: ToolContext, inputs: dict[str, Any], params: dict[str, Any]) -> ToolResult:
    reader = context.pdf(_first_pdf(inputs)); writer = PdfWriter(); writer.clone_document_from_reader(reader)
    degrees = int(params.get("degrees", 0))
    if degrees % 90: raise ToolError("INVALID_PARAMS", "La rotazione deve essere un multiplo di 90 gradi.")
    indexes = {int(p) - 1 for p in params.get("pages", [])} or set(range(len(reader.pages)))
    if any(i < 0 or i >= len(reader.pages) for i in indexes): raise ToolError("INVALID_PARAMS", "Numero pagina fuori documento.")
    for index in indexes: writer.pages[index].rotate(degrees)
    context.progress(len(reader.pages), len(reader.pages))
    return ToolResult({"pdf": _write(writer, context)}, len(reader.pages))


PAGE_SIZES = {"A4": (595.276, 841.89), "A3": (841.89, 1190.551), "A5": (419.528, 595.276), "LETTER": (612, 792), "LEGAL": (612, 1008)}
ISO_PAGE_SIZES = {"A3": (841.8898, 1190.5512), "A4": (595.2756, 841.8898), "A5": (419.5276, 595.2756), "A6": (297.6378, 419.5276)}


def _detect_size(context: ToolContext, inputs: dict[str, Any], _params: dict[str, Any]) -> ToolResult:
    reader = context.pdf(_first_pdf(inputs)); pages = []
    for i, page in enumerate(reader.pages):
        box = page.mediabox; width, height = float(box.width), float(box.height)
        pages.append({"page": i + 1, "widthPt": round(width, 2), "heightPt": round(height, 2), "orientation": "landscape" if width > height else "portrait"})
        context.progress(i + 1, len(reader.pages))
    return ToolResult({"pages": pages}, len(pages))


def _normalize(context: ToolContext, inputs: dict[str, Any], params: dict[str, Any]) -> ToolResult:
    reader = context.pdf(_first_pdf(inputs)); key = str(params.get("pageSize", "A4")).upper()
    if key not in PAGE_SIZES: raise ToolError("INVALID_PARAMS", "Formato pagina non supportato.")
    target_w, target_h = PAGE_SIZES[key]
    if params.get("orientation") == "landscape": target_w, target_h = target_h, target_w
    writer = PdfWriter()
    for i, src in enumerate(reader.pages):
        box = src.mediabox; old_w, old_h = float(box.width), float(box.height)
        scale = min(target_w / old_w, target_h / old_h) if params.get("fit", "contain") == "contain" else max(target_w / old_w, target_h / old_h)
        page = writer.add_blank_page(width=target_w, height=target_h)
        x, y = (target_w - old_w * scale) / 2, (target_h - old_h * scale) / 2
        src.add_transformation(Transformation().scale(scale).translate(x, y)); page.merge_page(src)
        context.progress(i + 1, len(reader.pages))
    return ToolResult({"pdf": _write(writer, context)}, len(reader.pages))


def _normalize_iso(context: ToolContext, inputs: dict[str, Any], params: dict[str, Any]) -> ToolResult:
    """Normalize selected page boxes to ISO sizes while leaving oversized pages untouched."""
    reader = context.pdf(_first_pdf(inputs))
    size_name = str(params.get("size", "A4")).upper()
    orientation = params.get("orientation", "auto")
    tolerance = params.get("tolerancePercent", 2)
    mode = params.get("mode", "EXPAND_CANVAS")
    anchor = params.get("anchor", "CENTER")
    scope = params.get("pageScope", "ALL")
    if size_name not in ISO_PAGE_SIZES:
        raise ToolError("INVALID_PARAMS", "Il formato deve essere A3, A4, A5 o A6.")
    if orientation not in ("auto", "portrait", "landscape"):
        raise ToolError("INVALID_PARAMS", "Orientamento non valido.")
    if isinstance(tolerance, bool) or not isinstance(tolerance, (int, float)) or not math.isfinite(tolerance) or not 0 <= tolerance <= 10:
        raise ToolError("INVALID_PARAMS", "tolerancePercent deve essere compreso tra 0 e 10.")
    if mode not in ("EXPAND_CANVAS", "SCALE_CONTENT"):
        raise ToolError("INVALID_PARAMS", "Modalità di normalizzazione non valida.")
    anchors = {"TOP_LEFT", "TOP_CENTER", "TOP_RIGHT", "CENTER_LEFT", "CENTER", "CENTER_RIGHT", "BOTTOM_LEFT", "BOTTOM_CENTER", "BOTTOM_RIGHT"}
    if anchor not in anchors:
        raise ToolError("INVALID_PARAMS", "Ancoraggio non valido.")
    if scope not in ("ALL", "RANGE", "SELECTED"):
        raise ToolError("INVALID_PARAMS", "pageScope deve essere ALL, RANGE o SELECTED.")

    page_count = len(reader.pages)
    selected: set[int]
    if scope == "ALL":
        if "fromPage" in params or "toPage" in params or "pages" in params:
            raise ToolError("INVALID_PARAMS", "fromPage, toPage e pages non sono ammessi con pageScope ALL.")
        selected = set(range(1, page_count + 1))
    elif scope == "RANGE":
        start, end = params.get("fromPage"), params.get("toPage")
        if isinstance(start, bool) or isinstance(end, bool) or not isinstance(start, int) or not isinstance(end, int) or start < 1 or end < start:
            raise ToolError("INVALID_PARAMS", "RANGE richiede fromPage e toPage validi e inclusivi.")
        if "pages" in params or end > page_count:
            raise ToolError("INVALID_PARAMS", "L'intervallo richiesto supera il documento o include parametri incompatibili.")
        selected = set(range(start, end + 1))
    else:
        pages = params.get("pages")
        if "fromPage" in params or "toPage" in params or not isinstance(pages, list) or not pages or len(pages) > 1000:
            raise ToolError("INVALID_PARAMS", "SELECTED richiede l'elenco pages senza fromPage/toPage.")
        if any(isinstance(page, bool) or not isinstance(page, int) or page < 1 or page > page_count for page in pages):
            raise ToolError("INVALID_PARAMS", "Una pagina selezionata è fuori dal documento.")
        if len(set(pages)) != len(pages):
            raise ToolError("INVALID_PARAMS", "Le pagine selezionate non possono contenere duplicati.")
        selected = set(pages)

    writer = PdfWriter()
    writer.clone_document_from_reader(reader)
    modified: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    reasons: list[dict[str, Any]] = []
    base_w, base_h = ISO_PAGE_SIZES[size_name]
    tolerance_ratio = float(tolerance) / 100
    epsilon = 0.01

    def anchored_offset(remaining_x: float, remaining_y: float) -> tuple[float, float]:
        horizontal = anchor.rsplit("_", 1)[-1] if anchor != "CENTER" else "CENTER"
        vertical = anchor.split("_", 1)[0] if anchor != "CENTER" else "CENTER"
        x = 0.0 if horizontal == "LEFT" else remaining_x if horizontal == "RIGHT" else remaining_x / 2
        y = 0.0 if vertical == "BOTTOM" else remaining_y if vertical == "TOP" else remaining_y / 2
        return x, y

    for index, page in enumerate(writer.pages):
        context.check()
        page_number = index + 1
        source_box = page.mediabox
        old_w, old_h = float(source_box.width), float(source_box.height)
        if old_w <= 0 or old_h <= 0:
            raise ToolError("INVALID_PDF", f"Pagina {page_number}: dimensioni PDF non valide.")
        if page_number not in selected:
            entry = {"page": page_number, "reason": "outOfScope", "message": "Pagina esclusa da pageScope."}
            skipped.append(entry); reasons.append({**entry, "status": "skipped"})
            context.progress(index + 1, page_count)
            continue

        page_orientation = ("landscape" if old_w > old_h else "portrait") if orientation == "auto" else orientation
        target_w, target_h = (base_h, base_w) if page_orientation == "landscape" else (base_w, base_h)
        if old_w > target_w + epsilon or old_h > target_h + epsilon:
            entry = {"page": page_number, "reason": "aboveTarget", "message": "La pagina supera il formato obiettivo in larghezza o altezza; non è stata ridotta.", "widthPt": round(old_w, 3), "heightPt": round(old_h, 3), "targetWidthPt": round(target_w, 3), "targetHeightPt": round(target_h, 3)}
            skipped.append(entry); reasons.append({**entry, "status": "skipped"})
            context.progress(index + 1, page_count)
            continue
        min_w, min_h = target_w * (1 - tolerance_ratio), target_h * (1 - tolerance_ratio)
        if old_w >= min_w - epsilon and old_h >= min_h - epsilon:
            entry = {"page": page_number, "reason": "withinTolerance", "message": "La pagina è già entro la tolleranza del formato obiettivo.", "widthPt": round(old_w, 3), "heightPt": round(old_h, 3), "targetWidthPt": round(target_w, 3), "targetHeightPt": round(target_h, 3)}
            skipped.append(entry); reasons.append({**entry, "status": "skipped"})
            context.progress(index + 1, page_count)
            continue

        left, bottom = float(source_box.left), float(source_box.bottom)
        if mode == "EXPAND_CANVAS":
            scale = 1.0
            content_w, content_h = old_w, old_h
            reason = "canvasExpanded"
        else:
            scale = min(target_w / old_w, target_h / old_h)
            content_w, content_h = old_w * scale, old_h * scale
            reason = "contentScaled"
        offset_x, offset_y = anchored_offset(target_w - content_w, target_h - content_h)
        # Translate the source box origin to (0, 0), scale uniformly when requested,
        # then place it in the target canvas according to the selected anchor.
        page.add_transformation(Transformation().translate(-left, -bottom).scale(scale).translate(offset_x, offset_y))
        for box_name in ("mediabox", "cropbox", "trimbox", "bleedbox", "artbox"):
            box = getattr(page, box_name)
            box.lower_left = (0, 0)
            box.upper_right = (target_w, target_h)
        entry = {"page": page_number, "reason": reason, "message": "Pagina adattata al formato ISO mantenendo i contenuti e le proporzioni.", "beforePt": {"width": round(old_w, 3), "height": round(old_h, 3)}, "afterPt": {"width": round(target_w, 3), "height": round(target_h, 3)}, "size": size_name, "orientation": page_orientation, "mode": mode, "anchor": anchor}
        modified.append(entry); reasons.append({**entry, "status": "modified"})
        context.progress(index + 1, page_count)

    output = _write(writer, context)
    changed_count = len(modified)
    reason = {
        "code": "PAGES_MODIFIED" if changed_count else "NO_CHANGES",
        "summary": f"{changed_count} pagine modificate; {len(skipped)} pagine saltate.",
        "pages": reasons,
    }
    return ToolResult({"pdf": output, "modifiedPages": modified, "skippedPages": skipped, "reason": reason}, page_count)


def _read_metadata(context: ToolContext, inputs: dict[str, Any], _params: dict[str, Any]) -> ToolResult:
    reader = context.pdf(_first_pdf(inputs)); metadata = {str(k).lstrip("/"): str(v) for k, v in (reader.metadata or {}).items() if v is not None}
    return ToolResult({"metadata": metadata}, len(reader.pages))


def _write_metadata(context: ToolContext, inputs: dict[str, Any], params: dict[str, Any]) -> ToolResult:
    reader = context.pdf(_first_pdf(inputs)); writer = PdfWriter(); writer.clone_document_from_reader(reader)
    writer.add_metadata({f"/{key.title()}": str(params[key]) for key in ("title", "author", "subject", "keywords") if params.get(key) is not None})
    return ToolResult({"pdf": _write(writer, context)}, len(reader.pages))


def _bookmarks(context: ToolContext, inputs: dict[str, Any], params: dict[str, Any]) -> ToolResult:
    reader = context.pdf(_first_pdf(inputs)); writer = PdfWriter(); writer.clone_document_from_reader(reader)
    entries = {}
    for item in params.get("bookmarks", []):
        page = int(item["page"])
        if page < 1 or page > len(reader.pages): raise ToolError("INVALID_PARAMS", "Pagina segnalibro non valida.")
        parent_key = item.get("parent")
        if parent_key and parent_key not in entries: raise ToolError("INVALID_PARAMS", "Il bookmark padre deve precedere il figlio.")
        entries[item.get("id", item["title"])] = writer.add_outline_item(str(item["title"]), page - 1, parent=entries.get(parent_key))
    return ToolResult({"pdf": _write(writer, context)}, len(reader.pages))


def _outline_matches(entries: list[Any], title: str, depth: int = 0) -> list[tuple[Any, int]]:
    matches: list[tuple[Any, int]] = []
    index = 0
    while index < len(entries):
        item = entries[index]
        if isinstance(item, list):
            index += 1
            continue
        if getattr(item, "title", None) == title:
            matches.append((item, depth))
        children = entries[index + 1] if index + 1 < len(entries) and isinstance(entries[index + 1], list) else []
        if children:
            matches.extend(_outline_matches(children, title, depth + 1))
            index += 2
        else:
            index += 1
    return matches


def _bookmark_add(context: ToolContext, inputs: dict[str, Any], params: dict[str, Any]) -> ToolResult:
    reader = context.pdf(_first_pdf(inputs))
    page = params.get("page")
    description = params.get("description")
    level = params.get("level", 0)
    parent_title = params.get("parent")
    if not isinstance(page, int) or isinstance(page, bool) or not 1 <= page <= len(reader.pages):
        raise ToolError("INVALID_PARAMS", f"page deve essere un intero tra 1 e {len(reader.pages)}.")
    if not isinstance(description, str) or not description.strip() or len(description.strip()) > 500:
        raise ToolError("INVALID_PARAMS", "description deve contenere da 1 a 500 caratteri.")
    if not isinstance(level, int) or isinstance(level, bool) or not 0 <= level <= 8:
        raise ToolError("INVALID_PARAMS", "level deve essere un intero tra 0 e 8.")
    if parent_title is not None and (not isinstance(parent_title, str) or not parent_title.strip() or len(parent_title.strip()) > 500):
        raise ToolError("INVALID_PARAMS", "parent deve indicare il titolo di un segnalibro esistente.")

    writer = PdfWriter()
    writer.clone_document_from_reader(reader)
    parent_ref = None
    if parent_title is None:
        if level != 0:
            raise ToolError("INVALID_PARAMS", "Un segnalibro senza parent deve avere level 0.")
    else:
        matches = _outline_matches(writer.outline, parent_title.strip())
        if not matches:
            raise ToolError("BOOKMARK_PARENT_NOT_FOUND", f"Segnalibro padre '{parent_title}' non trovato nell'outline.")
        if len(matches) > 1:
            raise ToolError("BOOKMARK_PARENT_AMBIGUOUS", f"Il titolo padre '{parent_title}' non è univoco nell'outline.")
        parent_item, parent_depth = matches[0]
        if level != parent_depth + 1:
            raise ToolError("INVALID_PARAMS", f"level deve essere {parent_depth + 1} per essere figlio di '{parent_title}'.")
        parent_ref = getattr(parent_item, "indirect_reference", None)
        if parent_ref is None:
            raise ToolError("BOOKMARK_PARENT_INVALID", f"Il segnalibro padre '{parent_title}' non ha un riferimento PDF valido.")
        # clone_document_from_reader exposes copied outline nodes as DictionaryObject;
        # pypdf's add_outline_item requires a TreeObject for insertion.
        from pypdf.generic import TreeObject
        parent_object = parent_ref.get_object()
        if not isinstance(parent_object, TreeObject):
            parent_object.__class__ = TreeObject

    context.check()
    writer.add_outline_item(description.strip(), page - 1, parent=parent_ref)
    output = _write(writer, context)
    context.progress(1, 1)
    return ToolResult({"pdf": output}, len(reader.pages))


def _render_page(context: ToolContext, pdf: str, page_number: int, prefix: str, dpi: int | None = None) -> Path:
    binary = os.environ.get("POPPLER_BIN") or "pdftoppm"
    output = context.workdir / prefix
    context.check()
    try:
        resolution_args = ["-r", str(dpi)] if dpi is not None else ["-scale-to", "1800"]
        rendered = _run_isolated(context, [binary, "-f", str(page_number), "-l", str(page_number), *resolution_args, "-png", pdf, str(output)], context.timeout_seconds)
        if rendered.returncode != 0:
            raise ToolError("RENDER_FAILED", "Poppler non ha potuto renderizzare la pagina.")
    except FileNotFoundError as exc: raise ToolError("POPPLER_MISSING", "Installare Poppler (pdftoppm) sul worker.") from exc
    except subprocess.TimeoutExpired as exc: raise ToolError("RENDER_TIMEOUT", "Rendering PDF scaduto.", retryable=True) from exc
    matches = list(context.workdir.glob(prefix + "-*.png"))
    if not matches: raise ToolError("RENDER_FAILED", "Poppler non ha prodotto l'immagine.")
    context.check()
    return matches[0]


def _decode_codes(context: ToolContext, inputs: dict[str, Any], params: dict[str, Any], barcode: bool) -> ToolResult:
    pdf = _first_pdf(inputs); reader = context.pdf(pdf); selected = set(params.get("pages") or range(1, len(reader.pages) + 1)); codes = []
    if not barcode:
        for number in sorted(selected):
            if number < 1 or number > len(reader.pages): raise ToolError("INVALID_PARAMS", "Numero pagina fuori documento.")
            codes.extend({"page": number, "format": item["format"], "text": item["value"]} for item in _scan_qr_page(context, pdf, number, 200, "none"))
            context.progress(number, len(selected))
        return ToolResult({"codes": codes}, len(selected))
    try: from PIL import Image
    except ImportError as exc: raise ToolError("OPTIONAL_DEPENDENCY", "Installare Pillow sul worker.") from exc
    for number in sorted(selected):
        if number < 1 or number > len(reader.pages): raise ToolError("INVALID_PARAMS", "Numero pagina fuori documento.")
        image_path = _render_page(context, pdf, number, f"page-{number}"); image = Image.open(image_path)
        try: import zxingcpp
        except ImportError as exc: raise ToolError("OPTIONAL_DEPENDENCY", "Installare zxing-cpp sul worker.") from exc
        for found in zxingcpp.read_barcodes(image): codes.append({"page": number, "format": str(found.format), "text": found.text})
        context.progress(number, len(selected))
    return ToolResult({"codes": codes}, len(selected))


def _scan_qr_page(context: ToolContext, pdf: str, page_number: int, dpi: int, preprocess: str) -> list[dict[str, Any]]:
    image_path = _render_page(context, pdf, page_number, f"qr-page-{page_number}-{dpi}", dpi=dpi)
    try:
        completed = _run_isolated(context, [sys.executable, "-m", "pdforchestrator.qr_decoder", str(image_path), preprocess], context.timeout_seconds)
        if completed.returncode != 0:
            raise ToolError("QR_SCAN_FAILED", f"Scanner QR fallito sulla pagina {page_number}: {(completed.stderr or '').strip()[-500:]}")
        if len(completed.stdout) > 1_000_000:
            raise ToolError("QR_SCAN_LIMIT", "Il risultato QR supera il limite consentito.")
        decoded = json.loads(completed.stdout).get("codes")
        if not isinstance(decoded, list):
            raise ToolError("QR_SCAN_FAILED", "Il processo scanner QR ha restituito un risultato non valido.")
    except ToolError:
        raise
    except Exception as exc:
        raise ToolError("QR_SCAN_FAILED", f"Scansione QR fallita sulla pagina {page_number}: {exc}") from exc
    return [{**item, "page": page_number} for item in decoded if isinstance(item, dict)]


def _qr_read_page(context: ToolContext, inputs: dict[str, Any], params: dict[str, Any]) -> ToolResult:
    pdf = _first_pdf(inputs)
    reader = context.pdf(pdf)
    page_number = params.get("page")
    dpi = params.get("dpi", 200)
    preprocess = params.get("preprocess", "none")
    if not isinstance(page_number, int) or isinstance(page_number, bool) or not 1 <= page_number <= len(reader.pages):
        raise ToolError("INVALID_PARAMS", f"La pagina deve essere un numero intero tra 1 e {len(reader.pages)}.")
    if not isinstance(dpi, int) or isinstance(dpi, bool) or not 72 <= dpi <= 600:
        raise ToolError("INVALID_PARAMS", "dpi deve essere compreso tra 72 e 600.")
    if not isinstance(preprocess, str) or preprocess not in {"none", "grayscale", "autocontrast"}:
        raise ToolError("INVALID_PARAMS", "preprocess deve essere none, grayscale o autocontrast.")
    codes = _scan_qr_page(context, pdf, page_number, dpi, preprocess)
    context.progress(1, 1)
    return ToolResult({"codes": codes, "found": bool(codes), "count": len(codes)}, 1)


def _qr_remove_matched_pages(context: ToolContext, inputs: dict[str, Any], params: dict[str, Any]) -> ToolResult:
    """Remove pages with a QR value in the API table and bookmark the next retained page."""
    pdf = _first_pdf(inputs)
    reader = context.pdf(pdf)
    records = params.get("records")
    dpi = params.get("dpi", 200)
    preprocess = params.get("preprocess", "none")
    if not isinstance(records, list) or not records or len(records) > 10000:
        raise ToolError("INVALID_PARAMS", "records deve essere un elenco JSON non vuoto di massimo 10000 elementi.")
    if not isinstance(dpi, int) or isinstance(dpi, bool) or not 72 <= dpi <= 600:
        raise ToolError("INVALID_PARAMS", "dpi deve essere compreso tra 72 e 600.")
    if preprocess not in {"none", "grayscale", "autocontrast"}:
        raise ToolError("INVALID_PARAMS", "preprocess deve essere none, grayscale o autocontrast.")

    by_text: dict[str, str] = {}
    for index, record in enumerate(records):
        if not isinstance(record, dict) or set(record) != {"testoQR", "nomeQR"}:
            raise ToolError("INVALID_PARAMS", f"records[{index}] deve contenere solo testoQR e nomeQR.")
        text, name = record.get("testoQR"), record.get("nomeQR")
        if not isinstance(text, str) or not text or len(text) > 4096 or not isinstance(name, str) or not name.strip() or len(name.strip()) > 500:
            raise ToolError("INVALID_PARAMS", f"records[{index}] contiene testoQR o nomeQR non valido.")
        if text in by_text:
            raise ToolError("DUPLICATE_QR_RECORD", f"Il testo QR '{text[:80]}' compare più volte nell'elenco.")
        by_text[text] = name.strip()

    matches: list[dict[str, Any]] = []
    removed: set[int] = set()
    for page_number in range(1, len(reader.pages) + 1):
        context.check()
        for code in _scan_qr_page(context, pdf, page_number, dpi, preprocess):
            text = code.get("value")
            if isinstance(text, str) and text in by_text:
                matches.append({"page": page_number, "value": text, "nomeQR": by_text[text], "format": code.get("format", "QR_CODE")})
                removed.add(page_number)
        context.progress(page_number, len(reader.pages))

    retained = [page for page in range(1, len(reader.pages) + 1) if page not in removed]
    if not retained:
        raise ToolError("EMPTY_OUTPUT", "Tutte le pagine verrebbero rimosse; il PDF finale deve contenere almeno una pagina.")

    output_positions = {source_page: position for position, source_page in enumerate(retained, start=1)}
    bookmark_entries: list[dict[str, Any]] = []
    skipped_bookmarks: list[dict[str, Any]] = []
    for match in matches:
        target = next((page for page in retained if page > match["page"]), None)
        if target is None:
            skipped_bookmarks.append({"sourcePage": match["page"], "nomeQR": match["nomeQR"], "reason": "noFollowingPage"})
        else:
            bookmark_entries.append({"description": match["nomeQR"], "page": output_positions[target], "sourcePage": match["page"]})

    writer = PdfWriter()
    writer.clone_document_from_reader(reader)
    for page_number in sorted(removed, reverse=True):
        context.check()
        writer.remove_page(page_number - 1)
    for bookmark in bookmark_entries:
        context.check()
        writer.add_outline_item(bookmark["description"], bookmark["page"] - 1)
    output = _write(writer, context)
    return ToolResult({
        "pdf": output,
        "matches": matches,
        "removedPages": sorted(removed),
        "bookmarks": bookmark_entries,
        "skippedBookmarks": skipped_bookmarks,
    }, len(reader.pages))


def _qr_read_all(context: ToolContext, inputs: dict[str, Any], params: dict[str, Any]) -> ToolResult:
    pdf = _first_pdf(inputs)
    reader = context.pdf(pdf)
    start_page = params.get("startPage", 1)
    end_page = params.get("endPage", len(reader.pages))
    dpi = params.get("dpi", 200)
    preprocess = params.get("preprocess", "none")
    concurrency = params.get("concurrency", 2)
    if not isinstance(start_page, int) or isinstance(start_page, bool) or start_page < 1:
        raise ToolError("INVALID_PARAMS", "startPage deve essere un intero 1-based positivo.")
    if not isinstance(end_page, int) or isinstance(end_page, bool) or end_page > len(reader.pages) or end_page < start_page:
        raise ToolError("INVALID_PARAMS", f"endPage deve essere compreso tra startPage e {len(reader.pages)}.")
    if not isinstance(dpi, int) or isinstance(dpi, bool) or not 72 <= dpi <= 600:
        raise ToolError("INVALID_PARAMS", "dpi deve essere compreso tra 72 e 600.")
    if not isinstance(preprocess, str) or preprocess not in {"none", "grayscale", "autocontrast"}:
        raise ToolError("INVALID_PARAMS", "preprocess deve essere none, grayscale o autocontrast.")
    if not isinstance(concurrency, int) or isinstance(concurrency, bool) or not 1 <= concurrency <= 8:
        raise ToolError("INVALID_PARAMS", "concurrency deve essere un intero tra 1 e 8.")

    pages = list(range(start_page, end_page + 1))
    codes: list[dict[str, Any]] = []
    scanned = 0
    executor = ThreadPoolExecutor(max_workers=min(concurrency, len(pages)), thread_name_prefix="qr-page")
    futures = {executor.submit(_scan_qr_page, context, pdf, page, dpi, preprocess): page for page in pages}
    try:
        pending = set(futures)
        while pending:
            context.check()
            completed, pending = wait(pending, timeout=0.2, return_when=FIRST_COMPLETED)
            for future in completed:
                context.check()
                codes.extend(future.result())
                scanned += 1
                context.progress(scanned, len(pages))
    except BaseException:
        for future in futures:
            future.cancel()
        executor.shutdown(wait=True, cancel_futures=True)
        raise
    else:
        executor.shutdown(wait=True)

    codes.sort(key=lambda item: (item["page"], item["bbox"]["y"], item["bbox"]["x"], item["value"]))
    context.check()
    return ToolResult({"codes": codes, "pagesScanned": scanned}, scanned)


def _remove_qr_pages(context: ToolContext, inputs: dict[str, Any], params: dict[str, Any]) -> ToolResult:
    pdf = _first_pdf(inputs); reader = context.pdf(pdf); qr = _decode_codes(context, inputs, {}, False).outputs["codes"]
    values = {item["page"] for item in qr if params.get("match", "any") == "any" or params.get("value") == item["text"]}
    keep = [i for i in range(len(reader.pages)) if i + 1 not in values]
    if not keep: raise ToolError("EMPTY_OUTPUT", "Tutte le pagine verrebbero rimosse.")
    writer = PdfWriter(); [writer.add_page(reader.pages[i]) for i in keep]
    return ToolResult({"pdf": _write(writer, context), "removedPages": sorted(values)}, len(reader.pages))


def _tesseract_image_to_data(context: ToolContext, image_path: Path, languages: list[str], timeout: int) -> dict[str, list[Any]]:
    command = os.environ.get("TESSERACT_CMD") or "tesseract"
    try:
        completed = _run_isolated(context, [command, str(image_path), "stdout", "-l", "+".join(languages), "tsv"], timeout)
    except FileNotFoundError as exc:
        raise ToolError("TESSERACT_MISSING", "Installare Tesseract sul worker OCR.") from exc
    except subprocess.TimeoutExpired as exc:
        raise ToolError("OCR_TIMEOUT", f"Tesseract ha superato {timeout} secondi.", retryable=True) from exc
    if completed.returncode != 0:
        detail = (completed.stderr or "").strip()[-500:]
        raise ToolError("OCR_FAILED", "Tesseract non ha potuto elaborare la pagina." + (f" {detail}" if detail else ""))
    reader = csv.DictReader(io.StringIO(completed.stdout), delimiter="\t")
    result: dict[str, list[Any]] = {key: [] for key in ("text", "left", "top", "width", "height", "conf")}
    try:
        for row in reader:
            result["text"].append(row.get("text", ""))
            for key in ("left", "top", "width", "height"):
                result[key].append(int(row.get(key) or 0))
            try: confidence = float(row.get("conf") or -1)
            except ValueError: confidence = -1.0
            result["conf"].append(confidence)
    except (TypeError, ValueError) as exc:
        raise ToolError("OCR_FAILED", "Tesseract ha restituito TSV non valido.") from exc
    return result


def _ocr(context: ToolContext, inputs: dict[str, Any], params: dict[str, Any]) -> ToolResult:
    pdf = _first_pdf(inputs); reader = context.pdf(pdf); writer = PdfWriter(); text_parts = []
    from reportlab.pdfgen.canvas import Canvas
    from pypdf import PdfReader as OverlayReader
    for i, page in enumerate(reader.pages):
        context.check(); image_path = _render_page(context, pdf, i + 1, f"ocr-{i + 1}")
        image = __import__("PIL.Image", fromlist=["Image"]).open(image_path)
        languages = [item.strip() for item in params.get("languages") or os.getenv("TESSERACT_LANGUAGES", "eng").split(",") if item.strip()]
        data = _tesseract_image_to_data(context, image_path, languages, context.timeout_seconds)
        page_text = " ".join(word for word in data["text"] if word.strip()); text_parts.append(page_text)
        if params.get("searchablePdf", True):
            overlay_path = context.workdir / f"overlay-{i + 1}.pdf"; page_w, page_h = float(page.mediabox.width), float(page.mediabox.height); canvas = Canvas(str(overlay_path), pagesize=(page_w, page_h)); obj = canvas.beginText(); obj.setTextRenderMode(3)
            xscale, yscale = page_w / image.width, page_h / image.height
            for j, word in enumerate(data["text"]):
                if not word.strip(): continue
                x = float(data["left"][j]) * xscale; y = page_h - (float(data["top"][j]) + float(data["height"][j])) * yscale
                obj.setTextOrigin(x, y); obj.setFont("Helvetica", max(4, min(36, float(data["height"][j]) * yscale))); obj.textOut(word)
            canvas.drawText(obj); canvas.save(); page.merge_page(OverlayReader(str(overlay_path)).pages[0])
        writer.add_page(page); context.progress(i + 1, len(reader.pages))
    outputs = {"text": "\n".join(text_parts)}
    if params.get("searchablePdf", True): outputs["pdf"] = _write(writer, context)
    return ToolResult(outputs, len(reader.pages))


def _ocr_v11(context: ToolContext, inputs: dict[str, Any], params: dict[str, Any]) -> ToolResult:
    """OCR a bounded 1-based page range, preserving existing page text/content."""
    pdf = _first_pdf(inputs)
    reader = context.pdf(pdf)
    start = params.get("from", 1)
    end = params.get("to", len(reader.pages))
    dpi = params.get("dpi", 300)
    languages = params.get("languages", [])
    skip_existing = params.get("skipExistingText", True)
    searchable_overlay = params.get("searchableOverlay", True)
    include_text = params.get("includeExtractedText", False)
    if not isinstance(start, int) or isinstance(start, bool) or not 1 <= start <= len(reader.pages):
        raise ToolError("INVALID_PARAMS", f"from deve essere compreso tra 1 e {len(reader.pages)}.")
    if not isinstance(end, int) or isinstance(end, bool) or not start <= end <= len(reader.pages):
        raise ToolError("INVALID_PARAMS", f"to deve essere compreso tra from e {len(reader.pages)}.")
    if not isinstance(dpi, int) or isinstance(dpi, bool) or not 72 <= dpi <= 600:
        raise ToolError("INVALID_PARAMS", "dpi deve essere un intero tra 72 e 600.")
    if not isinstance(languages, list) or len(languages) > 8 or any(not isinstance(lang, str) or not re.fullmatch(r"[A-Za-z0-9_]{2,16}", lang) for lang in languages):
        raise ToolError("INVALID_PARAMS", "languages deve contenere al massimo 8 codici lingua Tesseract validi.")
    if any(not isinstance(flag, bool) for flag in (skip_existing, searchable_overlay, include_text)):
        raise ToolError("INVALID_PARAMS", "skipExistingText, searchableOverlay e includeExtractedText devono essere boolean.")
    language_codes = languages or [item.strip() for item in os.getenv("TESSERACT_LANGUAGES", "eng").split(",") if item.strip()]
    if not language_codes or any(not re.fullmatch(r"[A-Za-z0-9_]{2,16}", item) for item in language_codes):
        raise ToolError("INVALID_PARAMS", "Configurare lingue Tesseract valide in languages o TESSERACT_LANGUAGES.")

    try:
        from PIL import Image
        from reportlab.pdfgen.canvas import Canvas
        from pypdf import PdfReader as OverlayReader
    except ImportError as exc:
        raise ToolError("OPTIONAL_DEPENDENCY", "Installare Pillow e reportlab sul worker OCR.") from exc

    selected_count = end - start + 1
    page_texts: list[str] = []
    writer = PdfWriter()
    writer.clone_document_from_reader(reader)
    configured_timeout = max(1, min(600, int(os.environ.get("OCR_PAGE_TIMEOUT_SECONDS", "120"))))
    for index in range(start - 1, end):
        context.check()
        page = writer.pages[index]
        existing_text = (page.extract_text() or "").strip()
        if skip_existing and existing_text:
            if include_text:
                page_texts.append(existing_text)
            context.progress(index - start + 2, selected_count)
            continue
        image_path = _render_page(context, pdf, index + 1, f"ocr-v11-{index + 1}", dpi=dpi)
        try:
            with Image.open(image_path) as source_image:
                image = source_image.convert("RGB")
            elapsed = time.monotonic() - context._started
            remaining = max(1, int(context.timeout_seconds - elapsed))
            page_timeout = min(configured_timeout, remaining)
            data = _tesseract_image_to_data(context, image_path, language_codes, page_timeout)
        except ToolError as exc:
            if exc.code == "OCR_TIMEOUT":
                raise ToolError("OCR_TIMEOUT", f"Tesseract ha superato {page_timeout} secondi sulla pagina {index + 1}.", retryable=True) from exc
            raise ToolError(exc.code, f"OCR fallito sulla pagina {index + 1}: {exc}", retryable=exc.retryable) from exc
        words = [word.strip() for word in data.get("text", []) if isinstance(word, str) and word.strip()]
        if include_text:
            page_texts.append(" ".join(words))
        if searchable_overlay and words:
            overlay_path = context.workdir / f"ocr-overlay-{index + 1}.pdf"
            page_width, page_height = float(page.mediabox.width), float(page.mediabox.height)
            canvas = Canvas(str(overlay_path), pagesize=(page_width, page_height))
            text_object = canvas.beginText()
            text_object.setTextRenderMode(3)
            x_scale, y_scale = page_width / image.width, page_height / image.height
            for word_index, word in enumerate(data["text"]):
                if not isinstance(word, str) or not word.strip():
                    continue
                x = float(data["left"][word_index]) * x_scale
                y = page_height - (float(data["top"][word_index]) + float(data["height"][word_index])) * y_scale
                text_object.setTextOrigin(x, y)
                text_object.setFont("Helvetica", max(4, min(36, float(data["height"][word_index]) * y_scale)))
                text_object.textOut(word)
            canvas.drawText(text_object)
            canvas.save()
            page.merge_page(OverlayReader(str(overlay_path), strict=True).pages[0])
        context.progress(index - start + 2, selected_count)
    output_path = _write(writer, context)
    outputs: dict[str, Any] = {"pdf": output_path}
    if include_text:
        outputs["extractedText"] = "\n".join(page_texts)
    return ToolResult(outputs, selected_count)


def _condition(_context: ToolContext, inputs: dict[str, Any], params: dict[str, Any]) -> ToolResult:
    condition = params.get("conditionType"); expected = params.get("value"); branch_value = next(iter(inputs.values()), None); actual: Any = branch_value
    if condition in ("pageCount", "pageSize", "textContains", "qrFound"):
        pdf = _first_pdf(inputs); reader = PdfReader(pdf)
        if condition == "pageCount": actual = len(reader.pages)
        elif condition == "pageSize":
            width, height = float(reader.pages[0].mediabox.width), float(reader.pages[0].mediabox.height)
            actual = f"{width:.0f}x{height:.0f}"
            for name, (target_w, target_h) in PAGE_SIZES.items():
                if (abs(width - target_w) <= 2 and abs(height - target_h) <= 2) or (abs(width - target_h) <= 2 and abs(height - target_w) <= 2): actual = name; break
        elif condition == "textContains": actual = "\n".join(page.extract_text() or "" for page in reader.pages)
        else: actual = bool(_decode_codes(_context, inputs, {}, False).outputs["codes"])
    elif condition == "parameterComparison":
        actual = params.get("apiParameters", {})
        for part in str(params.get("path", "")).split("."):
            actual = actual.get(part) if isinstance(actual, dict) else None
    operator = params.get("operator", "equals")
    if operator == "exists": expected = None
    try:
        matched = {"equals": lambda: actual == expected, "notEquals": lambda: actual != expected, "contains": lambda: expected in actual, "greaterThan": lambda: float(actual) > float(expected), "lessThan": lambda: float(actual) < float(expected), "exists": lambda: actual is not None}[operator]()
    except (KeyError, TypeError, ValueError): raise ToolError("INVALID_PARAMS", "Condizione non valida.")
    return ToolResult({"true" if matched else "false": {"active": True}, "value": branch_value, "matched": matched})


def _value_matches_type(value: Any, declared: str) -> bool:
    if value is None: return True
    return ((declared == "string" and isinstance(value, str))
            or (declared == "number" and isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value))
            or (declared == "boolean" and isinstance(value, bool))
            or (declared == "array" and isinstance(value, list))
            or (declared == "object" and isinstance(value, dict)))


def _logic_if(_context: ToolContext, _inputs: dict[str, Any], params: dict[str, Any]) -> ToolResult:
    operator = params.get("operator")
    left_type, right_type = params.get("leftType"), params.get("rightType")
    left, right = params.get("left"), params.get("right")
    case_sensitive = params.get("caseSensitive", False)
    null_behavior = params.get("nullBehavior", "equalOnly")
    allowed_types = ("string", "number", "boolean", "array", "object")
    if left_type not in allowed_types or right_type not in allowed_types:
        raise ToolError("INVALID_PARAMS", "leftType/rightType devono dichiarare tipi supportati.")
    if not isinstance(case_sensitive, bool) or null_behavior not in ("equalOnly", "treatAsEmpty", "reject"):
        raise ToolError("INVALID_PARAMS", "Impostazioni caseSensitive/nullBehavior non valide.")

    if not _value_matches_type(left, left_type):
        raise ToolError("TYPE_MISMATCH", f"left deve essere {left_type}; ricevuto {type(left).__name__}.")
    unary = operator in ("isNull", "isEmpty")
    if operator not in ("eq", "neq", "gt", "gte", "lt", "lte", "contains", "notContains", "startsWith", "endsWith", "in", "notIn", "isEmpty", "isNull"):
        raise ToolError("INVALID_PARAMS", "Operatore logic.if non supportato.")
    if not unary:
        if "right" not in params:
            raise ToolError("INVALID_PARAMS", f"{operator} richiede l'operando right.")
        if not _value_matches_type(right, right_type):
            raise ToolError("TYPE_MISMATCH", f"right deve essere {right_type}; ricevuto {type(right).__name__}.")
    if operator in ("eq", "neq") and left_type != right_type:
        raise ToolError("TYPE_MISMATCH", f"{operator} richiede tipi dichiarati uguali.")
    if operator in ("gt", "gte", "lt", "lte") and (left_type != "number" or right_type != "number"):
        raise ToolError("TYPE_MISMATCH", f"{operator} richiede due number.")
    if operator in ("startsWith", "endsWith") and (left_type != "string" or right_type != "string"):
        raise ToolError("TYPE_MISMATCH", f"{operator} richiede due string.")
    if operator in ("contains", "notContains") and not (left_type == right_type == "string" or left_type == "array"):
        raise ToolError("TYPE_MISMATCH", f"{operator} richiede string/string oppure array come left.")
    if operator in ("in", "notIn") and (left_type == "array" or right_type != "array"):
        raise ToolError("TYPE_MISMATCH", f"{operator} richiede valore scalare come left e array come right.")
    if operator == "isEmpty" and left_type not in ("string", "array", "object"):
        raise ToolError("TYPE_MISMATCH", "isEmpty richiede left di tipo string, array o object.")

    if operator == "isNull":
        matched = left is None
        return ToolResult({"true" if matched else "false": {"active": True}, "matched": matched})
    elif left is None or right is None:
        if null_behavior == "reject": raise ToolError("NULL_COMPARISON", "Il confronto contiene null e nullBehavior è reject.")
        if null_behavior == "treatAsEmpty":
            def empty(value: Any, declared: str) -> Any:
                if value is not None: return value
                if declared == "string": return ""
                if declared == "array": return []
                if declared == "object": return {}
                raise ToolError("NULL_COMPARISON", "nullBehavior=treatAsEmpty è valido per string, array e object.")
            left, right = empty(left, left_type), empty(right, right_type)
        elif operator in ("eq", "neq"):
            equal = left is right
            matched = equal if operator == "eq" else not equal
            return ToolResult({"true" if matched else "false": {"active": True}, "matched": matched})
        elif operator == "isEmpty": matched = False
        else: raise ToolError("NULL_COMPARISON", f"{operator} non accetta null con nullBehavior=equalOnly.")

    if operator == "isEmpty": matched = left == "" or left == [] or left == {}
    elif operator == "eq" or operator == "neq":
        a, b = left, right
        if not case_sensitive and isinstance(a, str) and isinstance(b, str): a, b = a.casefold(), b.casefold()
        equal = a == b; matched = equal if operator == "eq" else not equal
    elif operator in ("gt", "gte", "lt", "lte"):
        if left_type != "number" or right_type != "number": raise ToolError("TYPE_MISMATCH", f"{operator} richiede due number.")
        matched = {"gt": left > right, "gte": left >= right, "lt": left < right, "lte": left <= right}[operator]
    elif operator in ("startsWith", "endsWith"):
        if not isinstance(left, str) or not isinstance(right, str): raise ToolError("TYPE_MISMATCH", f"{operator} richiede due string.")
        a, b = (left, right) if case_sensitive else (left.casefold(), right.casefold())
        matched = a.startswith(b) if operator == "startsWith" else a.endswith(b)
    elif operator in ("contains", "notContains"):
        if isinstance(left, str) and isinstance(right, str):
            a, b = (left, right) if case_sensitive else (left.casefold(), right.casefold())
            contained = b in a
        elif isinstance(left, list):
            def equal_item(item: Any) -> bool:
                if not case_sensitive and isinstance(item, str) and isinstance(right, str): return item.casefold() == right.casefold()
                return item == right
            contained = any(equal_item(item) for item in left)
        else: raise ToolError("TYPE_MISMATCH", "contains richiede string/string oppure array come left.")
        matched = contained if operator == "contains" else not contained
    else:  # in / notIn
        if not isinstance(right, list): raise ToolError("TYPE_MISMATCH", f"{operator} richiede array come right.")
        if any(not _value_matches_type(item, left_type) for item in right): raise ToolError("TYPE_MISMATCH", f"Ogni elemento di right deve essere {left_type}.")
        def equal_item(item: Any) -> bool:
            if not case_sensitive and isinstance(item, str) and isinstance(left, str): return item.casefold() == left.casefold()
            return item == left
        included = any(equal_item(item) for item in right)
        matched = included if operator == "in" else not included
    return ToolResult({"true" if matched else "false": {"active": True}, "matched": matched})


def _condition_group(context: ToolContext, _inputs: dict[str, Any], params: dict[str, Any]) -> ToolResult:
    ast = params.get("condition")
    allowed_operators = ("eq", "neq", "gt", "gte", "lt", "lte", "contains", "notContains", "startsWith", "endsWith", "in", "notIn", "isEmpty", "isNull")
    allowed_types = ("string", "number", "boolean", "array", "object")
    pending = [(ast, 1, "condition")]; ast_nodes = 0; comparisons = 0
    while pending:
        current, depth, path = pending.pop(); ast_nodes += 1
        if depth > 8: raise ToolError("INVALID_CONDITION", f"{path}: profondità massima 8 superata.")
        if ast_nodes > 63: raise ToolError("INVALID_CONDITION", "Il gruppo supera il limite di 63 nodi.")
        if not isinstance(current, dict): raise ToolError("INVALID_CONDITION", f"{path}: nodo AST non valido.")
        kind = current.get("kind")
        if kind == "group":
            if set(current) != {"kind", "operator", "conditions"}: raise ToolError("INVALID_CONDITION", f"{path}: campi gruppo non validi.")
            children = current.get("conditions")
            if current.get("operator") not in ("AND", "OR") or not isinstance(children, list) or not 1 <= len(children) <= 16:
                raise ToolError("INVALID_CONDITION", f"{path}: gruppo AND/OR richiede da 1 a 16 condizioni.")
            pending.extend((child, depth + 1, f"{path}.conditions[{index}]") for index, child in enumerate(children))
            continue
        if kind == "not":
            if set(current) != {"kind", "condition"}: raise ToolError("INVALID_CONDITION", f"{path}: nodo NOT non valido.")
            pending.append((current.get("condition"), depth + 1, f"{path}.condition")); continue
        if kind != "comparison": raise ToolError("INVALID_CONDITION", f"{path}: tipo nodo non supportato.")
        comparisons += 1
        if comparisons > 32: raise ToolError("INVALID_CONDITION", "Il gruppo supera il limite di 32 confronti.")
        required = {"kind", "leftType", "rightType", "left", "operator"}; allowed = required | {"right", "caseSensitive", "nullBehavior"}
        if not required.issubset(current) or not set(current).issubset(allowed): raise ToolError("INVALID_CONDITION", f"{path}: confronto incompleto o con campi non riconosciuti.")
        op, left_type, right_type = current.get("operator"), current.get("leftType"), current.get("rightType")
        if op not in allowed_operators or left_type not in allowed_types or right_type not in allowed_types: raise ToolError("INVALID_CONDITION", f"{path}: operatore o tipi dichiarati non supportati.")
        unary = op in ("isNull", "isEmpty")
        if unary and "right" in current or not unary and "right" not in current: raise ToolError("INVALID_CONDITION", f"{path}: operando right assente o non previsto per {op}.")
        if "caseSensitive" in current and not isinstance(current["caseSensitive"], bool): raise ToolError("INVALID_CONDITION", f"{path}: caseSensitive deve essere boolean.")
        if current.get("nullBehavior", "equalOnly") not in ("equalOnly", "treatAsEmpty", "reject"): raise ToolError("INVALID_CONDITION", f"{path}: nullBehavior non supportato.")
        if op in ("eq", "neq") and left_type != right_type: raise ToolError("INVALID_CONDITION", f"{path}: eq/neq richiedono tipi dichiarati uguali.")
        if op in ("gt", "gte", "lt", "lte") and (left_type != "number" or right_type != "number"): raise ToolError("INVALID_CONDITION", f"{path}: {op} richiede due number.")
        if op in ("startsWith", "endsWith") and (left_type != "string" or right_type != "string"): raise ToolError("INVALID_CONDITION", f"{path}: {op} richiede due string.")
        if op in ("contains", "notContains") and not (left_type == right_type == "string" or left_type == "array"): raise ToolError("INVALID_CONDITION", f"{path}: {op} richiede string/string oppure array come left.")
        if op in ("in", "notIn") and (left_type == "array" or right_type != "array"): raise ToolError("INVALID_CONDITION", f"{path}: {op} richiede valore scalare e array come right.")
        if op == "isEmpty" and left_type not in ("string", "array", "object"): raise ToolError("INVALID_CONDITION", f"{path}: isEmpty richiede string, array o object.")
        for side in ("left", "right"):
            operand = current.get(side)
            declared = left_type if side == "left" else right_type
            literal = operand
            if isinstance(operand, dict) and "source" in operand:
                source = operand.get("source")
                path = operand.get("path", [])
                path_valid = isinstance(path, list) and len(path) <= 16 and all(isinstance(part, str) and part not in ("__proto__", "prototype", "constructor") for part in path)
                common = {"source"} | ({"path"} if "path" in operand else set())
                binding_shape = (path_valid and ((source == "constant" and set(operand) == {"source", "value"})
                                 or (source == "api" and set(operand) == common | {"name"} and isinstance(operand.get("name"), str) and bool(operand["name"]))
                                 or (source == "node" and set(operand) == common | {"nodeId", "port"} and isinstance(operand.get("nodeId"), str) and bool(operand["nodeId"]) and isinstance(operand.get("port"), str) and bool(operand["port"]))
                                 or (source in ("variable", "loop") and set(operand) == common | {"name"} and isinstance(operand.get("name"), str) and bool(operand["name"]))
                                 or (source == "expression" and set(operand) == {"source", "expression"})))
                if not binding_shape: raise ToolError("INVALID_BINDING", f"{path}.{side}: binding non valido.")
                literal = operand.get("value") if source == "constant" else None
            if side in current and literal is not None and not _value_matches_type(literal, declared):
                raise ToolError("TYPE_MISMATCH", f"{path}.{side}: il valore non corrisponde al tipo dichiarato {declared}.")
            if side == "right" and op in ("in", "notIn") and isinstance(literal, list) and any(not _value_matches_type(item, left_type) for item in literal):
                raise ToolError("TYPE_MISMATCH", f"{path}.right: gli elementi devono essere {left_type}.")
    state = {"nodes": 0, "comparisons": 0}
    def visit(node: Any, depth: int, path: str) -> bool:
        context.check()
        state["nodes"] += 1
        if depth > 8: raise ToolError("INVALID_CONDITION", f"{path}: profondità massima 8 superata.")
        if state["nodes"] > 63: raise ToolError("INVALID_CONDITION", "Il gruppo supera il limite di 63 nodi.")
        if not isinstance(node, dict): raise ToolError("INVALID_CONDITION", f"{path}: nodo AST non valido.")
        kind = node.get("kind")
        if kind == "group":
            if set(node) != {"kind", "operator", "conditions"}: raise ToolError("INVALID_CONDITION", f"{path}: campi gruppo non validi.")
            operator, children = node.get("operator"), node.get("conditions")
            if operator not in ("AND", "OR") or not isinstance(children, list) or not 1 <= len(children) <= 16:
                raise ToolError("INVALID_CONDITION", f"{path}: gruppo AND/OR richiede da 1 a 16 condizioni.")
            if operator == "AND":
                for index, child in enumerate(children):
                    if not visit(child, depth + 1, f"{path}.conditions[{index}]"): return False
                return True
            for index, child in enumerate(children):
                if visit(child, depth + 1, f"{path}.conditions[{index}]"): return True
            return False
        if kind == "not":
            if set(node) != {"kind", "condition"}: raise ToolError("INVALID_CONDITION", f"{path}: nodo NOT non valido.")
            return not visit(node.get("condition"), depth + 1, f"{path}.condition")
        if kind != "comparison": raise ToolError("INVALID_CONDITION", f"{path}: tipo nodo non supportato.")
        state["comparisons"] += 1
        if state["comparisons"] > 32: raise ToolError("INVALID_CONDITION", "Il gruppo supera il limite di 32 confronti.")
        required = {"kind", "leftType", "rightType", "left", "operator"}
        allowed = required | {"right", "caseSensitive", "nullBehavior"}
        if not required.issubset(node) or not set(node).issubset(allowed): raise ToolError("INVALID_CONDITION", f"{path}: confronto incompleto o con campi non riconosciuti.")
        comparison = {key: value for key, value in node.items() if key != "kind"}
        try:
            for side in ("left", "right"):
                if side in comparison:
                    operand = comparison[side]
                    if isinstance(operand, dict) and "source" in operand:
                        if context.binding_resolver is None: raise ToolError("INVALID_BINDING", "Il resolver dei binding non è disponibile.")
                        comparison[side] = context.binding_resolver(operand)
            result = _logic_if(context, {}, comparison)
        except ToolError as error:
            raise ToolError(error.code, f"{path}: {error}", retryable=error.retryable) from error
        matched = result.outputs.get("matched")
        if not isinstance(matched, bool): raise ToolError("INVALID_CONDITION", f"{path}: il confronto non ha prodotto un booleano.")
        return matched

    matched = visit(ast, 1, "condition")
    return ToolResult({"boolean": matched, "true" if matched else "false": {"active": True}, "matched": matched})


def _flow_merge(_context: ToolContext, inputs: dict[str, Any], params: dict[str, Any]) -> ToolResult:
    values = list(inputs.values()); return ToolResult({"value": values if params.get("strategy") == "all" else (values[0] if values else None)})


def _data_lookup(_context: ToolContext, inputs: dict[str, Any], params: dict[str, Any]) -> ToolResult:
    rows = inputs.get("items")
    if rows is None and isinstance(inputs.get("record"), dict): rows = [inputs["record"]]
    elif "record" in inputs and "items" in inputs: raise ToolError("INVALID_INPUT", "Collega items oppure record, non entrambi.")
    if not isinstance(rows, list) or len(rows) > 10000:
        raise ToolError("INVALID_INPUT", "data.lookup richiede un array items con massimo 10000 righe.")
    column = params.get("column"); value_type = params.get("valueType"); operator = params.get("operator")
    if not isinstance(column, str) or not column or any(part in ("__proto__", "prototype", "constructor") for part in column.split(".")):
        raise ToolError("INVALID_PARAMS", "Colonna lookup non valida.")
    def type_matches(value: Any) -> bool:
        return value is None if value_type == "null" else isinstance(value, str) if value_type == "string" else isinstance(value, bool) if value_type == "boolean" else isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) if value_type == "number" else isinstance(value, dict) if value_type == "object" else isinstance(value, list) if value_type == "array" else False
    def read_path(item: Any, path: str) -> Any:
        current = item
        for part in path.split("."):
            if not isinstance(current, dict) or part not in current: raise ToolError("INVALID_ROW", f"La colonna '{path}' manca in una riga.")
            current = current[part]
        return current
    def contains(left: Any, right: Any) -> bool:
        if isinstance(left, str) and isinstance(right, str): return right in left
        if isinstance(left, list): return any(type(element) is type(right) and element == right for element in left)
        raise ToolError("INVALID_PARAMS", "contains richiede stringa o array e un valore compatibile.")
    if operator not in ("exact", "contains", "range") or value_type not in ("string", "number", "boolean", "object", "array", "null"):
        raise ToolError("INVALID_PARAMS", "Operatore o tipo lookup non supportato.")
    if operator == "range" and (value_type != "number" or params.get("min") is None and params.get("max") is None):
        raise ToolError("INVALID_PARAMS", "range richiede almeno un limite numerico.")
    minimum, maximum = params.get("min"), params.get("max")
    if operator == "range" and (minimum is not None and (isinstance(minimum, bool) or not isinstance(minimum, (int, float)) or not math.isfinite(minimum)) or maximum is not None and (isinstance(maximum, bool) or not isinstance(maximum, (int, float)) or not math.isfinite(maximum)) or minimum is not None and maximum is not None and minimum > maximum):
        raise ToolError("INVALID_PARAMS", "Limiti range non validi o min maggiore di max.")
    if params.get("result", "object") not in ("column", "object") or params.get("cardinality", "first") not in ("first", "all"):
        raise ToolError("INVALID_PARAMS", "Proiezione o cardinalità lookup non valida.")
    if operator != "range" and params.get("value") is not None and not type_matches(params.get("value")):
        raise ToolError("INVALID_PARAMS", f"value non corrisponde al tipo {value_type}.")
    if operator == "exact" and params.get("value") is None and params.get("nullBehavior", "skip") != "match":
        raise ToolError("INVALID_PARAMS", "Il confronto con null richiede nullBehavior=match.")
    matched: list[Any] = []
    for row in rows:
        actual = read_path(row, column)
        if actual is None:
            behavior = params.get("nullBehavior", "skip")
            if behavior == "error": raise ToolError("INVALID_ROW", f"La colonna '{column}' contiene null.")
            if behavior == "skip": continue
        elif actual is not None and not type_matches(actual):
            raise ToolError("INVALID_ROW", f"La colonna '{column}' non rispetta il tipo {value_type}.")
        if operator == "exact": found = type(actual) is type(params.get("value")) and actual == params.get("value")
        elif operator == "contains": found = contains(actual, params.get("value")) if actual is not None else False
        else:
            found = actual is not None and (params.get("min") is None or actual >= params["min"]) and (params.get("max") is None or actual <= params["max"])
        if found:
            projection = read_path(row, params.get("resultColumn", column)) if params.get("result", "object") == "column" else row
            matched.append(projection)
    if params.get("cardinality", "first") == "first": matched = matched[:1]
    found = bool(matched)
    result_value = matched if params.get("cardinality", "first") == "all" and found else params.get("defaultValue") if not found else matched[0]
    return ToolResult({"value": result_value, "values": matched, "found" if found else "notFound": {"active": True}, "matched": found, "count": len(matched)})


def _select_pages_v1(context: ToolContext, inputs: dict[str, Any], params: dict[str, Any]) -> ToolResult:
    legacy = dict(params)
    if "orderPlan" in legacy and "order" not in legacy:
        plan = legacy.pop("orderPlan")
        entries = plan.get("pages", []) if isinstance(plan, dict) else []
        legacy["order"] = [item.get("currentPage") for item in sorted(entries, key=lambda item: item.get("outputPosition", 0)) if isinstance(item, dict)]
    return _select_pages(context, inputs, legacy, "reorder")


def _select_pages_v11(context: ToolContext, inputs: dict[str, Any], params: dict[str, Any]) -> ToolResult:
    return _select_pages(context, inputs, params, "reorder")


def _delete_pages_v11(context: ToolContext, inputs: dict[str, Any], params: dict[str, Any]) -> ToolResult:
    if params.get("deleteCurrentPage"):
        raise ToolError("LOOP_SCOPE_REQUIRED", "L'eliminazione della pagina corrente è disponibile solo nel body di loop.eachPage.")
    if not isinstance(params.get("pages"), list):
        raise ToolError("INVALID_PARAMS", "Specificare pages oppure attivare deleteCurrentPage nel body del loop.")
    return _select_pages(context, inputs, params, "delete")


def build_registry() -> ToolRegistry:
    registry = ToolRegistry()
    tools: dict[str, ToolFunction] = {
        "pdf.merge": _merge, "pdf.split": _split,
        "pdf.convert.pdfa": _convert_pdfa,
        "pdf.convert.tiff": _convert_tiff,
        "pdf.convert.tiff.pages": _convert_tiff_pages,
        "pdf.page.insert": _insert_pages,
        "pdf.extract-pages": lambda c, i, p: _select_pages(c, i, p, "extract"),
        "pdf.delete-pages": lambda c, i, p: _select_pages(c, i, p, "delete"),
        "pdf.reorder-pages": _select_pages_v1,
        "pdf.rotate": _rotate, "pdf.page.delete": _page_delete, "pdf.detect-page-size": _detect_size, "pdf.normalize-pages": _normalize, "pdf.page.normalize": _normalize_iso,
        "pdf.detect-qr": lambda c, i, p: _decode_codes(c, i, p, False),
        "pdf.qr.readAll": _qr_read_all,
        "pdf.qr.removeMatchedPages": _qr_remove_matched_pages,
        "pdf.detect-barcode": lambda c, i, p: _decode_codes(c, i, p, True), "pdf.remove-qr-pages": _remove_qr_pages,
        "pdf.ocr": _ocr, "pdf.read-metadata": _read_metadata, "pdf.write-metadata": _write_metadata,
        "pdf.bookmarks": _bookmarks, "pdf.bookmark.add": _bookmark_add, "flow.condition": _condition, "logic.if": _logic_if,
        "logic.conditionGroup": _condition_group, "flow.merge": _flow_merge, "data.lookup": _data_lookup,
    }
    for logical_id, fn in tools.items(): registry.register(logical_id, "1.0.0", fn, 1800 if logical_id == "pdf.qr.removeMatchedPages" else 1800 if logical_id in {"pdf.qr.readAll", "pdf.convert.tiff", "pdf.convert.tiff.pages"} else 300 if logical_id in {"pdf.detect-qr", "pdf.detect-barcode", "pdf.remove-qr-pages", "pdf.ocr", "pdf.page.normalize"} else 120 if logical_id.startswith("pdf.") else 30, idempotent=True)
    registry.register("input.pdf-list", "1.0.0", lambda _c, _i, _p: ToolResult({"pdfs": []}), 30, idempotent=True)
    registry.register("pdf.merge", "1.1.0", _merge_planned, 120, idempotent=True)
    registry.register("pdf.merge", "1.2.0", _merge_ordered, 120, idempotent=True)
    registry.register("pdf.reorder-pages", "1.1.0", _select_pages_v11, 120, idempotent=True)
    registry.register("pdf.delete-pages", "1.1.0", _delete_pages_v11, 120, idempotent=True)
    registry.register("pdf.split", "1.1.0", _split_v11, 120, idempotent=True)
    registry.register("pdf.qr.readPage", "1.0.0", _qr_read_page, 120, idempotent=True)
    registry.register("pdf.ocr", "1.1.0", _ocr_v11, 900, idempotent=True)
    return registry
