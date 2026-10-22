from __future__ import annotations

import tempfile
import unittest
import importlib.util
import os
import shutil
import hashlib
import subprocess
import sys
import threading
from unittest.mock import patch
from pathlib import Path

from pypdf import PdfReader, PdfWriter

from pdforchestrator.tools import ToolContext, ToolError, ToolRegistry, ToolResult, _run_isolated, build_registry
from pdforchestrator.workflow import WorkflowExecutor, _audit_safe, _control_flow_for, _derive_control_flow, _execution_summary, _stable_json, _substitute, topological_order
from pdforchestrator.runtime import cleanup_stale_temp_dirs, is_plan_replay_safe


def make_pdf(path: Path, pages: int = 3) -> None:
    writer = PdfWriter()
    for index in range(pages):
        page = writer.add_blank_page(width=595 if index != 1 else 842, height=842 if index != 1 else 595)
        writer.add_metadata({"/Title": "Worker test"})
    with path.open("wb") as stream: writer.write(stream)


def ocr_runtime_available() -> bool:
    binary = os.environ.get("TESSERACT_CMD", "tesseract")
    tesseract_available = Path(binary).is_file() if ("/" in binary or "\\" in binary) else shutil.which(binary) is not None
    return bool(tesseract_available and shutil.which(os.environ.get("POPPLER_BIN", "pdftoppm")) and all(importlib.util.find_spec(module) for module in ("pytesseract", "PIL", "reportlab")))


