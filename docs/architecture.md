# Architettura

PDFOrchestrator usa Next.js App Router su Vercel per UI e API, Neon PostgreSQL per dati e coda durevole, Cubbit S3 per i file e un worker Python esterno per l'elaborazione. Il worker non ha credenziali SQL: riceve job e aggiorna lease, step e risultati attraverso API interne HTTPS protette da `WORKER_SHARED_SECRET`.

Le funzioni Next.js sono stateless: verificano identità/permessi, validano richieste, scrivono job e restituiscono HTTP 202. Il worker acquisisce atomicamente job PostgreSQL tramite `FOR UPDATE SKIP LOCKED`, rinnova il lease e recupera job abbandonati alla scadenza. Upload/download PDF transitano direttamente tra client/worker e Cubbit con URL firmati.

```text
Client → Vercel Next.js → Neon (API, job, audit)
   ├── URL firmata → Cubbit S3 ← Worker Python
   └── API worker HTTPS ↔ Worker Python → Cubbit S3
```

Le route che usano Prisma/S3 dichiarano runtime Node.js. Non ci sono WebSocket né OCR o processi persistenti su Vercel. In locale il worker usa storage temporaneo isolato per job, cancellato alla fine dell'elaborazione.
