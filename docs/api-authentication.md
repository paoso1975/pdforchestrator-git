# Autenticazione API pubbliche

Le API `/v1` usano credenziali HMAC dedicate. Il secret viene mostrato una volta e cifrato server-side con AES-256-GCM (`PFO_CREDENTIAL_MASTER_KEY`). Il client invia `X-PFO-Key`, `X-PFO-Timestamp` (Unix secondi), `X-PFO-Nonce`, `X-PFO-Content-SHA256` e `X-PFO-Signature`.

La firma HMAC-SHA256 copre metodo, path, query canonica, timestamp, nonce e hash del body; l'helper canonico è `src/lib/hmac.ts`. Timestamp ha finestra limitata e nonce viene inserito con vincolo univoco in PostgreSQL per impedire replay anche tra istanze serverless. Revoca, scadenza, grant batch, organizzazione e rate bucket sono verificati lato server.

Non inviare mai Secret in query string, log o variabili `NEXT_PUBLIC_*`. Conservare il Secret in un secret manager lato client e ruotarlo in caso di esposizione. La chiave di cifratura deve essere casuale, 32 byte e mantenuta fuori da Neon.