class SplitToolTests(unittest.TestCase):
    class PypdfTestContext(ToolContext):
        """Test context for pypdf transformation tests when optional pikepdf is not installed."""
        def pdf(self, path):
            self.check()
            file = Path(path)
            if not file.is_file() or file.stat().st_size > self.max_pdf_bytes:
                raise ToolError("INVALID_PDF", "PDF assente o oltre il limite dimensioni.")
            try:
                reader = PdfReader(str(file), strict=True)
                if reader.is_encrypted:
                    raise ToolError("ENCRYPTED_PDF", "I PDF protetti da password non sono supportati.")
                if not 1 <= len(reader.pages) <= self.max_pages:
                    raise ToolError("PAGE_LIMIT", "Numero di pagine non valido o oltre il limite.")
                return reader
            except ToolError:
                raise
            except Exception as exc:
                raise ToolError("INVALID_PDF", str(exc)) from exc

    def test_split_inclusive_ranges_outputs_named_artifacts_and_preserves_metadata(self):
        from pdforchestrator.tools import _split_v11
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "source.pdf"
            make_pdf(source, 4)
            context = self.PypdfTestContext(Path(temp), source_filenames={str(source.resolve()): "fattura originale.pdf"})
            result = _split_v11(context, {"pdf": str(source)}, {
                "mode": "documents",
                "ranges": [{"daPagina": 1, "aPagina": 2}, {"daPagina": 4, "aPagina": 4}],
                "filenameTemplate": "{basename}-{index}-{daPagina}-{aPagina}.pdf",
            })
            self.assertEqual(result.pages_processed, 3)
            self.assertEqual([item["filename"] for item in result.outputs["documents"]], [
                "fattura_originale-1-1-2.pdf", "fattura_originale-2-4-4.pdf",
            ])
            self.assertEqual([len(PdfReader(item["path"]).pages) for item in result.outputs["documents"]], [2, 1])
            self.assertEqual(PdfReader(result.outputs["documents"][0]["path"]).metadata.title, "Worker test")

    def test_native_process_timeout_and_cancellation_terminate_child_process(self):
        with tempfile.TemporaryDirectory() as temp:
            context = ToolContext(Path(temp), timeout_seconds=10)
            with self.assertRaises(subprocess.TimeoutExpired):
                _run_isolated(context, [sys.executable, "-c", "import time; time.sleep(10)"], 0.2)

            cancelled = threading.Event()
            cancel_context = ToolContext(Path(temp), timeout_seconds=10, cancelled=cancelled.is_set)
            timer = threading.Timer(0.2, cancelled.set)
            timer.start()
            try:
                with self.assertRaisesRegex(ToolError, "annullata"):
                    _run_isolated(cancel_context, [sys.executable, "-c", "import time; time.sleep(10)"], 5)
            finally:
                timer.cancel()

    def test_retries_only_handlers_declared_idempotent(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "source.pdf"
            make_pdf(source, 1)
            graph = {"nodes": [
                {"id": "input", "data": {"toolId": "input.pdf", "toolVersion": "1.0.0", "parameters": {"parameter": "document"}}},
                {"id": "flaky", "data": {"toolId": "test.flaky", "toolVersion": "1.0.0", "parameters": {}}},
                {"id": "output", "data": {"toolId": "output.pdf", "toolVersion": "1.1.0", "parameters": {"filename": "result.pdf"}}},
            ], "edges": [
                {"source": "input", "target": "flaky", "sourceHandle": "pdf", "targetHandle": "pdf"},
                {"source": "flaky", "target": "output", "sourceHandle": "pdf", "targetHandle": "pdf"},
            ]}
            class RetryTestContext(ToolContext):
                def pdf(self, _path): return type("Reader", (), {"pages": [object()]})()
            for idempotent, expected_attempts in ((False, 1), (True, 2)):
                calls = []
                def flaky(_context, inputs, _params):
                    calls.append(1)
                    if len(calls) == 1:
                        raise ToolError("TEMPORARY", "retry test", retryable=True)
                    return ToolResult({"pdf": inputs["pdf"]}, 1)
                registry = ToolRegistry()
                registry.register("test.flaky", "1.0.0", flaky, idempotent=idempotent)
                with patch("pdforchestrator.workflow.time.sleep", return_value=None):
                    if idempotent:
                        WorkflowExecutor(registry).execute(graph, {"document": "source"}, {"source": str(source)}, RetryTestContext(Path(temp)), lambda _step: None, lambda *_args: None)
                    else:
                        with self.assertRaisesRegex(ToolError, "retry test"):
                            WorkflowExecutor(registry).execute(graph, {"document": "source"}, {"source": str(source)}, RetryTestContext(Path(temp)), lambda _step: None, lambda *_args: None)
                self.assertEqual(len(calls), expected_attempts)

    def test_recovery_replays_only_plans_with_known_idempotent_handlers(self):
        registry = build_registry()
        batch_version = {"toolManifest": {"formatVersion": 2, "blocks": [
            {"handlerId": "input.pdf", "worker": "orchestrator", "version": "1.0.0"},
            {"handlerId": "pdf.ocr", "worker": "python", "version": "1.1.0"},
        ]}}
        self.assertTrue(is_plan_replay_safe(batch_version, registry))
        batch_version["toolManifest"]["blocks"].append({"handlerId": "unknown.side-effect", "worker": "python", "version": "1.0.0"})
        self.assertFalse(is_plan_replay_safe(batch_version, registry))
        self.assertFalse(is_plan_replay_safe({"toolManifest": {"formatVersion": 2, "blocks": []}}, registry))

    def test_stale_temp_cleanup_is_scoped_to_old_worker_directories(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stale = root / "pdforch-old-job"
            active = root / "pdforch-active-job"
            unrelated = root / "user-files"
            stale.mkdir(); active.mkdir(); unrelated.mkdir()
            for path in (stale, active, unrelated):
                (path / "file.tmp").write_text("x", encoding="utf-8")
            os.utime(stale, (0, 0)); os.utime(unrelated, (0, 0))
            self.assertEqual(cleanup_stale_temp_dirs(root, retention_hours=1, now=7200), 1)
            self.assertFalse(stale.exists())
            self.assertTrue(active.exists())
            self.assertTrue(unrelated.exists())

    def test_split_document_mode_and_invalid_ranges_are_checked_by_worker(self):
        from pdforchestrator.tools import _split_v11
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "source.pdf"
            make_pdf(source)
            context = self.PypdfTestContext(Path(temp))
            result = _split_v11(context, {"pdf": str(source)}, {"mode": "document", "ranges": [{"daPagina": 2, "aPagina": 3}]})
            self.assertTrue(Path(result.outputs["pdf"]).is_file())
            self.assertEqual(len(PdfReader(result.outputs["pdf"]).pages), 2)
            for params in (
                {"mode": "documents", "ranges": [{"daPagina": 0, "aPagina": 1}]},
                {"mode": "documents", "ranges": [{"daPagina": 3, "aPagina": 2}]},
                {"mode": "documents", "ranges": [{"daPagina": 1, "aPagina": 4}]},
                {"mode": "document", "ranges": [{"daPagina": 1, "aPagina": 1}, {"daPagina": 2, "aPagina": 2}]},
                {"mode": "documents", "ranges": [{"daPagina": 1, "aPagina": 1}], "filenameTemplate": "../bad.pdf"},
            ):
                with self.subTest(params=params), self.assertRaises(ToolError):
                    _split_v11(context, {"pdf": str(source)}, params)

    def test_output_node_emits_every_split_artifact(self):
        with tempfile.TemporaryDirectory() as temp:
            context = self.PypdfTestContext(Path(temp))
            first, second = Path(temp) / "one.pdf", Path(temp) / "two.pdf"
            make_pdf(first, 1); make_pdf(second, 2)
            graph = {"nodes": [
                {"id": "split", "data": {"toolId": "pdf.split", "toolVersion": "1.1.0", "parameters": {}}},
                {"id": "out", "data": {"toolId": "output.pdf", "toolVersion": "1.1.0", "parameters": {}}},
            ], "edges": [{"source": "split", "target": "out", "sourceHandle": "documents", "targetHandle": "documents"}]}
            registry = ToolRegistry()
            executor = WorkflowExecutor(registry)
            # Exercise output collection through the same executor path with a small registry handler.
            from pdforchestrator.tools import ToolResult
            registry.register("pdf.split", "1.1.0", lambda _c, _i, _p: ToolResult({"documents": [
                {"path": str(first), "filename": "prima.pdf"}, {"path": str(second), "filename": "seconda.pdf"},
            ]}, 3), 120)
            result = executor.execute(graph, {}, {}, context, lambda _step: None, lambda *_args: None)
            self.assertEqual([item["filename"] for item in result["files"]], ["prima.pdf", "seconda.pdf"])
            self.assertEqual(result["pagesProcessed"], 6)
            without_output_node = {"nodes": [graph["nodes"][0]], "edges": []}
            fallback = executor.execute(without_output_node, {}, {}, context, lambda _step: None, lambda *_args: None)
            self.assertEqual([item["filename"] for item in fallback["files"]], ["prima.pdf", "seconda.pdf"])


class PdfInputResolutionTests(unittest.TestCase):
    def test_input_pdf_does_not_fall_back_to_another_file_when_requested_id_is_missing(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / "other.pdf"; make_pdf(source, 1)
            graph = {"nodes": [{"id": "input", "data": {"toolId": "input.pdf", "toolVersion": "1.0.0", "parameters": {"parameter": "documento"}}}], "edges": []}
            with self.assertRaises(ToolError) as caught:
                WorkflowExecutor(build_registry()).execute(graph, {"documento": "missing-id"}, {"another-file-id": str(source)}, ToolContext(root), lambda _step: None, lambda *_args: None)
            self.assertEqual(caught.exception.code, "INPUT_FILE_NOT_FOUND")

    def test_multiple_input_pdf_blocks_resolve_their_own_api_parameters(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); first = root / "first.pdf"; second = root / "second.pdf"; make_pdf(first, 1); make_pdf(second, 2)
            graph = {"nodes": [
                {"id": "first-input", "data": {"toolId": "input.pdf", "toolVersion": "1.0.0", "parameters": {"parameter": "documento"}}},
                {"id": "second-input", "data": {"toolId": "input.pdf", "toolVersion": "1.0.0", "parameters": {"parameter": "allegato"}}},
            ], "edges": []}
            class TrackingContext(SplitToolTests.PypdfTestContext):
                def __init__(self, *args, **kwargs):
                    super().__init__(*args, **kwargs); self.seen = []
                def pdf(self, path):
                    self.seen.append(str(path))
                    return super().pdf(path)
            context = TrackingContext(root)
            WorkflowExecutor(build_registry()).execute(graph, {"documento": "file-a", "allegato": "file-b"}, {"file-a": str(first), "file-b": str(second)}, context, lambda _step: None, lambda *_args: None)
            self.assertEqual(context.seen, [str(first), str(second)])

    def test_input_pdf_list_keeps_ordered_multi_file_resolution(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); first = root / "first.pdf"; second = root / "second.pdf"; make_pdf(first, 1); make_pdf(second, 1)
            graph = {"nodes": [{"id": "input-list", "data": {"toolId": "input.pdf-list", "toolVersion": "1.0.0", "parameters": {"parameter": "documenti"}}}], "edges": []}
            steps = []
            WorkflowExecutor(build_registry()).execute(graph, {"documenti": ["file-b", "file-a"]}, {"file-a": str(first), "file-b": str(second)}, ToolContext(root), steps.append, lambda *_args: None)
            succeeded = next(step["output"]["pdfs"] for step in steps if step.get("status") == "SUCCEEDED")
            self.assertEqual([item["fileRef"] for item in succeeded], ["file-b", "file-a"])


class OutputFileTests(unittest.TestCase):
    def _run(self, source: Path, context: ToolContext, output_nodes: list[dict], params: dict | None = None):
        input_node = {"id": "input", "data": {"toolId": "input.pdf", "toolVersion": "1.0.0", "parameters": {"parameter": "document"}}}
        nodes = [input_node, *output_nodes]
        edges = [{"id": f"edge-{index}", "source": "input", "target": node["id"], "sourceHandle": "pdf", "targetHandle": "document"} for index, node in enumerate(output_nodes)]
        graph = {"nodes": nodes, "edges": edges}
        steps = []
        result = WorkflowExecutor(build_registry()).execute(graph, {"document": "source-ref"}, {"source-ref": str(source)}, context, steps.append, lambda *_args: None)
        return result, steps

    def test_pdf_output_creates_hash_manifest_and_safe_filename(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "input.pdf"
            make_pdf(source, 2)
            context = SplitToolTests.PypdfTestContext(Path(temp), source_filenames={str(source.resolve()): "fattura originale.pdf"})
            node = {"id": "artifact-1", "data": {"toolId": "pdf.output", "toolVersion": "1.0.0", "parameters": {
                "filenameTemplate": "{basename}-{nodeId}-{index}.pdf", "collisionPolicy": "rename", "contentType": "application/pdf",
            }}}
            result, steps = self._run(source, context, [node])
            self.assertEqual(result["files"][0]["filename"], "fattura_originale-artifact-1-1.pdf")
            self.assertEqual(result["files"][0]["contentType"], "application/pdf")
            step_output = next(step["output"] for step in steps if step["nodeId"] == "artifact-1" and step.get("status") == "SUCCEEDED")
            artifact = step_output["artifact"]
            self.assertEqual(artifact["filename"], result["files"][0]["filename"])
            self.assertEqual(artifact["contentType"], "application/pdf")
            self.assertEqual(artifact["sizeBytes"], Path(result["files"][0]["path"]).stat().st_size)
            self.assertEqual(len(artifact["sha256"]), 64)
            self.assertEqual(step_output["manifest"]["files"][0]["sha256"], artifact["sha256"])

    def test_pdf_output_api_name_uses_the_required_api_filename(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "input.pdf"
            make_pdf(source, 1)
            node = {"id": "api-output", "data": {"toolId": "pdf.output.apiName", "toolVersion": "1.0.0", "parameters": {
                "filename": {"source": "api", "name": "FileFinale"},
            }}}
            graph = {"nodes": [
                {"id": "input", "data": {"toolId": "input.pdf", "toolVersion": "1.0.0", "parameters": {"parameter": "documento"}}},
                node,
            ], "edges": [
                {"id": "output-link", "source": "input", "target": "api-output", "sourceHandle": "pdf", "targetHandle": "document", "data": {"kind": "data"}},
            ]}
            result = WorkflowExecutor(build_registry()).execute(
                graph,
                {"documento": "source-ref", "FileFinale": "OutputFinale.pdf"},
                {"source-ref": str(source)},
                SplitToolTests.PypdfTestContext(Path(temp)),
                lambda _step: None,
                lambda *_args: None,
            )
            self.assertEqual(result["files"][0]["filename"], "OutputFinale.pdf")
            self.assertEqual(len(PdfReader(result["files"][0]["path"]).pages), 1)

    def test_pdf_output_collision_policies_error_rename_and_overwrite(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "input.pdf"
            make_pdf(source, 1)
            def output_node(node_id: str, policy: str):
                return {"id": node_id, "data": {"toolId": "pdf.output", "toolVersion": "1.0.0", "parameters": {
                    "filenameTemplate": "shared.pdf", "collisionPolicy": policy, "contentType": "application/pdf",
                }}}
            for policy, expected in (("rename", ["shared.pdf", "shared-2.pdf"]), ("overwrite", ["shared.pdf"])):
                context = SplitToolTests.PypdfTestContext(Path(temp))
                result, _ = self._run(source, context, [output_node("first", policy), output_node("second", policy)])
                self.assertEqual([item["filename"] for item in result["files"]], expected)
            with self.assertRaises(ToolError) as caught:
                self._run(source, SplitToolTests.PypdfTestContext(Path(temp)), [output_node("first", "error"), output_node("second", "error")])
            self.assertEqual(caught.exception.code, "OUTPUT_COLLISION")


class TiffConversionTests(unittest.TestCase):
    @unittest.skipUnless(importlib.util.find_spec("PIL") and importlib.util.find_spec("reportlab"), "La conversione TIFF richiede Pillow e ReportLab nei test")
    def test_pdf_to_tiff_creates_page_files_and_one_multipage_artifact(self):
        from PIL import Image

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / "source.pdf"; make_pdf(source, 2)
            steps = []
            graph = {
                "nodes": [
                    {"id": "input", "data": {"toolId": "input.pdf", "toolVersion": "1.0.0", "parameters": {"parameter": "documento"}}},
                    {"id": "convert", "data": {"toolId": "pdf.convert.tiff", "toolVersion": "1.0.0", "parameters": {"dpi": 180, "compression": "tiff_lzw"}}},
                    {"id": "pages", "data": {"toolId": "output.tiff.pages", "toolVersion": "1.0.0", "parameters": {}}},
                    {"id": "multipage", "data": {"toolId": "output.tiff.multipage", "toolVersion": "1.0.0", "parameters": {"filename": "all-pages.tiff"}}},
                ],
                "edges": [
                    {"source": "input", "target": "convert", "sourceHandle": "pdf", "targetHandle": "pdf"},
                    {"source": "input", "target": "convert", "sourceHandle": "success", "targetHandle": "run", "data": {"kind": "control"}},
                    {"source": "convert", "target": "pages", "sourceHandle": "pages", "targetHandle": "pages"},
                    {"source": "convert", "target": "multipage", "sourceHandle": "multipage", "targetHandle": "tiff"},
                    {"source": "convert", "target": "pages", "sourceHandle": "success", "targetHandle": "run", "data": {"kind": "control"}},
                    {"source": "convert", "target": "multipage", "sourceHandle": "success", "targetHandle": "run", "data": {"kind": "control"}},
                ],
            }
            context = SplitToolTests.PypdfTestContext(root)
            context.source_filenames[str(source.resolve())] = "document originale.pdf"

            def render(ctx, _pdf, page_number, prefix, dpi=None):
                path = ctx.workdir / f"{prefix}-{page_number}.png"
                Image.new("RGB", (120 + page_number, 80), "white").save(path, dpi=(dpi, dpi))
                return path

            listing = "page num type width height color comp bpc enc interp object ID x-ppi y-ppi size ratio\n"
            with patch.dict(os.environ, {"PDFIMAGES_BIN": "pdfimages"}), \
                 patch("pdforchestrator.tools._run_isolated", return_value=subprocess.CompletedProcess(["pdfimages"], 0, listing, "")), \
                 patch("pdforchestrator.tools._render_page", side_effect=render):
                result = WorkflowExecutor(build_registry()).execute(
                    graph, {"documento": "source-ref"}, {"source-ref": str(source)}, context,
                    steps.append, lambda *_: None,
                )

            self.assertEqual([file["filename"] for file in result["files"]], ["document_originale-page-0001.tiff", "document_originale-page-0002.tiff", "all-pages.tiff"])
            self.assertTrue(all(file["contentType"] == "image/tiff" for file in result["files"]))
            for file in result["files"][:2]:
                with Image.open(file["path"]) as image:
                    self.assertEqual(image.format, "TIFF")
                    self.assertEqual(image.n_frames, 1)
                    self.assertAlmostEqual(image.info["dpi"][0], 180, delta=1)
            with Image.open(result["files"][2]["path"]) as image:
                self.assertEqual(image.format, "TIFF")
                self.assertEqual(image.n_frames, 2)
            self.assertTrue(any(step.get("nodeId") == "convert" and step.get("status") == "SUCCEEDED" for step in steps))

    @unittest.skipUnless(importlib.util.find_spec("PIL"), "La verifica DPI richiede Pillow nei test")
    def test_pdf_to_tiff_rejects_dpi_above_original_embedded_image_resolution(self):
        from PIL import Image
        from reportlab.pdfgen import canvas

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); image_path = root / "scan.png"; source = root / "scan.pdf"
            Image.new("RGB", (120, 120), "white").save(image_path)
            page = canvas.Canvas(str(source), pagesize=(612, 792))
            page.drawImage(str(image_path), 72, 72, width=72, height=72)
            page.save()
            context = SplitToolTests.PypdfTestContext(root)
            listing = "page num type width height color comp bpc enc interp object ID x-ppi y-ppi size ratio\n1 0 image 120 120 rgb 3 8 image no 3 0 72 72 1K 1%\n"
            with patch.dict(os.environ, {"PDFIMAGES_BIN": "pdfimages"}), \
                 patch("pdforchestrator.tools._run_isolated", return_value=subprocess.CompletedProcess(["pdfimages"], 0, listing, "")), \
                 patch("pdforchestrator.tools._render_page") as render:
                with self.assertRaises(ToolError) as raised:
                    build_registry().get("pdf.convert.tiff", "1.0.0")(context, {"pdf": str(source)}, {"dpi": 150, "compression": "tiff_lzw"})
            self.assertEqual(raised.exception.code, "SOURCE_RESOLUTION_TOO_LOW")
            render.assert_not_called()

    @unittest.skipUnless(importlib.util.find_spec("PIL") and importlib.util.find_spec("reportlab"), "La conversione TIFF richiede Pillow e ReportLab nei test")
    def test_single_page_conversion_and_multipage_range_create_selected_pages_only(self):
        from PIL import Image

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / "source.pdf"; make_pdf(source, 3)
            graph = {
                "nodes": [
                    {"id": "input", "data": {"toolId": "input.pdf", "toolVersion": "1.0.0", "parameters": {"parameter": "documento"}}},
                    {"id": "convert", "data": {"toolId": "pdf.convert.tiff.pages", "toolVersion": "1.0.0", "parameters": {"dpi": 180, "compression": "tiff_lzw"}}},
                    {"id": "multipage", "data": {"toolId": "output.tiff.createMultipage", "toolVersion": "1.0.0", "parameters": {"filename": "estratto.tiff", "fromIndex": 2, "toIndex": 2, "compression": "jpeg", "quality": 85}}},
                ],
                "edges": [
                    {"source": "input", "target": "convert", "sourceHandle": "pdf", "targetHandle": "pdf"},
                    {"source": "input", "target": "convert", "sourceHandle": "success", "targetHandle": "run", "data": {"kind": "control"}},
                    {"source": "convert", "target": "multipage", "sourceHandle": "pages", "targetHandle": "pages"},
                    {"source": "convert", "target": "multipage", "sourceHandle": "success", "targetHandle": "run", "data": {"kind": "control"}},
                ],
            }
            context = SplitToolTests.PypdfTestContext(root)
            context.source_filenames[str(source.resolve())] = "document original.pdf"

            def render(ctx, _pdf, page_number, prefix, dpi=None):
                path = ctx.workdir / f"{prefix}-{page_number}.png"
                Image.new("RGB", (120 + page_number, 80), "white").save(path, dpi=(dpi, dpi))
                return path

            listing = "page num type width height color comp bpc enc interp object ID x-ppi y-ppi size ratio\n"
            with patch.dict(os.environ, {"PDFIMAGES_BIN": "pdfimages"}), \
                 patch("pdforchestrator.tools._run_isolated", return_value=subprocess.CompletedProcess(["pdfimages"], 0, listing, "")), \
                 patch("pdforchestrator.tools._render_page", side_effect=render):
                result = WorkflowExecutor(build_registry()).execute(graph, {"documento": "source-ref"}, {"source-ref": str(source)}, context, lambda *_: None, lambda *_: None)

            self.assertEqual([(file["filename"], file["contentType"]) for file in result["files"]], [("estratto.tiff", "image/tiff")])
            with Image.open(result["files"][0]["path"]) as image:
                self.assertEqual(image.format, "TIFF")
                self.assertEqual(image.n_frames, 1)
                self.assertEqual(image.info.get("compression"), "jpeg")

            graph["nodes"][2]["data"]["parameters"] = {"filename": "tutte.tiff", "fromIndex": 0, "toIndex": 0}
            with patch.dict(os.environ, {"PDFIMAGES_BIN": "pdfimages"}), \
                 patch("pdforchestrator.tools._run_isolated", return_value=subprocess.CompletedProcess(["pdfimages"], 0, listing, "")), \
                 patch("pdforchestrator.tools._render_page", side_effect=render):
                all_pages = WorkflowExecutor(build_registry()).execute(graph, {"documento": "source-ref"}, {"source-ref": str(source)}, context, lambda *_: None, lambda *_: None)
            with Image.open(all_pages["files"][0]["path"]) as image:
                self.assertEqual(image.n_frames, 3)


class PdfaConversionTests(unittest.TestCase):
    def test_conversion_requires_successful_verapdf_report_for_selected_profile(self):
        from subprocess import CompletedProcess
        from pdforchestrator.tools import _convert_pdfa
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / "source.pdf"; make_pdf(source, 2)
            icc = root / "srgb.icc"; profile = bytearray(128); profile[0:4] = (128).to_bytes(4, "big"); profile[16:20] = b"RGB "; profile[36:40] = b"acsp"; icc.write_bytes(profile)
            context = SplitToolTests.PypdfTestContext(root, timeout_seconds=30)
            output = context.output_path()
            report_xml = ('<?xml version="1.0"?><report><jobs><job><validationReport profileName="PDF/A-2B validation profile" isCompliant="true"><details passedRules="100" failedRules="0" passedChecks="250" failedChecks="0"/></validationReport></job></jobs></report>')
            calls = []
            def run(args, **kwargs):
                calls.append((args, kwargs))
                if args[0] == "gs-test":
                    out_arg = next(item for item in args if item.startswith("-sOutputFile="))
                    Path(out_arg.split("=", 1)[1]).write_bytes(source.read_bytes())
                    return CompletedProcess(args, 0, "", "")
                return CompletedProcess(args, 0, report_xml, "")
            with patch.dict("os.environ", {"PDFA_ICC_PROFILE": str(icc), "GHOSTSCRIPT_BIN": "gs-test", "VERAPDF_BIN": "vera-test"}), patch("pdforchestrator.tools._run_isolated", side_effect=lambda _context, args, _timeout: run(args)):
                result = _convert_pdfa(context, {"pdf": str(source)}, {"target": "PDF/A-2b"})
            self.assertEqual(result.outputs["pdf"], str(output))
            self.assertEqual(result.outputs["validationReport"]["validator"], "veraPDF")
            self.assertEqual(result.outputs["validationReport"]["profile"], "PDF/A-2b")
            self.assertTrue(result.outputs["validationReport"]["isCompliant"])
            self.assertEqual(result.outputs["validationReport"]["failedChecks"], 0)
            gs_args = calls[0][0]
            self.assertIn("-dPDFA=2", gs_args)
            self.assertIn("-dPDFACompatibilityPolicy=2", gs_args)
            self.assertIn(f"--permit-file-read={icc.resolve()}", gs_args)
            self.assertEqual(calls[1][0][1:4], ["-f", "2b", "--format"])

    def test_conversion_rejects_non_compliant_or_unverifiable_output(self):
        from subprocess import CompletedProcess
        from pdforchestrator.tools import _convert_pdfa
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / "source.pdf"; make_pdf(source, 1)
            icc = root / "srgb.icc"; profile = bytearray(128); profile[0:4] = (128).to_bytes(4, "big"); profile[16:20] = b"RGB "; profile[36:40] = b"acsp"; icc.write_bytes(profile)
            context = SplitToolTests.PypdfTestContext(root)
            def run(args, **kwargs):
                if args[0] == "gs-test":
                    out_arg = next(item for item in args if item.startswith("-sOutputFile="))
                    Path(out_arg.split("=", 1)[1]).write_bytes(source.read_bytes())
                    return CompletedProcess(args, 0, "", "")
                xml = '<report><jobs><job><validationReport profileName="PDF/A-1B validation profile" isCompliant="false"><details passedRules="99" failedRules="1" passedChecks="200" failedChecks="2"/></validationReport></job></jobs></report>'
                return CompletedProcess(args, 0, xml, "")
            with patch.dict("os.environ", {"PDFA_ICC_PROFILE": str(icc), "GHOSTSCRIPT_BIN": "gs-test", "VERAPDF_BIN": "vera-test"}), patch("pdforchestrator.tools._run_isolated", side_effect=lambda _context, args, _timeout: run(args)):
                with self.assertRaisesRegex(ToolError, "non è conforme") as caught:
                    _convert_pdfa(context, {"pdf": str(source)}, {"target": "PDF/A-1b"})
                self.assertEqual(caught.exception.code, "PDFA_NON_COMPLIANT")
            def malformed_report_run(args, **kwargs):
                if args[0] == "gs-test":
                    out_arg = next(item for item in args if item.startswith("-sOutputFile="))
                    Path(out_arg.split("=", 1)[1]).write_bytes(source.read_bytes())
                    return CompletedProcess(args, 0, "", "")
                return CompletedProcess(args, 0, "not xml", "")
            with patch.dict("os.environ", {"PDFA_ICC_PROFILE": str(icc), "GHOSTSCRIPT_BIN": "gs-test", "VERAPDF_BIN": "vera-test"}), patch("pdforchestrator.tools._run_isolated", side_effect=lambda _context, args, _timeout: malformed_report_run(args)):
                with self.assertRaisesRegex(ToolError, "validationReport leggibile"):
                    _convert_pdfa(context, {"pdf": str(source)}, {"target": "PDF/A-1b"})


class OcrRangeTests(unittest.TestCase):
    def test_worker_rejects_invalid_range_and_dpi(self):
        from pdforchestrator.tools import _ocr_v11
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / "input.pdf"; make_pdf(source, 3)
            context = SplitToolTests.PypdfTestContext(root)
            for params, message in (({"from": 0}, "from deve essere"), ({"from": 2, "to": 1}, "to deve essere"), ({"from": 1, "to": 4}, "to deve essere"), ({"dpi": 601}, "dpi deve essere")):
                with self.subTest(params=params), self.assertRaisesRegex(ToolError, message):
                    _ocr_v11(context, {"pdf": str(source)}, params)

    @unittest.skipUnless(ocr_runtime_available(), "OCR end-to-end richiede Tesseract, Poppler, pytesseract, Pillow e reportlab")
    def test_scanned_page_range_gets_selectable_text_and_existing_text_is_skipped(self):
        from PIL import Image, ImageDraw, ImageFont
        from reportlab.lib.utils import ImageReader
        from reportlab.pdfgen.canvas import Canvas
        from pdforchestrator.tools import _ocr_v11
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / "mixed.pdf"
            canvas = Canvas(str(source), pagesize=(612, 792))
            for label in ("SCANNED OCR 471", "EXISTING DIGITAL 222", "SECOND SCAN 953"):
                if label == "EXISTING DIGITAL 222":
                    canvas.setFont("Helvetica", 28); canvas.drawString(72, 400, label)
                else:
                    image = Image.new("RGB", (1800, 600), "white")
                    draw = ImageDraw.Draw(image)
                    draw.text((100, 180), label, fill="black", font=ImageFont.load_default(size=100))
                    canvas.drawImage(ImageReader(image), 0, 0, width=612, height=792)
                canvas.showPage()
            canvas.save()
            progress = []
            context = SplitToolTests.PypdfTestContext(root, timeout_seconds=900, progress=lambda done, total: progress.append((done, total)))
            result = _ocr_v11(context, {"pdf": str(source)}, {
                "from": 1, "to": 3, "languages": ["eng"], "dpi": 250,
                "skipExistingText": True, "searchableOverlay": True, "includeExtractedText": True,
            })
            output = PdfReader(result.outputs["pdf"], strict=True)
            page_texts = [page.extract_text() or "" for page in output.pages]
            self.assertEqual(len(output.pages), 3)
            self.assertIn("SCANNED", page_texts[0].upper())
            self.assertIn("471", page_texts[0])
            self.assertIn("EXISTING DIGITAL 222", page_texts[1])
            self.assertIn("SECOND", page_texts[2].upper())
            self.assertIn("953", page_texts[2])
            self.assertIn("SCANNED", result.outputs["extractedText"].upper())
            self.assertIn("EXISTING DIGITAL 222", result.outputs["extractedText"])
            self.assertEqual(result.pages_processed, 3)
            self.assertEqual(progress[-1], (3, 3))


class QrReadPageTests(unittest.TestCase):
    def test_reads_multiple_real_qr_codes_and_returns_empty_result_for_blank_page(self):
        import zxingcpp
        from PIL import Image
        from unittest.mock import patch
        from pdforchestrator.tools import _qr_read_page
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "two-pages.pdf"
            make_pdf(source, 2)
            qr_canvas = Image.new("RGB", (850, 420), "white")
            for index, value in enumerate(("QR-FIRST", "QR-SECOND")):
                bitmap = Image.fromarray(zxingcpp.create_barcode(value, zxingcpp.BarcodeFormat.QRCode).to_image(256)).convert("RGB")
                qr_canvas.paste(bitmap, (20 + index * 410, 30))
            blank_page = Image.new("RGB", (850, 420), "white")
            qr_path, blank_path = root / "qr-fixture.png", root / "blank-fixture.png"
            qr_canvas.save(qr_path); blank_page.save(blank_path)
            context = SplitToolTests.PypdfTestContext(root)

            def render(_context, _pdf, page, _prefix, dpi=None):
                self.assertEqual(dpi, 240)
                return qr_path if page == 1 else blank_path

            with patch("pdforchestrator.tools._render_page", side_effect=render):
                found = _qr_read_page(context, {"pdf": str(source)}, {"page": 1, "dpi": 240, "preprocess": "autocontrast"})
                empty = _qr_read_page(context, {"pdf": str(source)}, {"page": 2, "dpi": 240, "preprocess": "none"})
            codes = found.outputs["codes"]
            self.assertEqual(found.outputs["found"], True)
            self.assertEqual(found.outputs["count"], 2)
            self.assertEqual({item["value"] for item in codes}, {"QR-FIRST", "QR-SECOND"})
            for code in codes:
                self.assertEqual(code["page"], 1)
                self.assertEqual(code["format"], "QR_CODE")
                self.assertGreater(code["bbox"]["width"], 0)
                self.assertGreater(code["bbox"]["height"], 0)
                self.assertGreaterEqual(code["bbox"]["x"], 0)
            self.assertEqual(empty.outputs, {"codes": [], "found": False, "count": 0})

    def test_rejects_out_of_range_page_and_invalid_dpi(self):
        from pdforchestrator.tools import _qr_read_page
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / "one-page.pdf"; make_pdf(source, 1)
            context = SplitToolTests.PypdfTestContext(root)
            for params in ({"page": 2}, {"page": 1, "dpi": 601}, {"page": True}):
                with self.subTest(params=params), self.assertRaises(ToolError):
                    _qr_read_page(context, {"pdf": str(source)}, params)


class QrReadAllTests(unittest.TestCase):
    def _fixtures(self, root: Path):
        import zxingcpp
        from PIL import Image
        qr_canvas = Image.new("RGB", (850, 420), "white")
        for index, value in enumerate(("PAGE-ONE-A", "PAGE-ONE-B")):
            bitmap = Image.fromarray(zxingcpp.create_barcode(value, zxingcpp.BarcodeFormat.QRCode).to_image(256)).convert("RGB")
            qr_canvas.paste(bitmap, (20 + index * 410, 30))
        second_qr = Image.new("RGB", (850, 420), "white")
        bitmap = Image.fromarray(zxingcpp.create_barcode("PAGE-THREE", zxingcpp.BarcodeFormat.QRCode).to_image(256)).convert("RGB")
        second_qr.paste(bitmap, (120, 55))
        paths = {}
        for page, image in ((1, qr_canvas), (2, Image.new("RGB", (850, 420), "white")), (3, second_qr), (4, Image.new("RGB", (850, 420), "white"))):
            paths[page] = root / f"qr-page-{page}.png"
            image.save(paths[page])
        return paths

    def test_scans_mixed_page_range_with_multiple_codes_sorted_and_reports_progress(self):
        import threading
        import time
        from unittest.mock import patch
        from pdforchestrator.tools import _qr_read_all
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / "mixed.pdf"; make_pdf(source, 4)
            fixtures = self._fixtures(root)
            progress = []; lock = threading.Lock(); active = 0; max_active = 0
            def render(_context, _pdf, page, _prefix, dpi=None):
                nonlocal active, max_active
                self.assertEqual(dpi, 180)
                with lock:
                    active += 1; max_active = max(max_active, active)
                try:
                    time.sleep(0.03 * (5 - page))
                    return fixtures[page]
                finally:
                    with lock: active -= 1
            context = SplitToolTests.PypdfTestContext(root, progress=lambda done, total: progress.append((done, total)))
            with patch("pdforchestrator.tools._render_page", side_effect=render):
                result = _qr_read_all(context, {"pdf": str(source)}, {"startPage": 1, "endPage": 4, "dpi": 180, "preprocess": "none", "concurrency": 2})
            codes = result.outputs["codes"]
            self.assertEqual([code["page"] for code in codes], [1, 1, 3])
            self.assertEqual([code["value"] for code in codes], ["PAGE-ONE-A", "PAGE-ONE-B", "PAGE-THREE"])
            self.assertEqual(result.outputs["pagesScanned"], 4)
            self.assertEqual(result.pages_processed, 4)
            self.assertEqual(progress[-1], (4, 4))
            self.assertEqual([done for done, _ in progress], sorted(done for done, _ in progress))
            self.assertGreaterEqual(max_active, 2)
            self.assertLessEqual(max_active, 2)

    def test_scan_range_and_concurrency_are_validated(self):
        from pdforchestrator.tools import _qr_read_all
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / "three.pdf"; make_pdf(source, 3)
            context = SplitToolTests.PypdfTestContext(root)
            for params in ({"startPage": 0}, {"startPage": 2, "endPage": 4}, {"startPage": 3, "endPage": 2}, {"concurrency": 9}, {"concurrency": True}):
                with self.subTest(params=params), self.assertRaises(ToolError):
                    _qr_read_all(context, {"pdf": str(source)}, params)

    def test_cancellation_during_scan_stops_page_work(self):
        import threading
        import time
        from unittest.mock import patch
        from pdforchestrator.tools import _qr_read_all
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / "three.pdf"; make_pdf(source, 3)
            from PIL import Image
            cancelled = threading.Event(); rendered = []; fixture = root / "blank.png"; Image.new("RGB", (200, 200), "white").save(fixture)
            def render(_context, _pdf, page, prefix, dpi=None):
                del prefix, dpi
                _context.check()
                rendered.append(page)
                time.sleep(0.1)
                return fixture
            timer = threading.Timer(0.04, cancelled.set); timer.start()
            context = SplitToolTests.PypdfTestContext(root, cancelled=cancelled.is_set)
            try:
                with patch("pdforchestrator.tools._render_page", side_effect=render):
                    with self.assertRaisesRegex(ToolError, "annullata"):
                        _qr_read_all(context, {"pdf": str(source)}, {"startPage": 1, "endPage": 3, "concurrency": 1})
            finally:
                timer.cancel(); timer.join()
            self.assertEqual(rendered, [1])


class QrMatchedPageRemovalTests(unittest.TestCase):
    def test_removes_only_matched_pages_and_bookmarks_the_next_retained_page(self):
        from unittest.mock import patch
        from pdforchestrator.tools import _qr_remove_matched_pages
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / "input.pdf"; make_pdf(source, 4)
            context = SplitToolTests.PypdfTestContext(root, progress=lambda *_args: None)
            codes = {
                1: [{"value": "QR-A", "format": "QR_CODE"}],
                2: [{"value": "QR-NOT-IN-LIST", "format": "QR_CODE"}],
                3: [{"value": "QR-B", "format": "QR_CODE"}],
                4: [],
            }
            with patch("pdforchestrator.tools._scan_qr_page", side_effect=lambda _context, _pdf, page, _dpi, _preprocess: codes[page]):
                result = _qr_remove_matched_pages(context, {"pdf": str(source)}, {
                    "records": [{"testoQR": "QR-A", "nomeQR": "Fattura A"}, {"testoQR": "QR-B", "nomeQR": "Fattura B"}],
                })
            output = PdfReader(result.outputs["pdf"], strict=True)
            self.assertEqual(len(output.pages), 2)
            self.assertEqual(result.outputs["removedPages"], [1, 3])
            self.assertEqual([item["page"] for item in result.outputs["bookmarks"]], [1, 2])
            self.assertEqual([item.title for item in output.outline], ["Fattura A", "Fattura B"])
            self.assertEqual([output.get_destination_page_number(item) for item in output.outline], [0, 1])
            self.assertEqual([item["value"] for item in result.outputs["matches"]], ["QR-A", "QR-B"])

    def test_rejects_ambiguous_records_and_an_empty_result_pdf(self):
        from unittest.mock import patch
        from pdforchestrator.tools import _qr_remove_matched_pages
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / "input.pdf"; make_pdf(source, 1)
            context = SplitToolTests.PypdfTestContext(root)
            with self.assertRaisesRegex(ToolError, "compare più volte"):
                _qr_remove_matched_pages(context, {"pdf": str(source)}, {"records": [
                    {"testoQR": "QR-A", "nomeQR": "A"}, {"testoQR": "QR-A", "nomeQR": "B"},
                ]})
            with patch("pdforchestrator.tools._scan_qr_page", return_value=[{"value": "QR-A", "format": "QR_CODE"}]):
                with self.assertRaisesRegex(ToolError, "Tutte le pagine verrebbero rimosse"):
                    _qr_remove_matched_pages(context, {"pdf": str(source)}, {"records": [{"testoQR": "QR-A", "nomeQR": "A"}]})


class BookmarkAddTests(unittest.TestCase):
    def test_adds_unicode_bookmarks_at_multiple_levels_and_preserves_existing_outline(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / "with-outline.pdf"
            writer = PdfWriter()
            for _ in range(3): writer.add_blank_page(width=595, height=842)
            writer.add_outline_item("Indice esistente", 0)
            with source.open("wb") as stream: writer.write(stream)
            context = SplitToolTests.PypdfTestContext(root)
            tool = build_registry().get("pdf.bookmark.add", "1.0.0")
            first = tool(context, {"pdf": str(source)}, {"page": 2, "description": "Caffè e finanza Ω", "level": 0})
            second = tool(context, {"pdf": first.outputs["pdf"]}, {"page": 3, "description": "第２章 — Résultats", "level": 1, "parent": "Caffè e finanza Ω"})
            third = tool(context, {"pdf": second.outputs["pdf"]}, {"page": 3, "description": "Überblick 📄", "level": 2, "parent": "第２章 — Résultats"})
            result = PdfReader(third.outputs["pdf"])
            self.assertEqual(result.outline[0].title, "Indice esistente")
            self.assertEqual(result.outline[1].title, "Caffè e finanza Ω")
            self.assertEqual(result.outline[2][0].title, "第２章 — Résultats")
            self.assertEqual(result.outline[2][1][0].title, "Überblick 📄")
            self.assertEqual(result.get_destination_page_number(result.outline[1]), 1)
            self.assertEqual(result.get_destination_page_number(result.outline[2][0]), 2)
            self.assertEqual(result.get_destination_page_number(result.outline[2][1][0]), 2)
            self.assertEqual(len(result.pages), 3)

    def test_rejects_invalid_page_level_and_missing_or_ambiguous_parent(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / "outline.pdf"
            writer = PdfWriter(); writer.add_blank_page(width=595, height=842); writer.add_blank_page(width=595, height=842)
            writer.add_outline_item("Sezione", 0); writer.add_outline_item("Sezione", 1)
            with source.open("wb") as stream: writer.write(stream)
            context = SplitToolTests.PypdfTestContext(root)
            tool = build_registry().get("pdf.bookmark.add", "1.0.0")
            for params in ({"page": 0, "description": "X"}, {"page": 1, "description": "X", "level": 1}, {"page": 1, "description": "X", "parent": "Assente", "level": 1}):
                with self.subTest(params=params), self.assertRaises(ToolError): tool(context, {"pdf": str(source)}, params)
            with self.assertRaisesRegex(ToolError, "non è univoco"):
                tool(context, {"pdf": str(source)}, {"page": 2, "description": "Figlio", "level": 1, "parent": "Sezione"})


class PageDeleteTests(unittest.TestCase):
    def test_deduplicates_original_page_numbers_and_accepts_stable_page_id(self):
        import hashlib
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / "mixed.pdf"; make_pdf(source, 4)
            context = SplitToolTests.PypdfTestContext(root); tool = build_registry().get("pdf.page.delete", "1.0.0")
            result = tool(context, {"pdf": str(source)}, {"pages": [3, 1, 3]})
            output = PdfReader(result.outputs["pdf"])
            self.assertEqual(result.outputs["deletedPages"], [1, 3])
            digest = hashlib.sha256(source.read_bytes()).hexdigest()[:16]
            self.assertEqual(result.outputs["deletedPageIds"], [f"{digest}:page:1", f"{digest}:page:3"])
            self.assertEqual([round(float(page.mediabox.width)) for page in output.pages], [842, 595])
            self.assertEqual(output.metadata.title, "Worker test")
            by_id = tool(context, {"pdf": str(source)}, {"pageId": f"{digest}:page:4"})
            self.assertEqual(by_id.outputs["deletedPages"], [4])
            self.assertEqual(len(PdfReader(by_id.outputs["pdf"]).pages), 3)
            with self.assertRaisesRegex(ToolError, "PDF diverso o modificato"):
                tool(context, {"pdf": str(source)}, {"pageId": f"0000000000000000:page:2"})

    def test_rejects_invalid_references_and_prevents_an_empty_pdf(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / "two.pdf"; make_pdf(source, 2)
            context = SplitToolTests.PypdfTestContext(root); tool = build_registry().get("pdf.page.delete", "1.0.0")
            for params in ({}, {"page": 1, "pages": [2]}, {"page": True}, {"pages": [0]}, {"pages": [1, 2]}):
                with self.subTest(params=params), self.assertRaises(ToolError): tool(context, {"pdf": str(source)}, params)

    def test_qr_condition_deletes_original_pages_inside_each_page_loop(self):
        import zxingcpp
        from PIL import Image
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / "three-mixed-pages.pdf"; make_pdf(source, 3); steps = []
            page_images = {}
            for page, value in ((1, "DELETE-1"), (3, "DELETE-3")):
                image = Image.fromarray(zxingcpp.create_barcode(value, zxingcpp.BarcodeFormat.QRCode).to_image(220)).convert("RGB")
                path = root / f"page-{page}.png"; image.save(path); page_images[page] = path
            blank = root / "blank.png"; Image.new("RGB", (220, 220), "white").save(blank); page_images[2] = blank
            render_index = 0
            def render(_context, _pdf, _page, _prefix, dpi=None):
                nonlocal render_index
                render_index += 1
                return page_images[render_index]
            condition = {"kind": "comparison", "leftType": "boolean", "rightType": "boolean", "left": {"source": "node", "nodeId": "qr", "port": "found"}, "right": True, "operator": "eq"}
            nodes = [
                {"id": "input", "data": {"toolId": "input.pdf", "toolVersion": "1.0.0", "parameters": {}}},
                {"id": "loop", "data": {"toolId": "loop.eachPage", "toolVersion": "1.0.0", "parameters": {"start": 1, "step": 1, "maxIterations": 3}}},
                {"id": "qr", "data": {"toolId": "pdf.qr.readPage", "toolVersion": "1.0.0", "parameters": {"page": 1, "dpi": 200}}},
                {"id": "condition", "data": {"toolId": "logic.conditionGroup", "toolVersion": "1.0.0", "parameters": {"condition": condition}}},
                {"id": "delete", "data": {"toolId": "pdf.page.delete", "toolVersion": "1.0.0", "parameters": {"pageId": {"source": "loop", "name": "pageId"}}}},
                {"id": "output", "data": {"toolId": "output.pdf", "toolVersion": "1.0.0", "parameters": {"filename": "retained.pdf"}}},
            ]
            edges = [
                {"source": "input", "target": "loop", "sourceHandle": "pdf", "targetHandle": "document"},
                {"source": "loop", "target": "qr", "sourceHandle": "body", "targetHandle": "run", "data": {"kind": "control"}},
                {"source": "loop", "target": "qr", "sourceHandle": "document", "targetHandle": "pdf"},
                {"source": "qr", "target": "condition", "sourceHandle": "success", "targetHandle": "run", "data": {"kind": "control"}},
                {"source": "condition", "target": "delete", "sourceHandle": "true", "targetHandle": "run", "data": {"kind": "control"}},
                {"source": "loop", "target": "delete", "sourceHandle": "document", "targetHandle": "pdf"},
                {"source": "loop", "target": "output", "sourceHandle": "document", "targetHandle": "pdf"},
                {"source": "loop", "target": "output", "sourceHandle": "after", "targetHandle": "run", "data": {"kind": "control"}},
            ]
            context = SplitToolTests.PypdfTestContext(root)
            with patch("pdforchestrator.tools._render_page", side_effect=render):
                result = WorkflowExecutor(build_registry()).execute({"nodes": nodes, "edges": edges}, {}, {"file": str(source)}, context, steps.append, lambda *_: None)
            output_pdf = PdfReader(result["files"][0]["path"])
            self.assertEqual(len(output_pdf.pages), 1)
            self.assertEqual(round(float(output_pdf.pages[0].mediabox.width)), 842)
            deletes = [item for item in steps if item.get("nodeId") == "delete" and item.get("status") == "SUCCEEDED"]
            self.assertEqual([item["output"]["deletedPages"] for item in deletes], [[1], [3]])
            self.assertEqual(len({item["output"]["deletedPageIds"][0] for item in deletes}), 2)


class IsoPageNormalizeTests(unittest.TestCase):
    def _source(self, path: Path, sizes: list[tuple[float, float]]) -> None:
        from io import BytesIO
        from reportlab.pdfgen.canvas import Canvas
        buffer = BytesIO()
        canvas = Canvas(buffer, pagesize=sizes[0])
        canvas.setTitle("ISO normalization metadata")
        for index, size in enumerate(sizes):
            if index:
                canvas.setPageSize(size)
            canvas.drawString(24, 30, f"preserved page text {index + 1}")
            canvas.showPage()
        canvas.save()
        path.write_bytes(buffer.getvalue())

    def test_mixed_sizes_auto_orientation_tolerance_oversize_and_content_metadata(self):
        from pdforchestrator.tools import ISO_PAGE_SIZES
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / "mixed.pdf"
            a6 = ISO_PAGE_SIZES["A6"]
            a5_landscape = tuple(reversed(ISO_PAGE_SIZES["A5"]))
            a3 = ISO_PAGE_SIZES["A3"]
            a4 = ISO_PAGE_SIZES["A4"]
            self._source(source, [a6, a5_landscape, a3, a4])
            context = SplitToolTests.PypdfTestContext(root)
            tool = build_registry().get("pdf.page.normalize", "1.0.0")
            result = tool(context, {"pdf": str(source)}, {})
            output = PdfReader(result.outputs["pdf"])
            self.assertEqual(result.pages_processed, 4)
            self.assertEqual(len(result.outputs["modifiedPages"]), 2)
            self.assertEqual(result.outputs["modifiedPages"][0]["reason"], "canvasExpanded")
            self.assertEqual(result.outputs["modifiedPages"][1]["orientation"], "landscape")
            self.assertAlmostEqual(float(output.pages[0].mediabox.width), 595.2756, places=2)
            self.assertAlmostEqual(float(output.pages[0].mediabox.height), 841.8898, places=2)
            self.assertAlmostEqual(float(output.pages[1].mediabox.width), 841.8898, places=2)
            self.assertAlmostEqual(float(output.pages[1].mediabox.height), 595.2756, places=2)
            self.assertEqual([item["reason"] for item in result.outputs["skippedPages"]], ["aboveTarget", "withinTolerance"])
            self.assertEqual(output.metadata.title, "ISO normalization metadata")
            self.assertIn("preserved page text 1", output.pages[0].extract_text())
            self.assertEqual(result.outputs["reason"]["code"], "PAGES_MODIFIED")
            self.assertEqual(len(result.outputs["reason"]["pages"]), 4)

    def test_scale_content_target_anchor_scope_and_point_dimensions(self):
        from pdforchestrator.tools import ISO_PAGE_SIZES
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / "scope.pdf"
            self._source(source, [ISO_PAGE_SIZES["A6"], ISO_PAGE_SIZES["A6"], ISO_PAGE_SIZES["A6"]])
            context = SplitToolTests.PypdfTestContext(root)
            tool = build_registry().get("pdf.page.normalize", "1.0.0")
            result = tool(context, {"pdf": str(source)}, {
                "size": "A5", "orientation": "portrait", "tolerancePercent": 0,
                "mode": "SCALE_CONTENT", "anchor": "TOP_RIGHT", "pageScope": "RANGE", "fromPage": 2, "toPage": 2,
            })
            pages = PdfReader(result.outputs["pdf"]).pages
            self.assertEqual(len(result.outputs["modifiedPages"]), 1)
            self.assertAlmostEqual(float(pages[1].mediabox.width), 419.5276, places=2)
            self.assertAlmostEqual(float(pages[1].mediabox.height), 595.2756, places=2)
            self.assertEqual(result.outputs["modifiedPages"][0]["reason"], "contentScaled")
            self.assertEqual([item["reason"] for item in result.outputs["skippedPages"]], ["outOfScope", "outOfScope"])
            with self.assertRaises(ToolError):
                tool(context, {"pdf": str(source)}, {"pageScope": "RANGE", "fromPage": 3, "toPage": 4})
            with self.assertRaises(ToolError):
                tool(context, {"pdf": str(source)}, {"pageScope": "SELECTED", "pages": [1, 1]})

    def test_small_page_deficit_within_tolerance_is_not_modified(self):
        from pdforchestrator.tools import ISO_PAGE_SIZES
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / "near-a4.pdf"
            width, height = ISO_PAGE_SIZES["A4"]
            self._source(source, [(width * 0.99, height * 0.99)])
            result = build_registry().get("pdf.page.normalize", "1.0.0")(
                SplitToolTests.PypdfTestContext(root), {"pdf": str(source)}, {"tolerancePercent": 2},
            )
            self.assertEqual(result.outputs["modifiedPages"], [])
            self.assertEqual(result.outputs["skippedPages"][0]["reason"], "withinTolerance")
            self.assertEqual(result.outputs["reason"]["code"], "NO_CHANGES")


class WorkflowTests(unittest.TestCase):
    def test_execution_audit_redacts_secrets_and_describes_block_parameters(self):
        snapshot = _audit_safe({"workflow": {"apiToken": "hidden", "chapter": "QR-7"}})
        self.assertEqual(snapshot["workflow"]["apiToken"], "[REDACTED]")
        self.assertEqual(snapshot["workflow"]["chapter"], "QR-7")
        summary = _execution_summary("node-1", "data.setVariable", "1.0.0", {"name": "chapter", "value": "QR-7"}, {"input": 2}, None)
        self.assertIn('"toolId": "data.setVariable"', summary)
        self.assertIn('"value": "QR-7"', summary)

    def test_topological_order_and_cycle_rejection(self):
        nodes = [{"id": name} for name in "abc"]
        order = topological_order(nodes, [{"source": "a", "target": "b"}, {"source": "b", "target": "c"}])
        self.assertEqual(order, ["a", "b", "c"])
        with self.assertRaises(ToolError): topological_order(nodes, [{"source": "a", "target": "b"}, {"source": "b", "target": "a"}])

    def test_topological_order_preserves_legacy_tie_break_and_v2_is_deterministic(self):
        nodes = [{"id": "z"}, {"id": "a"}]
        self.assertEqual(topological_order(nodes, []), ["z", "a"])
        self.assertEqual(topological_order(nodes, [], deterministic=True), ["a", "z"])

    def test_compiled_control_flow_verifies_nested_transfer_target(self):
        nodes = [
            {"id": "outer", "data": {"toolId": "loop.while"}},
            {"id": "inner", "data": {"toolId": "loop.repeatUntil"}},
            {"id": "break", "data": {"toolId": "flow.break"}},
        ]
        edges = [
            {"source": "outer", "target": "inner", "sourceHandle": "body"},
            {"source": "inner", "target": "break", "sourceHandle": "body"},
        ]
        derived = _derive_control_flow(nodes, edges)
        plan = {"controlFlow": {"loops": derived["loops"], "transfers": derived["transfers"]}}
        checked = _control_flow_for(plan, nodes, edges)
        self.assertEqual(checked["transfersByNode"]["break"]["loopNodeId"], "inner")
        plan["controlFlow"]["transfers"][0]["loopNodeId"] = "outer"
        with self.assertRaisesRegex(ToolError, "non corrisponde"):
            _control_flow_for(plan, nodes, edges)
        plan["controlFlow"]["transfers"] = [None]
        with self.assertRaisesRegex(ToolError, "malformato"):
            _control_flow_for(plan, nodes, edges)

    def test_data_lookup_matches_qr_rows_and_metadata_ranges(self):
        from pdforchestrator.tools import _data_lookup
        context = ToolContext(Path(tempfile.gettempdir()))
        qr = _data_lookup(context, {"items": [{"page": 1, "format": "QR_CODE", "text": "INV-001"}, {"page": 2, "format": "QR_CODE", "text": "OTHER"}]}, {
            "column": "text", "valueType": "string", "operator": "contains", "value": "INV-", "result": "object", "cardinality": "first", "nullBehavior": "skip",
        })
        self.assertTrue(qr.outputs["matched"])
        self.assertEqual(qr.outputs["value"], {"page": 1, "format": "QR_CODE", "text": "INV-001"})
        metadata = _data_lookup(context, {"record": {"title": "invoice", "pageCount": 12, "author": None}}, {
            "column": "pageCount", "valueType": "number", "operator": "range", "min": 10, "max": 20, "result": "object", "cardinality": "all", "nullBehavior": "skip",
        })
        self.assertEqual(metadata.outputs["values"], [{"title": "invoice", "pageCount": 12, "author": None}])
        self.assertEqual(metadata.outputs["count"], 1)

    def test_data_lookup_handles_null_default_and_type_errors(self):
        from pdforchestrator.tools import _data_lookup
        context = ToolContext(Path(tempfile.gettempdir()))
        result = _data_lookup(context, {"items": [{"text": None}]}, {
            "column": "text", "valueType": "null", "operator": "exact", "value": None, "nullBehavior": "match", "result": "column", "defaultValue": "none",
        })
        self.assertTrue(result.outputs["matched"])
        self.assertIsNone(result.outputs["value"])
        fallback = _data_lookup(context, {"items": [{"text": "other"}]}, {
            "column": "text", "valueType": "string", "operator": "exact", "value": "missing", "defaultValue": "fallback",
        })
        self.assertFalse(fallback.outputs["matched"])
        self.assertEqual(fallback.outputs["value"], "fallback")
        self.assertIn("notFound", fallback.outputs)
        with self.assertRaises(ToolError):
            _data_lookup(context, {"items": [{"value": "12"}]}, {"column": "value", "valueType": "number", "operator": "range", "min": 1})

    def test_loop_variables_are_scoped_to_the_loop_and_visible_to_following_steps(self):
        with tempfile.TemporaryDirectory() as temp:
            context = ToolContext(Path(temp))
            graph = {"nodes": [
                {"id": "each", "data": {"toolId": "loop.forEach", "parameters": {"source": {"source": "api", "name": "rows"}, "itemType": "string", "columns": [], "maxIterations": 5}}},
                {"id": "local", "data": {"toolId": "data.setVariable", "parameters": {"name": "current", "scope": "loop", "valueType": "string", "value": {"source": "loop", "name": "item"}}}},
                {"id": "capture", "data": {"toolId": "data.setVariable", "parameters": {"name": "captured", "scope": "workflow", "valueType": "string", "value": {"source": "variable", "scope": "loop", "name": "current"}}}},
            ], "edges": [
                {"id": "body", "source": "each", "target": "local", "sourceHandle": "body", "targetHandle": "run"},
                {"id": "next", "source": "local", "target": "capture", "sourceHandle": "success", "targetHandle": "run"},
            ]}
            variables: dict[str, object] = {}
            steps = []
            WorkflowExecutor(build_registry()).execute(graph, {"rows": ["uno", "due"]}, {}, context, steps.append, lambda *_args: None, _internal=True, _variables=variables)
            self.assertEqual(variables["captured"], "due")
            completed_local_steps = [step for step in steps if step.get("nodeId") == "local" and step.get("status") == "SUCCEEDED"]
            self.assertEqual(len(completed_local_steps), 2)
            self.assertEqual(completed_local_steps[0]["parameters"]["value"], "uno")
            self.assertEqual(completed_local_steps[1]["parameters"]["value"], "due")
            self.assertEqual(completed_local_steps[0]["variablesOut"]["loopScopes"][0]["current"], "uno")
            self.assertEqual(completed_local_steps[1]["variablesOut"]["loopScopes"][0]["current"], "due")
            self.assertIn('"toolId": "data.setVariable"', completed_local_steps[0]["executionString"])
            with self.assertRaises(ToolError):
                _substitute({"source": "variable", "scope": "loop", "name": "current"}, {}, variables, {}, {})

    def test_qr_and_barcode_decoder_libraries(self):
        import cv2
        import numpy as np
        import qrcode
        import zxingcpp
        from barcode import Code128
        from barcode.writer import ImageWriter
        with tempfile.TemporaryDirectory() as temp:
            qr = np.array(qrcode.make("QR-TEST-123").convert("RGB"))
            qr_text, _points, _straight = cv2.QRCodeDetector().detectAndDecode(qr)
            self.assertEqual(qr_text, "QR-TEST-123")
            barcode_path = Code128("5901234123457", writer=ImageWriter()).save(str(Path(temp) / "barcode"))
            from PIL import Image
            decoded = zxingcpp.read_barcodes(Image.open(barcode_path))
            self.assertTrue(any(item.text == "5901234123457" for item in decoded))

    def test_pdf_operations_and_validation(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / "input.pdf"; make_pdf(source)
            context = ToolContext(root, max_pdf_bytes=5_000_000, max_pages=20)
            registry = build_registry()
            detected = registry.get("pdf.detect-page-size", "1.0.0")(context, {"pdf": str(source)}, {})
            self.assertEqual(len(detected.outputs["pages"]), 3)
            extracted = registry.get("pdf.extract-pages", "1.0.0")(context, {"pdf": str(source)}, {"pages": [3, 1]})
            self.assertEqual(len(PdfReader(extracted.outputs["pdf"]).pages), 2)
            deleted = registry.get("pdf.delete-pages", "1.0.0")(context, {"pdf": str(source)}, {"pages": [2]})
            self.assertEqual(len(PdfReader(deleted.outputs["pdf"]).pages), 2)
            reordered = registry.get("pdf.reorder-pages", "1.0.0")(context, {"pdf": str(source)}, {"order": [3, 1, 2]})
            self.assertEqual(len(PdfReader(reordered.outputs["pdf"]).pages), 3)
            split = registry.get("pdf.split", "1.0.0")(context, {"pdf": str(source)}, {"ranges": ["1-2", "3"]})
            self.assertEqual([len(PdfReader(path).pages) for path in split.outputs["pdfs"]], [2, 1])
            rotated = registry.get("pdf.rotate", "1.0.0")(context, {"pdf": str(source)}, {"degrees": 90, "pages": [1]})
            self.assertEqual(PdfReader(rotated.outputs["pdf"]).pages[0].rotation, 90)
            normalized = registry.get("pdf.normalize-pages", "1.0.0")(context, {"pdf": str(source)}, {"pageSize": "A4"})
            self.assertAlmostEqual(float(PdfReader(normalized.outputs["pdf"]).pages[0].mediabox.width), 595.276, places=1)
            metadata = registry.get("pdf.read-metadata", "1.0.0")(context, {"pdf": str(source)}, {})
            self.assertEqual(metadata.outputs["metadata"]["Title"], "Worker test")
            changed = registry.get("pdf.write-metadata", "1.0.0")(context, {"pdf": str(source)}, {"title": "Changed title"})
            self.assertEqual(PdfReader(changed.outputs["pdf"]).metadata.title, "Changed title")
            bookmarks = registry.get("pdf.bookmarks", "1.0.0")(context, {"pdf": str(source)}, {"bookmarks": [{"title": "Section", "page": 2}]})
            self.assertEqual(PdfReader(bookmarks.outputs["pdf"]).outline[0].title, "Section")
            nested = registry.get("pdf.bookmarks", "1.0.0")(context, {"pdf": str(source)}, {"bookmarks": [{"id": "section", "title": "Section", "page": 1}, {"id": "child", "title": "Child", "page": 2, "parent": "section"}]})
            self.assertEqual(PdfReader(nested.outputs["pdf"]).outline[1][0].title, "Child")
            merged = registry.get("pdf.merge", "1.0.0")(context, {"pdfs": [str(source), str(source)]}, {})
            self.assertEqual(len(PdfReader(merged.outputs["pdf"]).pages), 6)

    def test_ordered_pdf_merge_preserves_stable_order_and_page_provenance(self):
        from pdforchestrator.tools import ToolContext, ToolError, _merge_ordered
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); first = root / "first.pdf"; second = root / "second.pdf"; third = root / "third.pdf"
            make_pdf(first, 2); make_pdf(second, 1)
            writer = PdfWriter(); writer.add_blank_page(width=700, height=900)
            with third.open("wb") as stream: writer.write(stream)
            class CheckedContext(ToolContext):
                def pdf(self, path):
                    self.check(); file = Path(path)
                    if not file.is_file() or file.read_bytes()[:5] != b"%PDF-": raise ToolError("INVALID_PDF", "PDF mancante o malformato.")
                    reader = PdfReader(str(file), strict=True)
                    if reader.is_encrypted: raise ToolError("ENCRYPTED_PDF", "PDF protetto da password.")
                    if not reader.pages or len(reader.pages) > self.max_pages: raise ToolError("PAGE_LIMIT", "Limite pagine superato.")
                    return reader
            context = CheckedContext(root, max_pages=20)
            context.source_filenames = {str(path.resolve()): path.name for path in (first, second, third)}
            context.source_file_refs = {str(first.resolve()): "ref-first", str(second.resolve()): "ref-second", str(third.resolve()): "ref-third"}
            result = _merge_ordered(context, {"pdfs": [str(first), str(second), str(third)]}, {"files": [
                {"fileRef": "ref-first", "filename": "first.pdf", "order": 2},
                {"fileRef": "ref-second", "filename": "second.pdf", "order": 1},
                {"fileRef": "ref-third", "filename": "third.pdf", "order": 1},
            ]})
            output = PdfReader(result.outputs["pdf"], strict=True)
            self.assertEqual(len(output.pages), 4)
            self.assertEqual([float(page.mediabox.width) for page in output.pages], [595.0, 700.0, 595.0, 842.0])
            self.assertEqual(result.pages_processed, 4)
            self.assertEqual(result.outputs["totalPages"], 4)
            self.assertEqual(result.outputs["pageMap"], [
                {"destinationPage": 1, "fileRef": "ref-second", "filename": "second.pdf", "sourcePage": 1},
                {"destinationPage": 2, "fileRef": "ref-third", "filename": "third.pdf", "sourcePage": 1},
                {"destinationPage": 3, "fileRef": "ref-first", "filename": "first.pdf", "sourcePage": 1},
                {"destinationPage": 4, "fileRef": "ref-first", "filename": "first.pdf", "sourcePage": 2},
            ])
            self.assertTrue(Path(result.outputs["pdf"]).is_file())
            with self.assertRaisesRegex(ToolError, "filename non corrisponde"):
                _merge_ordered(context, {"pdfs": [str(first), str(second), str(third)]}, {"files": [
                    {"fileRef": "ref-first", "filename": "wrong.pdf", "order": 1},
                    {"fileRef": "ref-second", "filename": "second.pdf", "order": 1},
                    {"fileRef": "ref-third", "filename": "third.pdf", "order": 1},
                ]})

    def test_ordered_pdf_merge_rejects_encrypted_and_malformed_inputs(self):
        from pdforchestrator.tools import ToolContext, ToolError, _merge_ordered
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); encrypted = root / "encrypted.pdf"; writer = PdfWriter(); writer.add_blank_page(width=100, height=100); writer.encrypt("secret")
            with encrypted.open("wb") as stream: writer.write(stream)
            malformed = root / "broken.pdf"; malformed.write_bytes(b"not a PDF")
            class CheckedContext(ToolContext):
                def pdf(self, path):
                    file = Path(path)
                    if not file.is_file() or file.read_bytes()[:5] != b"%PDF-": raise ToolError("INVALID_PDF", "PDF mancante o malformato.")
                    reader = PdfReader(str(file), strict=True)
                    if reader.is_encrypted: raise ToolError("ENCRYPTED_PDF", "PDF protetto da password.")
                    return reader
            for path, ref, code in ((encrypted, "locked", "ENCRYPTED_PDF"), (malformed, "broken", "INVALID_PDF")):
                context = CheckedContext(root); context.source_filenames[str(path.resolve())] = path.name; context.source_file_refs[str(path.resolve())] = ref
                with self.assertRaises(ToolError) as raised:
                    _merge_ordered(context, {"pdfs": [str(path)]}, {"files": [{"fileRef": ref, "filename": path.name, "order": 1}]})
                self.assertEqual(raised.exception.code, code)

    def test_insert_pages_before_after_preserves_rotations_and_page_mapping(self):
        from pdforchestrator.tools import ToolContext, ToolError
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); target = root / "target.pdf"; source = root / "source.pdf"
            make_pdf(target, 3)
            imported = PdfWriter(); imported.add_blank_page(width=420, height=595); imported.add_blank_page(width=595, height=420)
            imported.pages[1].rotate(90)
            with source.open("wb") as stream: imported.write(stream)

            class CheckedContext(ToolContext):
                def pdf(self, path):
                    self.check(); file = Path(path)
                    if not file.is_file() or file.read_bytes()[:5] != b"%PDF-": raise ToolError("INVALID_PDF", "PDF mancante o malformato.")
                    reader = PdfReader(str(file), strict=True)
                    if reader.is_encrypted: raise ToolError("ENCRYPTED_PDF", "PDF protetto da password.")
                    if not 1 <= len(reader.pages) <= self.max_pages: raise ToolError("PAGE_LIMIT", "Limite pagine superato.")
                    return reader

            context = CheckedContext(root, max_pages=10)
            context.source_filenames = {str(path.resolve()): path.name for path in (target, source)}
            context.source_file_refs = {str(target.resolve()): "target-ref", str(source.resolve()): "source-ref"}
            registry = build_registry()
            insert = registry.get("pdf.page.insert", "1.0.0")
            base_inputs = {"pdf": str(target), "sources": [{"path": str(source), "filename": "source.pdf", "fileRef": "source-ref"}]}

            before = insert(context, base_inputs, {"sourceFile": "source-ref", "sourcePages": [2, 1], "targetPage": 2, "position": "before"})
            reader = PdfReader(before.outputs["pdf"], strict=True)
            self.assertEqual(len(reader.pages), 5)
            self.assertEqual([float(page.mediabox.width) for page in reader.pages], [595, 595, 420, 842, 595])
            self.assertEqual(reader.pages[1].rotation, 90)
            self.assertEqual(before.outputs["insertedCount"], 2)
            self.assertEqual(before.outputs["pageMap"], [
                {"destinationPage": 1, "fileRef": "target-ref", "filename": "target.pdf", "sourcePage": 1, "inserted": False},
                {"destinationPage": 2, "fileRef": "source-ref", "filename": "source.pdf", "sourcePage": 2, "inserted": True},
                {"destinationPage": 3, "fileRef": "source-ref", "filename": "source.pdf", "sourcePage": 1, "inserted": True},
                {"destinationPage": 4, "fileRef": "target-ref", "filename": "target.pdf", "sourcePage": 2, "inserted": False},
                {"destinationPage": 5, "fileRef": "target-ref", "filename": "target.pdf", "sourcePage": 3, "inserted": False},
            ])

            after_last = insert(context, base_inputs, {"sourceFile": "source-ref", "sourcePages": [2], "targetPage": 3, "position": "after"})
            last_reader = PdfReader(after_last.outputs["pdf"], strict=True)
            self.assertEqual(float(last_reader.pages[-1].mediabox.width), 595)
            self.assertEqual(last_reader.pages[-1].rotation, 90)
            self.assertEqual(after_last.outputs["pageMap"][-1]["sourcePage"], 2)

            with self.assertRaisesRegex(ToolError, "sourcePages supera"):
                insert(context, base_inputs, {"sourceFile": "source-ref", "sourcePages": [3], "targetPage": 1, "position": "before"})
            with self.assertRaisesRegex(ToolError, "fuori dai limiti"):
                insert(context, base_inputs, {"sourceFile": "source-ref", "sourcePages": [1], "targetPage": 4, "position": "after"})
            limited = CheckedContext(root, max_pages=4)
            limited.source_filenames = context.source_filenames; limited.source_file_refs = context.source_file_refs
            with self.assertRaisesRegex(ToolError, "supererebbe il limite"):
                insert(limited, base_inputs, {"sourceFile": "source-ref", "sourcePages": [1, 2], "targetPage": 1, "position": "before"})

    def test_executor_input_to_output(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / "input.pdf"; make_pdf(source, 1)
            nodes = [
                {"id": "input", "type": "tool", "position": {"x": 0, "y": 0}, "data": {"toolId": "input.pdf", "toolVersion": "1.0.0", "label": "Input PDF", "parameters": {}}},
                {"id": "output", "type": "tool", "position": {"x": 240, "y": 0}, "data": {"toolId": "output.pdf", "toolVersion": "1.0.0", "label": "Output PDF", "parameters": {"filename": "result.pdf"}}},
            ]
            edges = [{"id": "pdf-output", "source": "input", "target": "output", "sourceHandle": "pdf", "targetHandle": "pdf", "data": {"kind": "data"}}]
            graph = {"nodes": nodes, "edges": edges}
            steps = []; result = WorkflowExecutor(build_registry()).execute(graph, {"documento": "file-id"}, {"file-id": str(source)}, ToolContext(root), steps.append, lambda *_: None)
            self.assertEqual(result["files"][0]["filename"], "result.pdf")
            self.assertEqual(steps[-1]["status"], "SUCCEEDED")

            compiled_blocks = [
                {"nodeId": "input", "type": "input.pdf", "version": "1.0.0", "handlerId": "input.pdf", "worker": "orchestrator", "timeoutSeconds": 30, "resourceClass": "small", "inputs": [], "outputs": [{"id": "pdf", "type": "document", "multiple": False}], "parameters": {"parameter": "documento"}},
                {"nodeId": "output", "type": "output.pdf", "version": "1.0.0", "handlerId": "output.pdf", "worker": "orchestrator", "timeoutSeconds": 30, "resourceClass": "small", "inputs": [{"id": "pdf", "type": "document", "required": True, "multiple": False}], "outputs": [{"id": "pdf", "type": "document", "multiple": False}], "parameters": {"filename": "result.pdf"}},
            ]
            handlers = [{key: item[key] for key in ("type", "version", "handlerId", "worker", "timeoutSeconds", "resourceClass")} for item in compiled_blocks]
            canonical_graph = {"nodes": [{key: node[key] for key in ("id", "type", "position", "data")} for node in sorted(nodes, key=lambda item: item["id"])], "edges": edges}
            graph_hash = hashlib.sha256(_stable_json(canonical_graph).encode("utf-8")).hexdigest()
            compiled_plan = {
                "formatVersion": 2, "compilerVersion": "2.0.0", "graphHash": graph_hash,
                "order": ["input", "output"], "blocks": compiled_blocks, "edges": edges,
                "controlFlow": {"loops": [], "transfers": []},
                "manifest": {"apiParameters": [], "variables": [], "handlers": handlers},
            }
            compiled_plan["planHash"] = hashlib.sha256(_stable_json(compiled_plan).encode("utf-8")).hexdigest()
            version2 = {**graph, "compiledPlan": compiled_plan}
            result_v2 = WorkflowExecutor(build_registry()).execute(version2, {"documento": "file-id"}, {"file-id": str(source)}, ToolContext(root), lambda _step: None, lambda *_: None)
            self.assertEqual(result_v2["files"][0]["filename"], "result.pdf")
            bad_hash = {**compiled_plan, "planHash": "0" * 64}
            with self.assertRaisesRegex(ToolError, "Hash del piano"):
                WorkflowExecutor(build_registry()).execute({**graph, "compiledPlan": bad_hash}, {"documento": "file-id"}, {"file-id": str(source)}, ToolContext(root), lambda _step: None, lambda *_: None)
            corrupted_plan = {**compiled_plan, "edges": []}
            corrupted_plan["planHash"] = hashlib.sha256(_stable_json({key: value for key, value in corrupted_plan.items() if key != "planHash"}).encode("utf-8")).hexdigest()
            corrupted = {**graph, "compiledPlan": corrupted_plan}
            with self.assertRaisesRegex(ToolError, "numero di edge"):
                WorkflowExecutor(build_registry()).execute(corrupted, {"documento": "file-id"}, {"file-id": str(source)}, ToolContext(root), lambda _step: None, lambda *_: None)

    def test_context_variable_binding_and_missing_default(self):
        binding = {"source": "variable", "name": "filename"}
        self.assertEqual(_substitute(binding, {}, variables={"filename": "draft.pdf"}), "draft.pdf")
        with self.assertRaisesRegex(ToolError, "Variabile di contesto non disponibile"):
            _substitute(binding, {}, variables={})
        self.assertEqual(_substitute({"source": "node", "nodeId": "n", "port": "codes", "path": ["0", "text"]}, {}, nodes={"n": {"codes": [{"text": "QR-42"}]}}), "QR-42")
        self.assertEqual(_substitute({"source": "api", "name": "document", "path": ["metadata", "Title"]}, {"document": {"metadata": {"Title": "Invoice"}}}), "Invoice")
        with self.assertRaisesRegex(ToolError, "Proprietà del binding non disponibile"):
            _substitute({"source": "api", "name": "document", "path": ["metadata", "Missing"]}, {"document": {"metadata": {}}})

    def test_condition_selects_only_matching_branch(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / "input.pdf"; make_pdf(source, 3); steps = []
            nodes = [
                {"id": "input", "data": {"toolId": "input.pdf", "toolVersion": "1.0.0", "parameters": {}}},
                {"id": "condition", "data": {"toolId": "flow.condition", "toolVersion": "1.0.0", "parameters": {"conditionType": "pageCount", "operator": "greaterThan", "value": 4}}},
                {"id": "true", "data": {"toolId": "output.pdf", "toolVersion": "1.0.0", "parameters": {"filename": "true.pdf"}}},
                {"id": "false", "data": {"toolId": "output.pdf", "toolVersion": "1.0.0", "parameters": {"filename": "false.pdf"}}},
            ]
            edges = [
                {"source": "input", "target": "condition", "sourceHandle": "pdf", "targetHandle": "value"},
                {"source": "input", "target": "true", "sourceHandle": "pdf", "targetHandle": "pdf"},
                {"source": "input", "target": "false", "sourceHandle": "pdf", "targetHandle": "pdf"},
                {"source": "condition", "target": "true", "sourceHandle": "true", "targetHandle": "run", "data": {"kind": "control"}},
                {"source": "condition", "target": "false", "sourceHandle": "false", "targetHandle": "run", "data": {"kind": "control"}},
            ]
            result = WorkflowExecutor(build_registry()).execute({"nodes": nodes, "edges": edges}, {}, {"file": str(source)}, ToolContext(root), steps.append, lambda *_: None)
            self.assertEqual([item["filename"] for item in result["files"]], ["false.pdf"])
            self.assertTrue(any(item["nodeId"] == "true" and item["status"] == "SKIPPED" for item in steps))

    def test_logic_if_operators_case_and_null_rules(self):
        logic_if = build_registry().get("logic.if", "1.0.0")
        base = {"leftType": "string", "rightType": "string", "left": "Report.PDF", "right": "report", "caseSensitive": False, "nullBehavior": "equalOnly"}
        self.assertTrue(logic_if(ToolContext(Path(".")), {}, {**base, "operator": "startsWith"}).outputs["matched"])
        self.assertFalse(logic_if(ToolContext(Path(".")), {}, {**base, "operator": "startsWith", "caseSensitive": True}).outputs["matched"])
        self.assertTrue(logic_if(ToolContext(Path(".")), {}, {**base, "operator": "notContains"}).outputs["matched"] is False)
        self.assertTrue(logic_if(ToolContext(Path(".")), {}, {**base, "left": None, "right": None, "operator": "eq"}).outputs["matched"])
        self.assertTrue(logic_if(ToolContext(Path(".")), {}, {**base, "left": None, "operator": "isNull"}).outputs["matched"])
        self.assertTrue(logic_if(ToolContext(Path(".")), {}, {**base, "left": None, "right": "", "operator": "eq", "nullBehavior": "treatAsEmpty"}).outputs["matched"])
        with self.assertRaisesRegex(ToolError, "deve essere number"):
            logic_if(ToolContext(Path(".")), {}, {**base, "leftType": "number", "rightType": "number", "left": 3, "right": "3", "operator": "eq"})
        with self.assertRaisesRegex(ToolError, "contiene null"):
            logic_if(ToolContext(Path(".")), {}, {**base, "left": None, "operator": "startsWith", "nullBehavior": "reject"})

        cases = [
            ({"leftType": "string", "rightType": "string", "left": "Alpha", "right": "alpha", "operator": "eq"}, True),
            ({"leftType": "string", "rightType": "string", "left": "Alpha", "right": "beta", "operator": "neq"}, True),
            ({"leftType": "number", "rightType": "number", "left": 4, "right": 3, "operator": "gt"}, True),
            ({"leftType": "number", "rightType": "number", "left": 3, "right": 3, "operator": "gte"}, True),
            ({"leftType": "number", "rightType": "number", "left": 2, "right": 3, "operator": "lt"}, True),
            ({"leftType": "number", "rightType": "number", "left": 3, "right": 3, "operator": "lte"}, True),
            ({"leftType": "string", "rightType": "string", "left": "Alpha", "right": "LPH", "operator": "contains"}, True),
            ({"leftType": "string", "rightType": "string", "left": "Alpha", "right": "beta", "operator": "notContains"}, True),
            ({"leftType": "string", "rightType": "string", "left": "Alpha", "right": "al", "operator": "startsWith"}, True),
            ({"leftType": "string", "rightType": "string", "left": "Alpha", "right": "HA", "operator": "endsWith"}, True),
            ({"leftType": "string", "rightType": "array", "left": "b", "right": ["a", "B"], "operator": "in"}, True),
            ({"leftType": "number", "rightType": "array", "left": 8, "right": [1, 2], "operator": "notIn"}, True),
            ({"leftType": "array", "rightType": "string", "left": [], "operator": "isEmpty"}, True),
            ({"leftType": "object", "rightType": "string", "left": None, "operator": "isNull"}, True),
        ]
        for params, expected in cases:
            complete = {"caseSensitive": False, "nullBehavior": "equalOnly", **params}
            with self.subTest(operator=params["operator"]):
                self.assertEqual(logic_if(ToolContext(Path(".")), {}, complete).outputs["matched"], expected)

    def test_logic_if_routes_only_the_true_branch(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / "input.pdf"; make_pdf(source, 1); steps = []
            class RoutingContext(ToolContext):
                def pdf(self, _path): return type("Reader", (), {"pages": [object()]})()
            nodes = [
                {"id": "input", "data": {"toolId": "input.pdf", "toolVersion": "1.0.0", "parameters": {}}},
                {"id": "condition", "data": {"toolId": "logic.if", "toolVersion": "1.0.0", "parameters": {"leftType": "number", "rightType": "number", "left": 4, "right": 3, "operator": "gt"}}},
                {"id": "true", "data": {"toolId": "output.pdf", "toolVersion": "1.0.0", "parameters": {"filename": "true.pdf"}}},
                {"id": "false", "data": {"toolId": "output.pdf", "toolVersion": "1.0.0", "parameters": {"filename": "false.pdf"}}},
            ]
            edges = [
                {"source": "input", "target": "true", "sourceHandle": "pdf", "targetHandle": "pdf"},
                {"source": "input", "target": "false", "sourceHandle": "pdf", "targetHandle": "pdf"},
                {"source": "condition", "target": "true", "sourceHandle": "true", "targetHandle": "run"},
                {"source": "condition", "target": "false", "sourceHandle": "false", "targetHandle": "run"},
            ]
            result = WorkflowExecutor(build_registry()).execute({"nodes": nodes, "edges": edges}, {}, {"file": str(source)}, RoutingContext(root), steps.append, lambda *_: None)
            self.assertEqual([item["filename"] for item in result["files"]], ["true.pdf"])
            self.assertTrue(any(item["nodeId"] == "false" and item["status"] == "SKIPPED" for item in steps))

    def test_condition_group_short_circuit_nesting_and_limits(self):
        evaluate = build_registry().get("logic.conditionGroup", "1.0.0")
        context = ToolContext(Path("."))
        compare = lambda left, right, op="eq": {"kind": "comparison", "leftType": "number", "rightType": "number", "left": left, "right": right, "operator": op}
        unavailable = {"kind": "comparison", "leftType": "string", "rightType": "string", "left": {"source": "api", "name": "notProvided"}, "right": "x", "operator": "eq"}
        ast = {"kind": "group", "operator": "OR", "conditions": [compare(3, 2, "gt"), unavailable]}
        result = evaluate(context, {}, {"condition": ast})
        self.assertTrue(result.outputs["boolean"])
        self.assertIn("true", result.outputs); self.assertNotIn("false", result.outputs)
        nested = {"kind": "not", "condition": {"kind": "group", "operator": "AND", "conditions": [compare(1, 2, "gt"), unavailable]}}
        result = evaluate(context, {}, {"condition": nested})
        self.assertTrue(result.outputs["boolean"])
        self.assertIn("true", result.outputs)
        context.binding_resolver = lambda binding: _substitute(binding, {"document": {"metadata": {"Title": "Invoice"}}})
        metadata = {"kind": "comparison", "leftType": "string", "rightType": "string", "left": {"source": "api", "name": "document", "path": ["metadata", "Title"]}, "right": "Invoice", "operator": "eq"}
        self.assertTrue(evaluate(context, {}, {"condition": metadata}).outputs["boolean"])
        too_many = {"kind": "group", "operator": "AND", "conditions": [{"kind": "group", "operator": "OR", "conditions": [compare(1, 2) for _ in range(11)]} for _ in range(3)]}
        with self.assertRaisesRegex(ToolError, "limite di 32 confronti"):
            evaluate(context, {}, {"condition": too_many})
        invalid_unreached = {"kind": "group", "operator": "OR", "conditions": [compare(3, 2, "gt"), {"kind": "unknown"}]}
        with self.assertRaisesRegex(ToolError, "tipo nodo non supportato"):
            evaluate(context, {}, {"condition": invalid_unreached})
        with self.assertRaisesRegex(ToolError, "profondità massima 8"):
            deeply_nested = compare(1, 2)
            for _ in range(8): deeply_nested = {"kind": "not", "condition": deeply_nested}
            evaluate(context, {}, {"condition": deeply_nested})

    def test_condition_group_routes_true_and_false_from_api_binding(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / "input.pdf"; make_pdf(source, 1); steps = []
            class RoutingContext(ToolContext):
                def pdf(self, _path): return type("Reader", (), {"pages": [object()]})()
            condition = {"kind": "group", "operator": "AND", "conditions": [{
                "kind": "comparison", "leftType": "number", "rightType": "number",
                "left": {"source": "api", "name": "pageCount"}, "right": 2, "operator": "gt",
            }]}
            nodes = [
                {"id": "input", "data": {"toolId": "input.pdf", "toolVersion": "1.0.0", "parameters": {}}},
                {"id": "condition", "data": {"toolId": "logic.conditionGroup", "toolVersion": "1.0.0", "parameters": {"condition": condition}}},
                {"id": "true", "data": {"toolId": "output.pdf", "toolVersion": "1.0.0", "parameters": {"filename": "true.pdf"}}},
                {"id": "false", "data": {"toolId": "output.pdf", "toolVersion": "1.0.0", "parameters": {"filename": "false.pdf"}}},
            ]
            edges = [
                {"source": "input", "target": "true", "sourceHandle": "pdf", "targetHandle": "pdf"},
                {"source": "input", "target": "false", "sourceHandle": "pdf", "targetHandle": "pdf"},
                {"source": "condition", "target": "true", "sourceHandle": "true", "targetHandle": "run"},
                {"source": "condition", "target": "false", "sourceHandle": "false", "targetHandle": "run"},
            ]
            result = WorkflowExecutor(build_registry()).execute({"nodes": nodes, "edges": edges}, {"pageCount": 3}, {"file": str(source)}, RoutingContext(root), steps.append, lambda *_: None)
            self.assertEqual([item["filename"] for item in result["files"]], ["true.pdf"])
            self.assertTrue(any(item["nodeId"] == "false" and item["status"] == "SKIPPED" for item in steps))

    def test_each_page_defers_deletions_against_initial_snapshot(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / "input.pdf"; make_pdf(source, 3); steps = []
            class TestContext(ToolContext):
                def pdf(self, path):
                    self.check()
                    return PdfReader(path, strict=True)
            nodes = [
                {"id": "input", "data": {"toolId": "input.pdf", "toolVersion": "1.0.0", "parameters": {}}},
                {"id": "loop", "data": {"toolId": "loop.eachPage", "toolVersion": "1.0.0", "parameters": {"start": 1, "step": 1, "maxIterations": 3}}},
                {"id": "condition", "data": {"toolId": "logic.conditionGroup", "toolVersion": "1.0.0", "parameters": {"condition": {"kind": "group", "operator": "OR", "conditions": [
                    {"kind": "comparison", "leftType": "number", "rightType": "number", "left": {"source": "loop", "name": "currentPage"}, "right": 1, "operator": "eq"},
                    {"kind": "comparison", "leftType": "number", "rightType": "number", "left": {"source": "loop", "name": "currentPage"}, "right": 3, "operator": "eq"},
                ]}}}},
                {"id": "delete", "data": {"toolId": "pdf.delete-pages", "toolVersion": "1.1.0", "parameters": {"deleteCurrentPage": True}}},
                {"id": "output", "data": {"toolId": "output.pdf", "toolVersion": "1.0.0", "parameters": {"filename": "retained.pdf"}}},
            ]
            edges = [
                {"source": "input", "target": "loop", "sourceHandle": "pdf", "targetHandle": "document"},
                {"source": "loop", "target": "condition", "sourceHandle": "body", "targetHandle": "run"},
                {"source": "condition", "target": "delete", "sourceHandle": "true", "targetHandle": "run"},
                {"source": "loop", "target": "delete", "sourceHandle": "document", "targetHandle": "pdf"},
                {"source": "loop", "target": "output", "sourceHandle": "document", "targetHandle": "pdf"},
                {"source": "loop", "target": "output", "sourceHandle": "after", "targetHandle": "run"},
            ]
            result = WorkflowExecutor(build_registry()).execute({"nodes": nodes, "edges": edges}, {}, {"file": str(source)}, TestContext(root), steps.append, lambda *_: None)
            output_path = result["files"][0]["path"]
            output_pdf = PdfReader(output_path)
            self.assertEqual(len(output_pdf.pages), 1)
            self.assertEqual(float(output_pdf.pages[0].mediabox.width), 842)
            self.assertEqual(output_pdf.metadata.title, "Worker test")
            loop_updates = [step["output"] for step in steps if step.get("nodeId") == "loop" and step.get("status") == "RUNNING"]
            self.assertEqual([item["currentPage"] for item in loop_updates], [1, 2, 3])
            self.assertEqual(len({item["pageId"] for item in loop_updates}), 3)

    def test_each_page_defers_bookmark_until_after_deleting_page_and_maps_next_retained_page(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / "input.pdf"; make_pdf(source, 3)
            class TestContext(ToolContext):
                def pdf(self, path):
                    self.check()
                    return PdfReader(path, strict=True)
            nodes = [
                {"id": "input", "data": {"toolId": "input.pdf", "toolVersion": "1.0.0", "parameters": {}}},
                {"id": "loop", "data": {"toolId": "loop.eachPage", "toolVersion": "1.0.0", "parameters": {"maxIterations": 3}}},
                {"id": "if", "data": {"toolId": "logic.if", "toolVersion": "1.0.0", "parameters": {
                    "leftType": "number", "rightType": "number", "left": {"source": "loop", "name": "currentPage"}, "right": 1,
                    "operator": "eq", "caseSensitive": False, "nullBehavior": "equalOnly",
                }}},
                {"id": "delete", "data": {"toolId": "pdf.page.delete", "toolVersion": "1.0.0", "parameters": {"pageId": {"source": "loop", "name": "pageId"}}}},
                {"id": "bookmark", "data": {"toolId": "pdf.bookmark.add", "toolVersion": "1.0.0", "parameters": {"page": 2, "description": "Documento — café"}}},
                {"id": "output", "data": {"toolId": "output.pdf", "toolVersion": "1.0.0", "parameters": {"filename": "retained.pdf"}}},
            ]
            edges = [
                {"source": "input", "target": "loop", "sourceHandle": "pdf", "targetHandle": "document"},
                {"source": "loop", "target": "if", "sourceHandle": "body", "targetHandle": "run", "data": {"kind": "control"}},
                {"source": "if", "target": "delete", "sourceHandle": "true", "targetHandle": "run", "data": {"kind": "control"}},
                {"source": "loop", "target": "delete", "sourceHandle": "document", "targetHandle": "pdf"},
                {"source": "delete", "target": "bookmark", "sourceHandle": "pdf", "targetHandle": "pdf"},
                {"source": "delete", "target": "bookmark", "sourceHandle": "success", "targetHandle": "run", "data": {"kind": "control"}},
                {"source": "loop", "target": "output", "sourceHandle": "document", "targetHandle": "pdf"},
                {"source": "loop", "target": "output", "sourceHandle": "after", "targetHandle": "run", "data": {"kind": "control"}},
            ]
            result = WorkflowExecutor(build_registry()).execute({"nodes": nodes, "edges": edges}, {}, {"file": str(source)}, TestContext(root), lambda *_: None, lambda *_: None)
            output_pdf = PdfReader(result["files"][0]["path"])
            self.assertEqual(len(output_pdf.pages), 2)
            self.assertEqual([item.title for item in output_pdf.outline], ["Documento — café"])
            self.assertEqual(output_pdf.get_destination_page_number(output_pdf.outline[0]), 0)

    def test_each_page_enforces_iteration_limit_and_cancellation(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / "input.pdf"; make_pdf(source, 3)
            class TestContext(ToolContext):
                def pdf(self, path): return PdfReader(path, strict=True)
            nodes = [
                {"id": "input", "data": {"toolId": "input.pdf", "toolVersion": "1.0.0", "parameters": {}}},
                {"id": "loop", "data": {"toolId": "loop.eachPage", "toolVersion": "1.0.0", "parameters": {"maxIterations": 2}}},
                {"id": "noop", "data": {"toolId": "pdf.read-metadata", "toolVersion": "1.0.0", "parameters": {}}},
                {"id": "output", "data": {"toolId": "output.pdf", "toolVersion": "1.0.0", "parameters": {}}},
            ]
            edges = [
                {"source": "input", "target": "loop", "sourceHandle": "pdf", "targetHandle": "document"},
                {"source": "loop", "target": "noop", "sourceHandle": "body", "targetHandle": "run", "data": {"kind": "control"}},
                {"source": "loop", "target": "noop", "sourceHandle": "document", "targetHandle": "pdf"},
                {"source": "loop", "target": "output", "sourceHandle": "document", "targetHandle": "pdf"},
                {"source": "loop", "target": "output", "sourceHandle": "after", "targetHandle": "run", "data": {"kind": "control"}},
            ]
            context = TestContext(root)
            with self.assertRaisesRegex(ToolError, "oltre maxIterations"):
                WorkflowExecutor(build_registry()).execute({"nodes": nodes, "edges": edges}, {}, {"file": str(source)}, context, lambda *_: None, lambda *_: None)
            cancelled = TestContext(root, cancelled=lambda: True)
            with self.assertRaisesRegex(ToolError, "annullata"):
                WorkflowExecutor(build_registry()).execute({"nodes": nodes, "edges": edges}, {}, {"file": str(source)}, cancelled, lambda *_: None, lambda *_: None)

    def test_for_each_processes_pdf_list_and_collects_qr_read_all_results(self):
        import zxingcpp
        from PIL import Image
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            files = {"file-a": root / "alpha.pdf", "file-b": root / "beta.pdf"}
            for path in files.values(): make_pdf(path, 1)
            qr_images = {}
            for file_ref, value in (("file-a", "QR-ALPHA"), ("file-b", "QR-BETA")):
                image = Image.fromarray(zxingcpp.create_barcode(value, zxingcpp.BarcodeFormat.QRCode).to_image(256)).convert("RGB")
                image_path = root / f"{file_ref}.png"; image.save(image_path); qr_images[file_ref] = image_path
            source_filenames = {str(path.resolve()): path.name for path in files.values()}
            source_refs = {str(path.resolve()): file_ref for file_ref, path in files.items()}
            steps = []
            graph = {
                "nodes": [
                    {"id": "files", "data": {"toolId": "input.pdf-list", "toolVersion": "1.0.0", "parameters": {"parameter": "documents"}}},
                    {"id": "each", "data": {"toolId": "loop.forEach", "toolVersion": "1.2.0", "parameters": {
                        "itemType": "document", "columns": [], "maxIterations": 10,
                    }}},
                    {"id": "qr", "data": {"toolId": "pdf.qr.readAll", "toolVersion": "1.0.0", "parameters": {"startPage": 1, "dpi": 200, "concurrency": 1}}},
                    {"id": "metadata", "data": {"toolId": "pdf.write-metadata", "toolVersion": "1.0.0", "parameters": {
                        "author": {"source": "api", "name": "author"}, "title": {"source": "api", "name": "title"}, "subject": {"source": "api", "name": "subject"},
                    }}},
                    {"id": "output", "data": {"toolId": "output.pdf", "toolVersion": "1.1.0", "parameters": {}}},
                ],
                "edges": [
                    {"source": "files", "target": "each", "sourceHandle": "success", "targetHandle": "run", "data": {"kind": "control"}},
                    {"source": "files", "target": "each", "sourceHandle": "pdfs", "targetHandle": "pdfs"},
                    {"source": "each", "target": "qr", "sourceHandle": "document", "targetHandle": "pdf"},
                    {"source": "each", "target": "qr", "sourceHandle": "body", "targetHandle": "run", "data": {"kind": "control"}},
                    {"source": "qr", "target": "metadata", "sourceHandle": "success", "targetHandle": "run", "data": {"kind": "control"}},
                    {"source": "each", "target": "metadata", "sourceHandle": "document", "targetHandle": "pdf"},
                    {"source": "each", "target": "output", "sourceHandle": "documents", "targetHandle": "documents"},
                    {"source": "each", "target": "output", "sourceHandle": "after", "targetHandle": "run", "data": {"kind": "control"}},
                ],
            }
            context = ToolContext(root)
            context.source_filenames = source_filenames
            context.source_file_refs = source_refs

            def render(_context, pdf, _page, _prefix, dpi=None):
                self.assertEqual(dpi, 200)
                file_ref = source_refs[str(Path(pdf).resolve())]
                return qr_images[file_ref]

            with patch("pdforchestrator.tools._render_page", side_effect=render):
                result = WorkflowExecutor(build_registry()).execute(graph, {"documents": ["file-a", "file-b"], "author": "Test Author", "title": "Batch Title", "subject": "Per document"}, {key: str(path) for key, path in files.items()}, context, steps.append, lambda *_: None)
            loop_completion = next(step for step in reversed(steps) if step.get("nodeId") == "each" and step.get("status") == "SUCCEEDED")
            results = loop_completion["output"]["results"]
            self.assertEqual([row["item"]["fileRef"] for row in results], ["file-a", "file-b"])
            self.assertEqual([row["outputs"]["qr"]["codes"][0]["value"] for row in results], ["QR-ALPHA", "QR-BETA"])
            self.assertEqual([item["filename"] for item in result["files"]], ["alpha.pdf", "beta.pdf"])
            self.assertEqual([PdfReader(item["path"]).metadata.author for item in result["files"]], ["Test Author", "Test Author"])
            self.assertEqual([PdfReader(item["path"]).metadata.title for item in result["files"]], ["Batch Title", "Batch Title"])

    def test_for_each_consumes_real_qr_tool_rows_with_typed_filter_and_scope(self):
        import qrcode
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / "qr-input.pdf"; make_pdf(source, 1)
            qr_image = root / "qr.png"; qrcode.make("QR:invoice").save(qr_image)
            steps = []
            nodes = [
                {"id": "input", "data": {"toolId": "input.pdf", "toolVersion": "1.0.0", "parameters": {}}},
                {"id": "qr", "data": {"toolId": "pdf.qr.readAll", "toolVersion": "1.0.0", "parameters": {}}},
                {"id": "each", "data": {"toolId": "loop.forEach", "toolVersion": "1.0.0", "parameters": {
                    "source": {"source": "node", "nodeId": "qr", "port": "codes"}, "itemType": "object",
                    "columns": [{"name": "page", "type": "number"}, {"name": "format", "type": "string"}, {"name": "value", "type": "string"}],
                    "filter": {"column": "value", "operator": "eq", "value": "QR:invoice"}, "maxIterations": 5,
                }}},
                {"id": "metadata", "data": {"toolId": "pdf.write-metadata", "toolVersion": "1.0.0", "parameters": {"title": {"source": "loop", "name": "item", "path": ["value"]}}}},
                {"id": "output", "data": {"toolId": "output.pdf", "toolVersion": "1.0.0", "parameters": {"filename": "qr-result.pdf"}}},
            ]
            edges = [
                {"source": "input", "target": "qr", "sourceHandle": "pdf", "targetHandle": "pdf"},
                {"source": "qr", "target": "each", "sourceHandle": "success", "targetHandle": "run", "data": {"kind": "control"}},
                {"source": "input", "target": "metadata", "sourceHandle": "pdf", "targetHandle": "pdf"},
                {"source": "each", "target": "metadata", "sourceHandle": "body", "targetHandle": "run", "data": {"kind": "control"}},
                {"source": "metadata", "target": "output", "sourceHandle": "pdf", "targetHandle": "pdf"},
                {"source": "each", "target": "output", "sourceHandle": "after", "targetHandle": "run", "data": {"kind": "control"}},
            ]
            context = ToolContext(root)
            with patch("pdforchestrator.tools._render_page", return_value=qr_image):
                result = WorkflowExecutor(build_registry()).execute({"nodes": nodes, "edges": edges}, {}, {"file": str(source)}, context, steps.append, lambda *_: None)
            self.assertEqual(PdfReader(result["files"][0]["path"]).metadata.title, "QR:invoice")
            loop_runs = [step for step in steps if step.get("nodeId") == "each" and step.get("status") == "RUNNING"]
            self.assertEqual(len(loop_runs), 1)
            self.assertEqual(loop_runs[0]["output"]["index"], 0)

    def test_for_each_filters_api_table_and_keeps_original_row_indexes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / "input.pdf"; make_pdf(source, 1); steps = []
            nodes = [
                {"id": "input", "data": {"toolId": "input.pdf", "toolVersion": "1.0.0", "parameters": {}}},
                {"id": "each", "data": {"toolId": "loop.forEach", "toolVersion": "1.0.0", "parameters": {
                    "source": {"source": "api", "name": "rows"}, "itemType": "object",
                    "columns": [{"name": "title", "type": "string"}, {"name": "enabled", "type": "boolean"}],
                    "filter": {"column": "enabled", "operator": "eq", "value": True}, "maxIterations": 2,
                }}},
                {"id": "metadata", "data": {"toolId": "pdf.write-metadata", "toolVersion": "1.0.0", "parameters": {"title": {"source": "loop", "name": "item", "path": ["title"]}}}},
                {"id": "output", "data": {"toolId": "output.pdf", "toolVersion": "1.0.0", "parameters": {}}},
            ]
            edges = [
                {"source": "input", "target": "metadata", "sourceHandle": "pdf", "targetHandle": "pdf"},
                {"source": "each", "target": "metadata", "sourceHandle": "body", "targetHandle": "run", "data": {"kind": "control"}},
                {"source": "metadata", "target": "output", "sourceHandle": "pdf", "targetHandle": "pdf"},
                {"source": "each", "target": "output", "sourceHandle": "after", "targetHandle": "run", "data": {"kind": "control"}},
            ]
            api_rows = {"rows": [
                {"title": "first", "enabled": True}, {"title": "skip", "enabled": False}, {"title": "third", "enabled": True},
            ]}
            result = WorkflowExecutor(build_registry()).execute({"nodes": nodes, "edges": edges}, api_rows, {"file": str(source)}, ToolContext(root), steps.append, lambda *_: None)
            self.assertEqual(PdfReader(result["files"][0]["path"]).metadata.title, "third")
            loop_runs = [step for step in steps if step.get("nodeId") == "each" and step.get("status") == "RUNNING"]
            self.assertEqual([step["output"]["index"] for step in loop_runs], [0, 2])
            self.assertEqual([step["output"]["iteration"] for step in loop_runs], [1, 2])
            empty_steps = []
            empty_edges = [edge for edge in edges if not (edge.get("source") == "metadata" and edge.get("target") == "output")]
            empty_edges.append({"source": "input", "target": "output", "sourceHandle": "pdf", "targetHandle": "pdf"})
            empty_result = WorkflowExecutor(build_registry()).execute({"nodes": nodes, "edges": empty_edges}, {"rows": []}, {"file": str(source)}, ToolContext(root), empty_steps.append, lambda *_: None)
            self.assertEqual(len(PdfReader(empty_result["files"][0]["path"]).pages), 1)
            self.assertFalse(any(step.get("nodeId") == "metadata" for step in empty_steps))
            with self.assertRaisesRegex(ToolError, "limite totale"):
                WorkflowExecutor(build_registry()).execute({"nodes": nodes, "edges": edges}, api_rows, {"file": str(source)}, ToolContext(root), lambda *_: None, lambda *_: None, _iteration_budget=[1])

    def test_for_each_rejects_wrong_row_types_and_nesting_limit(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / "input.pdf"; make_pdf(source, 1)
            graph = {"nodes": [
                {"id": "input", "data": {"toolId": "input.pdf", "toolVersion": "1.0.0", "parameters": {}}},
                {"id": "each", "data": {"toolId": "loop.forEach", "toolVersion": "1.0.0", "parameters": {"source": {"source": "api", "name": "rows"}, "itemType": "number", "maxIterations": 1}}},
                {"id": "noop", "data": {"toolId": "pdf.read-metadata", "toolVersion": "1.0.0", "parameters": {}}},
                {"id": "output", "data": {"toolId": "output.pdf", "toolVersion": "1.0.0", "parameters": {}}},
            ], "edges": [
                {"source": "input", "target": "noop", "sourceHandle": "pdf", "targetHandle": "pdf"},
                {"source": "each", "target": "noop", "sourceHandle": "body", "targetHandle": "run", "data": {"kind": "control"}},
                {"source": "noop", "target": "output", "sourceHandle": "metadata", "targetHandle": "pdf"},
                {"source": "each", "target": "output", "sourceHandle": "after", "targetHandle": "run", "data": {"kind": "control"}},
            ]}
            with self.assertRaisesRegex(ToolError, "item di tipo number"):
                WorkflowExecutor(build_registry()).execute(graph, {"rows": ["wrong"]}, {"file": str(source)}, ToolContext(root), lambda *_: None, lambda *_: None)
            with self.assertRaisesRegex(ToolError, "maxIterations"):
                WorkflowExecutor(build_registry()).execute(graph, {"rows": [1, 2]}, {"file": str(source)}, ToolContext(root), lambda *_: None, lambda *_: None)

    def test_for_each_enforces_maximum_loop_nesting(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / "input.pdf"; make_pdf(source, 1)
            nodes = [{"id": "input", "data": {"toolId": "input.pdf", "toolVersion": "1.0.0", "parameters": {}}}]
            edges = []
            for index in range(5):
                nodes.append({"id": f"loop-{index}", "data": {"toolId": "loop.forEach", "toolVersion": "1.0.0", "parameters": {
                    "source": {"source": "constant", "value": [index]}, "itemType": "number", "maxIterations": 1,
                }}})
            nodes.append({"id": "leaf", "data": {"toolId": "logic.if", "toolVersion": "1.0.0", "parameters": {
                "leftType": "number", "rightType": "number", "left": 1, "right": 1, "operator": "eq",
            }}})
            nodes.append({"id": "output", "data": {"toolId": "output.pdf", "toolVersion": "1.0.0", "parameters": {}}})
            for index in range(4): edges.append({"source": f"loop-{index}", "target": f"loop-{index + 1}", "sourceHandle": "body", "targetHandle": "run", "data": {"kind": "control"}})
            edges.extend([
                {"source": "loop-4", "target": "leaf", "sourceHandle": "body", "targetHandle": "run", "data": {"kind": "control"}},
                {"source": "input", "target": "output", "sourceHandle": "pdf", "targetHandle": "pdf"},
                {"source": "loop-0", "target": "output", "sourceHandle": "after", "targetHandle": "run", "data": {"kind": "control"}},
            ])
            with self.assertRaisesRegex(ToolError, r"profondità massima \(4\)"):
                WorkflowExecutor(build_registry()).execute({"nodes": nodes, "edges": edges}, {}, {"file": str(source)}, ToolContext(root), lambda *_: None, lambda *_: None)

    def test_while_checks_before_body_and_repeat_until_checks_after_body(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / "input.pdf"; make_pdf(source, 1)
            class TestContext(ToolContext):
                def pdf(self, _path): return type("Reader", (), {"pages": [object()]})()
            def graph(loop_type, operator, bound, limit=5):
                return {"nodes": [
                    {"id": "input", "data": {"toolId": "input.pdf", "toolVersion": "1.0.0", "parameters": {}}},
                    {"id": "loop", "data": {"toolId": loop_type, "toolVersion": "1.0.0", "parameters": {"maxIterations": limit, "timeoutSeconds": 30, "condition": {"kind": "comparison", "leftType": "number", "rightType": "number", "left": {"source": "loop", "name": "iteration"}, "right": bound, "operator": operator}}}},
                    {"id": "body", "data": {"toolId": "logic.if", "toolVersion": "1.0.0", "parameters": {"leftType": "number", "rightType": "number", "left": 1, "right": 1, "operator": "eq"}}},
                    {"id": "output", "data": {"toolId": "output.pdf", "toolVersion": "1.0.0", "parameters": {}}},
                ], "edges": [
                    {"source": "input", "target": "output", "sourceHandle": "pdf", "targetHandle": "pdf"},
                    {"source": "loop", "target": "body", "sourceHandle": "body", "targetHandle": "run", "data": {"kind": "control"}},
                    {"source": "loop", "target": "output", "sourceHandle": "after", "targetHandle": "run", "data": {"kind": "control"}},
                ]}
            steps = []
            while_result = WorkflowExecutor(build_registry()).execute(graph("loop.while", "lt", 3), {}, {"file": str(source)}, TestContext(root), steps.append, lambda *_: None)
            while_iterations = [step["output"]["iteration"] for step in steps if step.get("nodeId") == "loop" and step.get("status") == "RUNNING"]
            self.assertEqual(while_iterations, [1, 2, 3])
            self.assertEqual(while_result["files"][0]["filename"], "output.pdf")
            repeat_steps = []
            WorkflowExecutor(build_registry()).execute(graph("loop.repeatUntil", "gte", 3), {}, {"file": str(source)}, TestContext(root), repeat_steps.append, lambda *_: None)
            repeat_iterations = [step["output"]["iteration"] for step in repeat_steps if step.get("nodeId") == "loop" and step.get("status") == "RUNNING"]
            self.assertEqual(repeat_iterations, [1, 2, 3])
            body_condition = graph("loop.repeatUntil", "eq", True)
            body_condition["nodes"][1]["data"]["parameters"]["condition"] = {"kind": "comparison", "leftType": "boolean", "rightType": "boolean", "left": {"source": "node", "nodeId": "body", "port": "boolean"}, "right": True, "operator": "eq"}
            body_condition["nodes"][2]["data"] = {"toolId": "logic.conditionGroup", "toolVersion": "1.0.0", "parameters": {"condition": {"kind": "comparison", "leftType": "boolean", "rightType": "boolean", "left": True, "right": True, "operator": "eq"}}}
            body_result = WorkflowExecutor(build_registry()).execute(body_condition, {}, {"file": str(source)}, TestContext(root), lambda *_: None, lambda *_: None)
            self.assertEqual(body_result["files"][0]["filename"], "output.pdf")
            immediate_steps = []
            WorkflowExecutor(build_registry()).execute(graph("loop.while", "lt", 0), {}, {"file": str(source)}, TestContext(root), immediate_steps.append, lambda *_: None)
            self.assertFalse(any(step.get("nodeId") == "body" for step in immediate_steps))
            self.assertFalse(any(step.get("nodeId") == "loop" and step.get("output", {}).get("phase") == "body" for step in immediate_steps))

    def test_conditional_loops_enforce_iteration_limit_cancellation_and_progress(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / "input.pdf"; make_pdf(source, 1)
            class TestContext(ToolContext):
                def pdf(self, _path): return type("Reader", (), {"pages": [object()]})()
            nodes = [
                {"id": "input", "data": {"toolId": "input.pdf", "toolVersion": "1.0.0", "parameters": {}}},
                {"id": "loop", "data": {"toolId": "loop.while", "toolVersion": "1.0.0", "parameters": {"maxIterations": 2, "timeoutSeconds": 30, "condition": {"kind": "comparison", "leftType": "number", "rightType": "number", "left": {"source": "loop", "name": "iteration"}, "right": 10, "operator": "lt"}}}},
                {"id": "body", "data": {"toolId": "logic.if", "toolVersion": "1.0.0", "parameters": {"leftType": "number", "rightType": "number", "left": 1, "right": 1, "operator": "eq"}}},
                {"id": "output", "data": {"toolId": "output.pdf", "toolVersion": "1.0.0", "parameters": {}}},
            ]
            edges = [
                {"source": "input", "target": "output", "sourceHandle": "pdf", "targetHandle": "pdf"},
                {"source": "loop", "target": "body", "sourceHandle": "body", "targetHandle": "run", "data": {"kind": "control"}},
                {"source": "loop", "target": "output", "sourceHandle": "after", "targetHandle": "run", "data": {"kind": "control"}},
            ]
            with self.assertRaisesRegex(ToolError, "maxIterations=2"):
                WorkflowExecutor(build_registry()).execute({"nodes": nodes, "edges": edges}, {}, {"file": str(source)}, TestContext(root), lambda *_: None, lambda *_: None)
            updates = []
            nodes[1]["data"]["parameters"]["maxIterations"] = 1000
            with self.assertRaisesRegex(ToolError, "annullata"):
                WorkflowExecutor(build_registry()).execute({"nodes": nodes, "edges": edges}, {}, {"file": str(source)}, TestContext(root, cancelled=lambda: len(updates) > 8), updates.append, lambda *_: None)
            self.assertTrue(any(update.get("nodeId") == "loop" and update.get("status") == "RUNNING" for update in updates))
            class ContextWithoutToolClock(ToolContext):
                def check(self):
                    if self.cancelled(): raise ToolError("CANCELLED", "Esecuzione annullata.")
                def pdf(self, _path): return type("Reader", (), {"pages": [object()]})()
            with patch("pdforchestrator.workflow.time.monotonic", side_effect=[0.0, 0.1, 1.1]):
                timed = {"nodes": nodes, "edges": edges}
                timed["nodes"][1]["data"]["parameters"]["maxIterations"] = 3
                timed["nodes"][1]["data"]["parameters"]["timeoutSeconds"] = 1
                timed["nodes"][1]["data"]["parameters"]["condition"]["right"] = 10
                with self.assertRaisesRegex(ToolError, "timeout di 1 secondi"):
                    WorkflowExecutor(build_registry()).execute(timed, {}, {"file": str(source)}, ContextWithoutToolClock(root), lambda *_: None, lambda *_: None)

    def test_break_and_continue_are_consumed_by_the_nearest_nested_loop(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / "input.pdf"; make_pdf(source, 1)
            class TestContext(ToolContext):
                def pdf(self, _path): return type("Reader", (), {"pages": [object()]})()
            def compare(iterations):
                return {"kind": "comparison", "leftType": "number", "rightType": "number", "left": {"source": "loop", "name": "iteration"}, "right": iterations, "operator": "lt"}
            def if_node(node_id):
                return {"id": node_id, "data": {"toolId": "logic.if", "toolVersion": "1.0.0", "parameters": {"leftType": "number", "rightType": "number", "left": 1, "right": 1, "operator": "eq"}}}
            nodes = [
                {"id": "input", "data": {"toolId": "input.pdf", "toolVersion": "1.0.0", "parameters": {}}},
                {"id": "outer", "data": {"toolId": "loop.while", "toolVersion": "1.0.0", "parameters": {"maxIterations": 3, "condition": compare(3)}}},
                {"id": "inner", "data": {"toolId": "loop.repeatUntil", "toolVersion": "1.0.0", "parameters": {"maxIterations": 5, "condition": compare(5)}}},
                {"id": "break", "data": {"toolId": "flow.break", "toolVersion": "1.0.0", "parameters": {}}},
                if_node("tail"), if_node("afterInner"),
                {"id": "output", "data": {"toolId": "output.pdf", "toolVersion": "1.0.0", "parameters": {}}},
            ]
            edges = [
                {"source": "input", "target": "output", "sourceHandle": "pdf", "targetHandle": "pdf"},
                {"source": "outer", "target": "inner", "sourceHandle": "body", "targetHandle": "run", "data": {"kind": "control"}},
                {"source": "inner", "target": "break", "sourceHandle": "body", "targetHandle": "run", "data": {"kind": "control"}},
                {"source": "break", "target": "tail", "sourceHandle": "break", "targetHandle": "run", "data": {"kind": "control"}},
                {"source": "inner", "target": "afterInner", "sourceHandle": "after", "targetHandle": "run", "data": {"kind": "control"}},
                {"source": "outer", "target": "output", "sourceHandle": "after", "targetHandle": "run", "data": {"kind": "control"}},
            ]
            updates = []
            WorkflowExecutor(build_registry()).execute({"nodes": nodes, "edges": edges}, {}, {"file": str(source)}, TestContext(root), updates.append, lambda *_: None)
            self.assertEqual(len([step for step in updates if step.get("nodeId") == "outer" and step.get("status") == "RUNNING"]), 3)
            self.assertEqual(len([step for step in updates if step.get("nodeId") == "inner" and step.get("status") == "RUNNING"]), 3)
            self.assertEqual(len([step for step in updates if step.get("nodeId") == "afterInner" and step.get("status") == "SUCCEEDED"]), 3)
            self.assertEqual(len([step for step in updates if step.get("nodeId") == "tail" and step.get("status") == "SKIPPED"]), 3)

            continue_nodes = [nodes[0], nodes[1], {"id": "continue", "data": {"toolId": "flow.continue", "toolVersion": "1.0.0", "parameters": {}}}, if_node("tail"), nodes[-1]]
            continue_edges = [edges[0], {"source": "outer", "target": "continue", "sourceHandle": "body", "targetHandle": "run", "data": {"kind": "control"}}, {"source": "continue", "target": "tail", "sourceHandle": "continue", "targetHandle": "run", "data": {"kind": "control"}}, edges[-1]]
            continue_updates = []
            WorkflowExecutor(build_registry()).execute({"nodes": continue_nodes, "edges": continue_edges}, {}, {"file": str(source)}, TestContext(root), continue_updates.append, lambda *_: None)
            self.assertEqual(len([step for step in continue_updates if step.get("nodeId") == "outer" and step.get("status") == "RUNNING"]), 3)
            self.assertEqual(len([step for step in continue_updates if step.get("nodeId") == "tail" and step.get("status") == "SKIPPED"]), 3)

    def test_jump_page_skips_pages_checks_range_and_obeys_iteration_limit(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / "input.pdf"; make_pdf(source, 4)
            class PdfContext(ToolContext):
                def pdf(self, path): return PdfReader(path, strict=True)
            def graph(condition_page, target_mode="relative", target=2, limit=10):
                condition = {"kind": "comparison", "leftType": "number", "rightType": "number", "left": {"source": "loop", "name": "currentPage"}, "right": condition_page, "operator": "eq"}
                return {"nodes": [
                    {"id": "input", "data": {"toolId": "input.pdf", "toolVersion": "1.0.0", "parameters": {}}},
                    {"id": "each", "data": {"toolId": "loop.eachPage", "toolVersion": "1.0.0", "parameters": {"start": 1, "end": 4, "step": 1, "maxIterations": limit}}},
                    {"id": "condition", "data": {"toolId": "logic.conditionGroup", "toolVersion": "1.0.0", "parameters": {"condition": condition}}},
                    {"id": "jump", "data": {"toolId": "flow.jumpPage", "toolVersion": "1.0.0", "parameters": {"targetMode": target_mode, "value": target}}},
                    {"id": "output", "data": {"toolId": "output.pdf", "toolVersion": "1.0.0", "parameters": {}}},
                ], "edges": [
                    {"source": "input", "target": "each", "sourceHandle": "pdf", "targetHandle": "document"},
                    {"source": "each", "target": "condition", "sourceHandle": "body", "targetHandle": "run", "data": {"kind": "control"}},
                    {"source": "condition", "target": "jump", "sourceHandle": "true", "targetHandle": "run", "data": {"kind": "control"}},
                    {"source": "input", "target": "output", "sourceHandle": "pdf", "targetHandle": "pdf"},
                    {"source": "each", "target": "output", "sourceHandle": "after", "targetHandle": "run", "data": {"kind": "control"}},
                ]}
            steps = []
            result = WorkflowExecutor(build_registry()).execute(graph(1, target=2), {}, {"file": str(source)}, PdfContext(root), steps.append, lambda *_: None)
            visited_pages = [step["output"]["currentPage"] for step in steps if step.get("nodeId") == "each" and step.get("status") == "RUNNING"]
            self.assertEqual(visited_pages, [1, 3, 4])
            self.assertEqual(len(PdfReader(result["files"][0]["path"]).pages), 4)
            with self.assertRaisesRegex(ToolError, "fuori dall'intervallo"):
                WorkflowExecutor(build_registry()).execute(graph(1, target=-1), {}, {"file": str(source)}, PdfContext(root), lambda *_: None, lambda *_: None)
            with self.assertRaisesRegex(ToolError, "oltre maxIterations=4"):
                WorkflowExecutor(build_registry()).execute(graph(2, target=-1, limit=4), {}, {"file": str(source)}, PdfContext(root), lambda *_: None, lambda *_: None)


if __name__ == "__main__": unittest.main()
