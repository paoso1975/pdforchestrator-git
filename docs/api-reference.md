# API reference

La specifica OpenAPI 3.1 è in [`public-api.yaml`](public-api.yaml); esempi TypeScript/Python/cURL sono in [`public-api-examples.md`](public-api-examples.md). Il prefisso pubblico corrente è `/api/public/v1`; le route `/v1` restano disponibili per compatibilità. Ogni richiesta API, inclusi polling, upload-session e download URL, richiede HMAC.

| Metodo | Endpoint | Uso |
|---|---|---|
| POST | `/v1/uploads` | crea upload e URL Cubbit firmata |
| GET | `/v1/uploads/{id}` | consulta stato upload |
| POST | `/v1/uploads/{id}/complete` | conferma upload/checksum |
| POST | `/v1/uploads/{id}/parts/{partNumber}` | completa parte multipart |
| GET | `/v1/batches/{batchId}/schema` | schema della versione attiva |
| POST | `/v1/batches/{batchId}/executions` | accoda e risponde 202 |
| GET | `/v1/executions/{executionId}` | stato e progresso |
| GET | `/v1/executions/{executionId}/steps` | dettaglio step |
| GET | `/v1/executions/{executionId}/outputs` | manifest output e URL download Cubbit firmati (validi 300 secondi) |
| GET | `/v1/executions/{executionId}/outputs/{fileId}` | URL firmato di un output autorizzato (valido 300 secondi) |
| POST | `/v1/executions/{executionId}/cancel` | richiede cancellazione |

Le stesse operazioni sono esposte con il nuovo prefisso: `POST /api/public/v1/batches/{slug}/runs`, `GET /api/public/v1/runs/{runId}`, `GET /api/public/v1/runs/{runId}/steps`, `GET /api/public/v1/runs/{runId}/outputs`, `GET /api/public/v1/runs/{runId}/outputs/{fileId}` e `POST /api/public/v1/runs/{runId}/cancel`. Upload: `/api/public/v1/uploads` e relativi endpoint di stato/multipart. Le firme HMAC si calcolano sul path effettivamente richiesto. La risposta 202 include `runId` e `statusUrl`; la chiave `Idempotency-Key` ripetuta con lo stesso payload restituisce il run già accodato, mentre un payload diverso produce 409.

Per le API gestionali browser usare le route `/api/*` con sessione Supabase e RBAC; tutte le query applicano membership o organizationId.

## Schema e anteprima del batch

L'editor deduce `inputSchema` dai parametri dei nodi `input.pdf`/`input.pdf-list` e dai binding `source: "api"`. Tipo, default, enum, limiti e descrizione derivano dal parametro Zod del blocco quando dichiarati; le condizioni usano il tipo esplicito dell'operando. I nomi ripetuti con tipo coerente condividono una proprietà. Collisioni di tipo, nomi non validi e nomi che indicano token/password/chiavi vengono mostrati come errori e impediscono la pubblicazione. La route di pubblicazione ripete la deduzione, quindi il client non può omettere input usati dal grafo o inserire segreti nello schema.

Gli input file sono riferimenti UUID (`fileId`) ottenuti da `POST /api/public/v1/uploads`; il PDF viene caricato direttamente su Cubbit. Il body dell'esecuzione contiene solo `{ "input": { ... } }`; Key ID, timestamp, nonce, hash body e firma HMAC sono header. Il batch è selezionato tramite slug ed è sempre risolto insieme all'organizzazione della credenziale. Gli upload devono essere completati e verificati prima dell'accodamento. Per ottenere URL firmati di download si usa `GET /api/public/v1/runs/{runId}/outputs`; i link Cubbit hanno validità breve e possono essere rigenerati ripetendo la richiesta autenticata.
