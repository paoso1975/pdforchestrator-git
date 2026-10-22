# Deployment worker esterno

## Windows

```powershell
cd worker
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
python -m pdforchestrator.consumer
```

Impostare URL interno Vercel `/api/internal/worker`, shared secret, credenziali Cubbit separate e directory temporanea locale isolata. Installare Tesseract e Poppler (`pdftoppm` e `pdfimages`) sul worker se si usano OCR/rendering o conversione TIFF; per OCR configurare le lingue installate con `TESSERACT_LANGUAGES`, il limite per pagina `OCR_PAGE_TIMEOUT_SECONDS` e `OMP_THREAD_LIMIT=1`. Su Windows, se `pdfimages` non è nel `PATH` né accanto a `pdftoppm`, configurare `PDFIMAGES_BIN` nel file `.env` del worker.

## Debian / Proxmox

Installare Python 3.12, `poppler-utils`, Ghostscript, Tesseract e lingue necessarie; creare venv, installare `requirements.txt`, copiare `.env.example` e avviare `python -m pdforchestrator.consumer`. Per `pdf.convert.pdfa`, installare anche veraPDF CLI, configurare `VERAPDF_BIN`, `GHOSTSCRIPT_BIN` e un ICC RGB attendibile tramite `PDFA_ICC_PROFILE`. Montare il profilo ICC in sola lettura. In produzione limitare memoria/CPU con container o unità systemd e mantenere `WORKER_CONCURRENCY=1` se i job OCR devono avere un budget memoria prevedibile; `OCR_PAGE_TIMEOUT_SECONDS` limita ciascuna invocazione Tesseract. Usare restart automatico e proteggere `.env` con permessi `0600`.

Il worker invia un heartbeat autenticato a `POST /api/internal/worker/heartbeat` ogni `WORKER_HEARTBEAT_SECONDS` (default 30). La route `/dashboard/services`, riservata agli ADMIN, considera online gli heartbeat degli ultimi 90 secondi. Dopo aver applicato la migrazione `20261016000000_worker_heartbeats`, impostare `WORKER_VERSION` facoltativamente per identificarne la release.

## Docker Compose

```sh
cp worker/.env.example worker/.env
docker compose -f docker-compose.worker.yml up -d --build
docker compose -f docker-compose.worker.yml logs -f worker
```

Il compose avvia solo il worker, con utente non-root (nell'immagine), filesystem read-only, tmpfs, limiti CPU/RAM e `restart: unless-stopped`. Non espone porte: la salute applicativa si verifica con il worker autenticato su `/api/internal/worker/health` e nei log del servizio. I job persistono in Neon e tornano disponibili dopo riavvio quando il lease scade.
