# PDFOrchestrator external worker

The Python worker runs outside Vercel. Vercel only creates executions, stores queue state in PostgreSQL, issues short lived Cubbit S3 URLs, and exposes authenticated worker HTTP endpoints. The worker has no PostgreSQL credentials. PostgreSQL `BatchExecution` rows are the durable queue; `/api/internal/worker/jobs/claim` leases one row in a short transaction using `FOR UPDATE SKIP LOCKED`. pg-boss is not used: the Python process cannot consume its Node.js queue directly, and adding it would introduce a separate queue protocol without helping this worker.

## Local Windows setup

1. Copy the root `.env.example` to the local Next.js environment and set the existing Neon, Supabase and Cubbit values. Set `WORKER_SHARED_SECRET` to a random secret with at least 32 characters.
2. Copy `worker/.env.example` to `worker/.env`. Set `PDFORCH_API_BASE_URL=http://localhost:3000/api/internal/worker`, the same worker secret, and the same Cubbit bucket, endpoint and region. Create a separate Cubbit service-account key for the worker with only `GetObject`, `PutObject` and `DeleteObject` access to the application bucket's input/execution prefixes. The Next.js server keeps its own key for signing URLs and checking upload state.
3. Apply the additive Prisma migrations and start Next.js:

   ```powershell
   npm ci
   npx prisma migrate deploy
   npm run dev
   ```

4. Create an isolated Python environment and install worker dependencies:

   ```powershell
   cd worker
   py -3.12 -m venv .venv
   .\.venv\Scripts\Activate.ps1
   python -m pip install --upgrade pip
   pip install -r requirements.txt
   ```

5. To create the complete test corpus, install test-only generators and run:

   ```powershell
   pip install -r test-requirements.txt
   python tests\generate_fixtures.py
   python -m unittest discover -s tests -v
   ```

6. Install Poppler (`pdftoppm`, `pdfimages`) and Tesseract on the Windows worker host for rendering/OCR. Add their executable directories to `PATH`, or set `POPPLER_BIN`, `PDFIMAGES_BIN`, and `TESSERACT_CMD` in `worker/.env`. `PDFIMAGES_BIN` can be omitted when `pdfimages` is on `PATH` or beside the configured `pdftoppm`. QR detection needs `opencv-python-headless`; barcode reading needs `zxing-cpp`. The worker logs a clear dependency error if an optional native tool is absent.
7. Start the external worker:

   ```powershell
   python -m pdforchestrator.consumer
   ```

The worker loads `worker/.env`, logs to stdout, polls only from the external host, and claims up to `WORKER_CONCURRENCY` jobs. Use the authenticated endpoint `GET /api/internal/worker/health` to check API and database connectivity:

```powershell
Invoke-RestMethod -Headers @{ Authorization = "Bearer $env:WORKER_SHARED_SECRET" } http://localhost:3000/api/internal/worker/health
```

## Debian / Proxmox

```sh
sudo apt-get update
sudo apt-get install -y python3 python3-venv python3-pip poppler-utils tesseract-ocr tesseract-ocr-eng tesseract-ocr-ita
cd /opt/pdf-orchestrator/worker
python3 -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
cp .env.example .env
python -m pdforchestrator.consumer
```

Set `PDFORCH_API_BASE_URL` to the deployed Next.js base URL plus `/api/internal/worker`. Only expose outbound HTTPS from the worker to Vercel and Cubbit. Keep `.env` mode `0600`; do not place the shared secret in browser variables or logs. Run the service under systemd or a container supervisor on Debian. Vercel never starts or supervises it.

## Container option

Build with `docker build -t pdforchestrator-worker worker`. Run with resource and filesystem limits, for example:

```sh
docker run --rm --read-only --cpus=2 --memory=2g \
  --tmpfs /tmp/pdf-orchestrator:rw,size=1g,noexec,nosuid \
  --env-file worker/.env pdforchestrator-worker
```

Tune CPU, memory, temporary storage, page count, PDF size, concurrency, lease and job timeout to the worker host. The Docker image uses an unprivileged user. The host/container supervisor provides restart and health monitoring; `/api/internal/worker/health` checks the Next.js-to-Postgres path.

## Job protocol

1. An authenticated member with OWNER, ADMIN or OPERATOR role creates a job for a published batch. `Idempotency-Key` makes repeated calls return the same job. Inputs may reference tenant-owned StoredFile IDs.
2. An authenticated client asks `POST /api/files/upload-url` for a short lived signed PUT URL and transfers the PDF directly to Cubbit. Next.js does not receive the PDF bytes. The included local E2E script uses a native HTTP client. Current Cubbit S3 documentation marks `PutBucketCors` unsupported, so a browser on the Next.js origin cannot use this cross-origin PUT until Cubbit enables an origin policy or a separate upload ingress is provisioned. No PDF proxy route is placed on Vercel.
3. The worker calls the internal claim endpoint with the shared Bearer secret. A single PostgreSQL transaction locks the oldest eligible queue row with `SKIP LOCKED`, increments attempts, and records an owner and lease expiry. The worker receives only that job's immutable published graph and tenant-scoped input file references. It also polls persistent webhook deliveries and expired file references; retries and retention leases are stored in PostgreSQL rather than Vercel process memory.
4. A heartbeat extends the lease and persists progress, current step and processed pages. Step updates and events are durable. Cancel requests are observed by heartbeat; a stale lease is recovered, retries use exponential backoff, and exhausted jobs become FAILED.
5. The worker downloads files from Cubbit into a unique temporary directory, validates the PDF and checksum, executes the DAG, uploads PDF (`application/pdf`) and TIFF (`image/tiff`) outputs, then asks Next.js to register file references and complete the execution. PDF outputs use `WORKER_MAX_PDF_BYTES`; TIFF outputs use `WORKER_MAX_OUTPUT_BYTES` (default 500 MiB). Output endpoints enforce organization membership and issue short lived signed GET URLs. Expired uploads and outputs are deleted by the worker using storage retention leases; the worker S3 identity also needs `AbortMultipartUpload` for abandoned multipart uploads.

