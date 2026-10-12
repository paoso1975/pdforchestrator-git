# Database e Neon

Prisma usa il provider PostgreSQL. In Prisma 7 gli URL sono in `prisma.config.ts`, mentre `src/lib/prisma.ts` crea `PrismaPg` con la URL runtime.

- `DATABASE_URL`: endpoint pooled Neon per richieste serverless; TLS `sslmode=require`.
- `DIRECT_URL`: endpoint diretto Neon per `prisma migrate deploy`/`migrate dev`; non è necessario alle funzioni runtime.
- `DATABASE_POOL_MAX`: connessioni `pg` per istanza serverless; iniziare con un valore basso e confrontarlo con il limite del piano e il numero di istanze.

Modelli principali: User, Organization, OrganizationMembership, Batch, BatchVersion, ToolDefinition, ApiCredential, ApiCredentialGrant, BatchExecution, StepExecution, ExecutionEvent, StoredFile, WebhookEndpoint, WebhookDelivery, ApiRequestNonce e ApiRateBucket. Gli indici coprono tenant/stato/data, coda/lease e relazioni di job. Le operazioni di claim usano transazioni brevi e `SKIP LOCKED`; Neon è PostgreSQL compatibile.

Per workflow versionati sono stati aggiunti `Workflow`, `WorkflowDraft`, `WorkflowVersion`, `WorkflowPublication`, `WorkflowCredentialGrant`, `WorkflowRun`, `WorkflowNodeRun`, `WorkflowArtifact` e `AuditEvent`. La versione attiva è vincolata allo stesso tenant e workflow tramite FK composita. La migrazione `20261011000000_workflow_versioning` aggiunge un trigger che rende le righe `WorkflowVersion` immutabili. `ApiCredential` resta il modello esistente ed è riutilizzato; la nuova grant per workflow evita di duplicare credenziali e applica vincoli tenant compositi.

La migrazione `20261013000000_workflow_publication_lifecycle` aggiunge lo stato `VALIDATED`, lo snapshot compilato/hash/data validazione a `WorkflowDraft` e consente registrazioni di pubblicazione ripetute per una stessa versione, necessarie ai rollback auditati. La route pubblica usa una transazione serializzabile e crea una nuova `WorkflowVersion`; rollback cambia solo `Workflow.activeVersionId` e aggiunge una registrazione, senza aggiornare versioni o run. La migrazione è preparata ma non applicata.

Le migrazioni `20261014000000_api_credential_version_scopes` e `20261015000000_api_upload_credential_isolation` aggiungono scope UUID per versione ai grant, collegano gli upload input alla credenziale proprietaria e cambiano l'idempotency index da organizzazione a credenziale. I record scope precedenti hanno array vuoto (autorizzazione batch-wide); i file preesistenti non hanno owner credential e non sono riutilizzabili tramite le nuove API HMAC.

La migrazione `20261016000000_worker_heartbeats` aggiunge la tabella `WorkerHeartbeat` usata dalla diagnostica ADMIN per distinguere il processo Python attivo dall'API worker raggiungibile. I record sono upsert per worker e vengono considerati online solo se aggiornati negli ultimi 90 secondi. La migrazione è preparata ma non applicata.

Le migrazioni versionate sono additive. Generare il client con `npx prisma generate`; validare con `npx prisma validate`. Prima di applicare migrazioni in un ambiente condiviso, fare backup/review e lanciare esplicitamente `npx prisma migrate deploy` da un ambiente amministrativo. Il comando non è parte della build Vercel e non va sostituito con `migrate reset`.

Il CRUD test per i nuovi modelli usa `WORKFLOW_TEST_DATABASE_URL`, che deve puntare a un database dedicato con `test` nel nome database o hostname. La fixture usa transazione rollback. Senza URL dedicata il test viene saltato; non puntare la variabile a produzione.
