# PDFOrchestrator

SaaS per progettare workflow PDF come DAG visuali, pubblicarli come API HMAC e processarli con worker Python esterni.

## Componenti

- Next.js App Router e React su Vercel per UI e API serverless.
- PostgreSQL Neon per dati applicativi, audit e coda durevole.
- Cubbit S3 per PDF, con upload/download diretti via URL firmate.
- Worker Python esterno per esecuzione DAG, OCR e operazioni PDF.
- Supabase Auth per sessione e identità utente.

## Sviluppo locale

1. Installa Node.js compatibile con `package.json` e Python 3.12.
2. Copia `.env.example` in `.env.local` e configura Neon, Supabase e Cubbit.
3. Installa dipendenze e genera il client: `npm ci` e `npx prisma generate`.
4. Applica le migrazioni additive solo dopo aver configurato e verificato il database: `npx prisma migrate dev`.
5. Avvia Next.js: `npm run dev`.
6. Segui [avvio worker](docs/worker-deployment.md) per avviare il servizio Python.

## Documentazione

- [Architettura](docs/architecture.md)
- [Database Neon e Prisma](docs/database.md)
- [Formato workflow](docs/workflow-format.md)
- [Sviluppo strumenti](docs/tool-development.md)
- [Autenticazione HMAC](docs/api-authentication.md)
- [Riferimento API](docs/api-reference.md) e [OpenAPI](docs/public-api.yaml)
- [Deployment Vercel](docs/vercel-deployment.md)
- [Deployment worker](docs/worker-deployment.md)
- [Operazioni e limitazioni](docs/operations.md)

## Verifiche locali

```sh
npx prisma validate
npx prisma generate
npm run typecheck
npm run lint
npm test
```

Per il worker attivare `worker/.venv`, installare `worker/test-requirements.txt` ed eseguire `python -m unittest discover -s tests -v` da `worker`. Le suite end-to-end richiedono servizi/credenziali configurati e non sono simulate.

Il workflow integrato (editor draft/reopen, pubblicazione, credenziale HMAC, upload Cubbit, queue worker, polling e download PDF verificato) e la checklist di release sono descritti in [docs/integration-testing.md](docs/integration-testing.md). La prova reale si esegue con `npm run test:e2e` da root dopo aver generato le fixture e configurato `PDFORCH_E2E_COOKIE` e `PDFORCH_E2E_ORGANIZATION_ID`; crea un batch temporaneo e lo archivia al termine.

## Release

Vercel rileva Next.js automaticamente; `npm run build` genera Prisma Client e compila l'app. Non eseguire migrazioni dentro la build: revisionare e applicare quelle versionate separatamente con `npx prisma migrate deploy`. Vedi la guida Vercel per variabili server-only, runtime Node e dominio API.