Status values are `QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`, `CANCEL_REQUESTED`, and `CANCELLED`. The legacy `SUCCEEDED` enum value remains for compatibility with existing rows.

## HTTP endpoints

- `POST /api/batches/{batchId}/executions`: create an execution; requires authenticated operator membership.
- `GET /api/executions/{executionId}`: status, progress and recent events; any organization member.
- `GET /api/executions/{executionId}/steps`: persisted step states; any organization member.
- `POST /api/executions/{executionId}/cancel`: request cancellation; operator role.
- `GET /api/executions/{executionId}/outputs`: output metadata and short-lived Cubbit download links; any organization member.
- `POST /api/files/upload-url`: allocate a tenant-owned input StoredFile and signed upload URL.
- Internal worker API: `GET /health`, `POST /jobs/claim`, and per-job `/heartbeat`, `/steps`, `/complete`, `/fail`. Every internal endpoint checks `WORKER_SHARED_SECRET`.

## Execution safety and recovery

The published `toolManifest` is checked for its graph hash, plan hash, edge set, node order and installed handler versions. For format v2, node parameters are read from the compiled instruction in that immutable manifest; the editor graph supplies topology and display labels only. Step updates persist status, progress, attempt count, input/output summary and errors in `StepExecution`; heartbeat persists run progress/pages/current step; queue and recovery events persist in `ExecutionEvent`.

If a lease expires, PostgreSQL reclaims the same run with `SKIP LOCKED` and emits `LEASE_RECOVERED`. The worker starts again from the immutable published version and uploaded input references in a fresh per-run temporary directory; it does not reuse local paths from a dead process. This is a safe whole-run checkpoint, not a mid-node continuation checkpoint. Automatic replay is allowed only when every plan handler is registered as idempotent/replay-safe. Tool-level transient retries are subject to the same handler declaration. Current PDF handlers write only in the isolated temporary directory; output uploads use attempt-specific object keys, and no webhook is emitted until the completion transaction commits.

Poppler and Ghostscript run as managed child process groups; QR decoding runs in a separate Python process. OCR invokes Tesseract through pytesseract with a per-page timeout. The worker polls cancellation while managing child processes and terminates them on timeout, lease loss, cancellation or shutdown. Set CPU, memory and temporary storage bounds at the host/container level (for example `--cpus=2 --memory=2g` and a size-limited `/tmp` tmpfs); `WORKER_CONCURRENCY`, page/byte caps, tool timeouts and QR concurrency bound the work sent into those processes. On startup, only stale direct child directories with the `pdforch-` prefix in `WORKER_TEMP_ROOT` are removed after `WORKER_TEMP_RETENTION_HOURS` (default 24). Active or unrelated directories are left alone.

All API handlers use the Node.js runtime. No Vercel function launches Python, OCR, Poppler, qpdf, Ghostscript, or long-running PDF work. PostgreSQL pool size remains controlled by `DATABASE_POOL_MAX`; use the Neon pooled application URL for runtime and the direct URL for Prisma migrations, within the connection limits of the selected database plan.

## Supported tools

The versioned Python registry includes the `1.0.0` implementations for merge, split, page extraction/deletion/reorder/rotation, page-size detection, A4/A3/etc. normalization, QR and barcode detection, QR-page removal, OCR with invisible text overlay, metadata read/write, bookmarks, declarative conditions and branch merge. `input.pdf` and `output.pdf` are orchestration nodes. Tool and version IDs match the React catalog. Branch conditions are declarative (`qrFound`, `pageCount`, `pageSize`, `textContains`, `parameterComparison`); no user-supplied code is evaluated.

The OCR path uses Tesseract, Poppler rendering, pypdf and ReportLab. QR detection uses OpenCV; barcode detection uses zxing-cpp. `pikepdf` (qpdf) and pypdf validate and write PDFs. PyMuPDF is not included: its AGPL or commercial licensing must be addressed before adding it to a closed-source SaaS. Ghostscript is also not bundled because its AGPL/commercial license terms need a deployment decision. OCRmyPDF is not required by this worker path.

## End-to-end local check

Configure the local Next.js and Cubbit credentials; apply migrations; start Next.js and the Python worker; then publish a batch with `input.pdf → output.pdf`. Run the complete HTTP E2E flow with an authenticated local session and that batch ID:

```powershell
$env:PDFORCH_E2E_BATCH_ID = "<published-batch-uuid>"
$env:PDFORCH_E2E_COOKIE = "<local-supabase-session-cookie>"
python tests\e2e_local.py
```

The test uploads a generated PDF through the signed URL flow, submits the batch, checks persisted status and steps, downloads the result, and parses the returned PDF. The worker unit suite covers PDF operations and DAG behavior without external services. A full E2E run needs a reachable configured database, Supabase session, Cubbit bucket, and a published tenant batch; this repository does not contain seeded tenant accounts.

The test fixture generator creates mixed A4/A3/Letter pages, searchable text, a QR code, a Code 128 barcode, a rasterized scan, metadata, and bookmarks. The generator script writes test PDFs locally and they should not be used as production API fixtures.
