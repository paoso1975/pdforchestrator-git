from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

from pdforchestrator.storage import StorageAdapter
from pdforchestrator.tools import ToolError


class StorageUploadTests(unittest.TestCase):
    def setUp(self):
        self.storage = StorageAdapter.__new__(StorageAdapter)
        self.storage.bucket = "test-bucket"
        self.storage.client = Mock()

    def test_upload_multipage_tiff_preserves_mime_and_filename(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "output.tiff"
            path.write_bytes(b"II*\x00" + b"\x00" * 20)

            uploaded = self.storage.upload(path, "org-1", "run-1", 1, "node-1", "output.tiff", "image/tiff")

        self.assertEqual(uploaded["filename"], "output.tiff")
        self.assertEqual(uploaded["mimeType"], "image/tiff")
        self.assertEqual(uploaded["objectKey"], "org-1/executions/run-1/attempt-1/node-1/output.tiff")
        self.storage.client.upload_file.assert_called_once()
        self.assertEqual(self.storage.client.upload_file.call_args.kwargs["ExtraArgs"]["ContentType"], "image/tiff")

    def test_upload_pdf_remains_supported(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "result.pdf"
            path.write_bytes(b"%PDF-1.7\n")
            uploaded = self.storage.upload(path, "org-1", "run-1", 1, "node-1", "result.pdf")

        self.assertEqual(uploaded["mimeType"], "application/pdf")
        self.assertEqual(uploaded["filename"], "result.pdf")

    def test_upload_rejects_mime_extension_and_content_mismatches(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "result.tiff"
            path.write_bytes(b"II*\x00" + b"\x00" * 20)
            with self.assertRaisesRegex(ToolError, "non corrisponde al tipo MIME"):
                self.storage.upload(path, "org-1", "run-1", 1, "node-1", "result.tiff", "application/pdf")
            path.write_bytes(b"not a TIFF file")
            with self.assertRaisesRegex(ToolError, "non corrisponde a un TIFF"):
                self.storage.upload(path, "org-1", "run-1", 1, "node-1", "result.tiff", "image/tiff")
            with self.assertRaisesRegex(ToolError, "Sono supportati"):
                self.storage.upload(path, "org-1", "run-1", 1, "node-1", "result.tiff", "text/plain")


if __name__ == "__main__":
    unittest.main()
