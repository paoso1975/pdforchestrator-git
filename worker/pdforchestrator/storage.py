from __future__ import annotations

import hashlib
import os
import re
from pathlib import Path
from typing import Any

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from .tools import ToolError


class StorageAdapter:
    """Cubbit S3 adapter. PDFs exist only inside a per-job temporary directory."""
    def __init__(self) -> None:
        endpoint = os.environ.get("CUBBIT_S3_ENDPOINT"); region = os.environ.get("CUBBIT_S3_REGION"); self.bucket = os.environ.get("CUBBIT_S3_BUCKET")
        key = os.environ.get("CUBBIT_S3_ACCESS_KEY_ID"); secret = os.environ.get("CUBBIT_S3_SECRET_ACCESS_KEY")
        if not all((endpoint, region, self.bucket, key, secret)): raise RuntimeError("Configurazione del server filesystem incompleta.")
        self.client = boto3.client("s3", endpoint_url=endpoint, region_name=region, aws_access_key_id=key, aws_secret_access_key=secret, config=Config(signature_version="s3v4", s3={"addressing_style": "path"}))

    def download(self, file: dict[str, Any], org_id: str, target: Path, max_bytes: int) -> Path:
        key = str(file.get("objectKey", ""))
        if file.get("bucket") != self.bucket or not key.startswith(f"{org_id}/inputs/"): raise ToolError("FILE_SCOPE", "Il file input non appartiene al tenant.")
        response = self.client.get_object(Bucket=self.bucket, Key=key)
        length = int(response.get("ContentLength", 0))
        if length <= 0 or length > max_bytes or (file.get("sizeBytes") is not None and length != int(file["sizeBytes"])): raise ToolError("FILE_SIZE_LIMIT", "PDF vuoto, con dimensione non corrispondente o oltre il limite.")
        digest = hashlib.sha256(); total = 0
        with target.open("wb") as stream:
            for chunk in iter(lambda: response["Body"].read(1024 * 1024), b""):
                total += len(chunk)
                if total > max_bytes: raise ToolError("FILE_SIZE_LIMIT", "PDF oltre il limite dimensioni.")
                digest.update(chunk); stream.write(chunk)
        expected = str(file.get("sha256", "")).lower()
        if expected and digest.hexdigest() != expected: target.unlink(missing_ok=True); raise ToolError("SHA256_MISMATCH", "Il PDF non corrisponde allo SHA-256 registrato.")
        return target

    def upload(self, path: Path, organization_id: str, execution_id: str, attempt: int, node_id: str, filename: str, content_type: str = "application/pdf") -> dict[str, Any]:
        if content_type != "application/pdf": raise ToolError("INVALID_CONTENT_TYPE", "Gli artifact pdf.output devono essere application/pdf.")
        safe = re.sub(r"[^A-Za-z0-9._-]", "_", Path(filename).name)[:120] or "output.pdf"
        if not safe.lower().endswith(".pdf"): safe = f"{safe}.pdf"
        key = f"{organization_id}/executions/{execution_id}/attempt-{attempt}/{re.sub(r'[^A-Za-z0-9_-]', '_', node_id)}/{safe}"
        if not path.is_file() or path.stat().st_size <= 0 or path.stat().st_size > int(os.environ.get("WORKER_MAX_PDF_BYTES", str(100 * 1024 * 1024))):
            raise ToolError("OUTPUT_SIZE_LIMIT", "PDF di output vuoto o oltre il limite dimensioni.")
        digest = hashlib.sha256(); size = 0
        with path.open("rb") as stream:
            while chunk := stream.read(1024 * 1024): digest.update(chunk); size += len(chunk)
        self.client.upload_file(str(path), self.bucket, key, ExtraArgs={"ContentType": content_type, "Metadata": {"sha256": digest.hexdigest()}})
        return {"objectKey": key, "filename": safe, "mimeType": content_type, "sizeBytes": size, "sha256": digest.hexdigest(), "kind": "OUTPUT", "nodeId": node_id}

    def delete_execution_object(self, object_key: str, organization_id: str, execution_id: str) -> None:
        prefix = f"{organization_id}/executions/{execution_id}/"
        if not object_key.startswith(prefix): raise ToolError("FILE_SCOPE", "Rifiuto di eliminare un oggetto fuori dal job.")
        self.client.delete_object(Bucket=self.bucket, Key=object_key)

    def cleanup_expired(self, file: dict[str, Any]) -> None:
        if file.get("bucket") != self.bucket:
            raise ToolError("FILE_SCOPE", "Bucket retention diverso dal bucket worker configurato.")
        if file.get("uploadId"):
            try: self.client.abort_multipart_upload(Bucket=self.bucket, Key=file["objectKey"], UploadId=file["uploadId"])
            except ClientError as exc:
                code = str(exc.response.get("Error", {}).get("Code", ""))
                if code not in {"NoSuchUpload", "404"}: raise
        self.client.delete_object(Bucket=self.bucket, Key=file["objectKey"])
