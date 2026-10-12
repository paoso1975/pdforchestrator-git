FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 OMP_THREAD_LIMIT=1 OCR_PAGE_TIMEOUT_SECONDS=120
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils ghostscript tesseract-ocr tesseract-ocr-eng tesseract-ocr-ita libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/pdf-orchestrator
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY pdforchestrator ./pdforchestrator
RUN useradd --create-home --uid 10001 worker && mkdir -p /tmp/pdf-orchestrator && chown worker:worker /tmp/pdf-orchestrator
USER worker
ENV WORKER_TEMP_ROOT=/tmp/pdf-orchestrator
CMD ["python", "-m", "pdforchestrator.consumer"]
