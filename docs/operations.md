# Operazioni

- **Job fermi:** verificare worker, URL API, secret sincronizzato, endpoint health e accesso HTTPS in uscita verso Cubbit. Il claim usa lease persistenti; dopo crash il job è eleggibile allo scadere del lease, secondo tentativi/backoff configurati.
- **PDF fallito:** controllare `ExecutionEvent`, `StepExecution.error`, dipendenze Tesseract/Poppler, limiti pagine/byte e spazio temporaneo. Non inserire contenuti dei PDF nei log.
- **Database:** controllare disponibilità Neon, limiti pool e errori Prisma. Le funzioni Vercel usano l'endpoint pooled; worker non apre connessione SQL.
- **Storage:** controllare endpoint/bucket/permessi S3, checksum e lifecycle Cubbit. URL firmate sono temporanee; non condividerle in log.
- **Segreti:** ruotare credenziali Cubbit, `WORKER_SHARED_SECRET`, chiave HMAC e chiavi cifratura secondo runbook del proprio secret manager. Una rotazione della chiave AES richiede re-cifratura dei secret conservati.
- **Retention:** job worker reclama riferimenti file scaduti con lease DB e cancella oggetti Cubbit; verificare esiti delle delivery e permessi `DeleteObject`.

## Limiti dei test

Le suite locali validano DAG/HMAC e funzioni worker. Il test end-to-end HTTP richiede un batch pubblicato, sessione autenticata, migrazioni applicate, Neon raggiungibile e credenziali Cubbit reali. Nessun test E2E o affidabilità su infrastruttura live va considerato superato senza eseguirlo esplicitamente.
