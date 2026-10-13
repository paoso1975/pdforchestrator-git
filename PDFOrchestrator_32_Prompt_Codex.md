# PDFOrchestrator — 32 prompt Codex per Next.js e VS Code

## Uso
Eseguire **un prompt alla volta**, nello stesso repository, verificando i risultati prima di passare al successivo. I prompt sono indipendenti come attività ma dipendono dalle fondamenta realizzate in precedenza. Ogni prompt chiede a Codex di ispezionare il codice corrente per evitare sovrascritture. Le funzioni PDF possono essere implementate da worker Python o Node già presenti: non introdurre un secondo stack senza ragione.

### Convenzioni di progetto
- Editor grafico: React Flow / @xyflow/react se compatibile, nodi con porte control e data separate.
- Persistenza: Prisma + PostgreSQL, draft modificabile e versioni pubblicate immutabili.
- Esecuzione: piano JSON compilato, registry di handler tipizzati, worker asincrono.
- Input API: JSON Schema generato dai binding `source=api`.
- Numerazione pagine API: 1-based; identificativi pagina interni stabili quando possibile.
- Credenziali: key ID + secret hash, scopes, revoca, rotazione.
- Pubblicazione: validazione obbligatoria, versione congelata e rollback.

### Sequenza di controllo
Dopo ciascun prompt: verificare migrazioni, TypeScript, lint, test, interfaccia e compatibilità con il progetto esistente. Fare commit separati per fase.

## Prompt 01 — Audit e piano implementativo 
# ** ** ** ** ** ** ** ** ** ** ** FATTO ** ** ** ** ** ** ** ** ** ** ** 
```text
Sei Codex in VS Code nel repository Next.js di PDFOrchestrator. Prima ispeziona package.json, struttura src/app, Prisma, auth, API e worker esistenti. Non sovrascrivere funzioni funzionanti; riusa convenzioni, dipendenze e librerie già installate. Implementa realmente, non solo pseudocodice. Se mancano decisioni architetturali scegli soluzioni modulari e documentale. Mantieni TypeScript strict, validazione Zod, RBAC e multi-tenant se presenti, transazioni dove necessarie. Non eseguire codice utente dinamico (eval, Function, JS arbitrario). Scrivi test automatici, esegui lint/typecheck/test disponibili e riferisci file cambiati, migrazioni, comandi e limiti.

OBIETTIVO: Audit e piano implementativo

Mappa le componenti già presenti e produci docs/workflow-architecture.md con diagramma componenti, modelli, API, worker, strategia migrazioni e backlog. Non modificare ancora la logica produttiva. Distingui editor, validatore, compiler, runtime e pubblicazione.

CRITERI DI ACCETTAZIONE: l implementazione è persistente, tipizzata, testata, con errori leggibili e nessun mock nel percorso produttivo.
```

## Prompt 02 — Schema Prisma e versionamento 
# ** ** ** ** ** ** ** ** ** ** ** FATTO ** ** ** ** ** ** ** ** ** ** ** 
```text
Sei Codex in VS Code nel repository Next.js di PDFOrchestrator. Prima ispeziona package.json, struttura src/app, Prisma, auth, API e worker esistenti. Non sovrascrivere funzioni funzionanti; riusa convenzioni, dipendenze e librerie già installate. Implementa realmente, non solo pseudocodice. Se mancano decisioni architetturali scegli soluzioni modulari e documentale. Mantieni TypeScript strict, validazione Zod, RBAC e multi-tenant se presenti, transazioni dove necessarie. Non eseguire codice utente dinamico (eval, Function, JS arbitrario). Scrivi test automatici, esegui lint/typecheck/test disponibili e riferisci file cambiati, migrazioni, comandi e limiti.

OBIETTIVO: Schema Prisma e versionamento

Aggiungi modelli compatibili con schema esistente: Workflow, WorkflowDraft, WorkflowVersion immutabile, WorkflowPublication, WorkflowRun, WorkflowNodeRun, WorkflowArtifact, ApiCredential e AuditEvent (o adattamenti coerenti). Salva nodes/edges/viewport come JSON tipizzato; revision per optimistic concurrency; compiledPlan, inputSchema, outputSchema, hash, status e timestamps. Isolamento tenant, indici, cascade prudenti, migrazione e test CRUD.

CRITERI DI ACCETTAZIONE: l implementazione è persistente, tipizzata, testata, con errori leggibili e nessun mock nel percorso produttivo.
```

## Prompt 03 — Catalogo dichiarativo dei blocchi 
# ** ** ** ** ** ** ** ** ** ** ** FATTO ** ** ** ** ** ** ** ** ** ** ** 
```text
Sei Codex in VS Code nel repository Next.js di PDFOrchestrator. Prima ispeziona package.json, struttura src/app, Prisma, auth, API e worker esistenti. Non sovrascrivere funzioni funzionanti; riusa convenzioni, dipendenze e librerie già installate. Implementa realmente, non solo pseudocodice. Se mancano decisioni architetturali scegli soluzioni modulari e documentale. Mantieni TypeScript strict, validazione Zod, RBAC e multi-tenant se presenti, transazioni dove necessarie. Non eseguire codice utente dinamico (eval, Function, JS arbitrario). Scrivi test automatici, esegui lint/typecheck/test disponibili e riferisci file cambiati, migrazioni, comandi e limiti.

OBIETTIVO: Catalogo dichiarativo dei blocchi

Implementa registry server/client condiviso con type, version, categoria, icona Lucide, colori, label IT, input/output ports tipizzate, schema Zod parametri, defaults, capacità worker e handler id. Binding source constant/api/node/variable/expression con risoluzione sicura. Contratto port: control, document, documentList, string, number, boolean, object, array. Ogni block definition guida UI, validazione, compilazione e documentazione.

CRITERI DI ACCETTAZIONE: l implementazione è persistente, tipizzata, testata, con errori leggibili e nessun mock nel percorso produttivo.
```

## Prompt 04 — Canvas drag and drop 
# ** ** ** ** ** ** ** ** ** ** ** FATTO ** ** ** ** ** ** ** ** ** ** ** 
```text
Sei Codex in VS Code nel repository Next.js di PDFOrchestrator. Prima ispeziona package.json, struttura src/app, Prisma, auth, API e worker esistenti. Non sovrascrivere funzioni funzionanti; riusa convenzioni, dipendenze e librerie già installate. Implementa realmente, non solo pseudocodice. Se mancano decisioni architetturali scegli soluzioni modulari e documentale. Mantieni TypeScript strict, validazione Zod, RBAC e multi-tenant se presenti, transazioni dove necessarie. Non eseguire codice utente dinamico (eval, Function, JS arbitrario). Scrivi test automatici, esegui lint/typecheck/test disponibili e riferisci file cambiati, migrazioni, comandi e limiti.

OBIETTIVO: Canvas drag and drop

Implementa editor React client con @xyflow/react se compatibile: palette ricercabile, drag drop, pan/zoom, minimap, snap grid, selezione, multi-select, duplicazione, undo/redo, scorciatoie, auto-layout opzionale, viewport persistito, nodi accessibili e responsive. Grafica blocchi con header colorato, icona, porte e riepilogo parametri come schema concordato.

CRITERI DI ACCETTAZIONE: l implementazione è persistente, tipizzata, testata, con errori leggibili e nessun mock nel percorso produttivo.
```

## Prompt 05 — Collegamenti direzionali e porte 
# ** ** ** ** ** ** ** ** ** ** ** FATTO ** ** ** ** ** ** ** ** ** ** ** 
```text
Sei Codex in VS Code nel repository Next.js di PDFOrchestrator. Prima ispeziona package.json, struttura src/app, Prisma, auth, API e worker esistenti. Non sovrascrivere funzioni funzionanti; riusa convenzioni, dipendenze e librerie già installate. Implementa realmente, non solo pseudocodice. Se mancano decisioni architetturali scegli soluzioni modulari e documentale. Mantieni TypeScript strict, validazione Zod, RBAC e multi-tenant se presenti, transazioni dove necessarie. Non eseguire codice utente dinamico (eval, Function, JS arbitrario). Scrivi test automatici, esegui lint/typecheck/test disponibili e riferisci file cambiati, migrazioni, comandi e limiti.

OBIETTIVO: Collegamenti direzionali e porte

Implementa connessioni da output verso input, handle multipli tipizzati e direzionali, frecce animate opzionali, routing bezier/smoothstep, edge labels, drag reconnect sorgente/destinazione, cancellazione con Delete o menu contestuale, inserimento nodo su edge, prevenzione duplicati, porte incompatibili, collegamenti a nodi eliminati e cicli non strutturati. Edge control separati dai data edges. Supporta condizionale true/false, loop body/after, error e success, senza confondere il grafo dati con il controllo.

CRITERI DI ACCETTAZIONE: l implementazione è persistente, tipizzata, testata, con errori leggibili e nessun mock nel percorso produttivo.
```

## Prompt 06 — Pannello configurazione e variable picker 
# ** ** ** ** ** ** ** ** ** ** ** FATTO ** ** ** ** ** ** ** ** ** ** ** 
```text
Sei Codex in VS Code nel repository Next.js di PDFOrchestrator. Prima ispeziona package.json, struttura src/app, Prisma, auth, API e worker esistenti. Non sovrascrivere funzioni funzionanti; riusa convenzioni, dipendenze e librerie già installate. Implementa realmente, non solo pseudocodice. Se mancano decisioni architetturali scegli soluzioni modulari e documentale. Mantieni TypeScript strict, validazione Zod, RBAC e multi-tenant se presenti, transazioni dove necessarie. Non eseguire codice utente dinamico (eval, Function, JS arbitrario). Scrivi test automatici, esegui lint/typecheck/test disponibili e riferisci file cambiati, migrazioni, comandi e limiti.

OBIETTIVO: Pannello configurazione e variable picker

Realizza inspector laterale autogenerato dal registry: campi Zod, validazione inline, costanti, parametri API, output nodi precedenti, variabili di contesto e loop, expression builder senza eval. Picker filtrato per tipi e visibilità di scope; preview valore di test, descrizioni e gestione parametri richiesti/facoltativi. Mantieni editing nel draft.

CRITERI DI ACCETTAZIONE: l implementazione è persistente, tipizzata, testata, con errori leggibili e nessun mock nel percorso produttivo.
```

## Prompt 07 — Salvataggio editor e revisioni
# ** ** ** ** ** ** ** ** ** ** ** FATTO ** ** ** ** ** ** ** ** ** ** ** 
```text
Sei Codex in VS Code nel repository Next.js di PDFOrchestrator. Prima ispeziona package.json, struttura src/app, Prisma, auth, API e worker esistenti. Non sovrascrivere funzioni funzionanti; riusa convenzioni, dipendenze e librerie già installate. Implementa realmente, non solo pseudocodice. Se mancano decisioni architetturali scegli soluzioni modulari e documentale. Mantieni TypeScript strict, validazione Zod, RBAC e multi-tenant se presenti, transazioni dove necessarie. Non eseguire codice utente dinamico (eval, Function, JS arbitrario). Scrivi test automatici, esegui lint/typecheck/test disponibili e riferisci file cambiati, migrazioni, comandi e limiti.

OBIETTIVO: Salvataggio editor e revisioni

API autenticate per create/list/get/update draft, autosave debounce con stato dirty/saved/error, revision e 409 su conflitto, snapshot posizioni nodes edges viewport, import/export JSON con controllo schema e dimensioni, duplicazione, ripristino, history e audit. Test riapertura identica del canvas e concorrenza.

CRITERI DI ACCETTAZIONE: l implementazione è persistente, tipizzata, testata, con errori leggibili e nessun mock nel percorso produttivo.
```

## Prompt 08 — IF / ELSE e operatori
# ** ** ** ** ** ** ** ** ** ** ** FATTO ** ** ** ** ** ** ** ** ** ** ** 
```text
Sei Codex in VS Code nel repository Next.js di PDFOrchestrator. Prima ispeziona package.json, struttura src/app, Prisma, auth, API e worker esistenti. Non sovrascrivere funzioni funzionanti; riusa convenzioni, dipendenze e librerie già installate. Implementa realmente, non solo pseudocodice. Se mancano decisioni architetturali scegli soluzioni modulari e documentale. Mantieni TypeScript strict, validazione Zod, RBAC e multi-tenant se presenti, transazioni dove necessarie. Non eseguire codice utente dinamico (eval, Function, JS arbitrario). Scrivi test automatici, esegui lint/typecheck/test disponibili e riferisci file cambiati, migrazioni, comandi e limiti.

OBIETTIVO: IF / ELSE e operatori

Blocco logic.if con input left/right da binding tipizzati; operatori eq, neq, gt, gte, lt, lte, contains, notContains, startsWith, endsWith, in, notIn, isEmpty, isNull; confronto esplicito di tipi, caseSensitive e gestione null. Porte control true/false. Test rami e tipi errati.

CRITERI DI ACCETTAZIONE: l implementazione è persistente, tipizzata, testata, con errori leggibili e nessun mock nel percorso produttivo.
```

## Prompt 09 — Condizioni composte AND OR NOT
# ** ** ** ** ** ** ** ** ** ** ** FATTO ** ** ** ** ** ** ** ** ** ** ** 

```text
Sei Codex in VS Code nel repository Next.js di PDFOrchestrator. Prima ispeziona package.json, struttura src/app, Prisma, auth, API e worker esistenti. Non sovrascrivere funzioni funzionanti; riusa convenzioni, dipendenze e librerie già installate. Implementa realmente, non solo pseudocodice. Se mancano decisioni architetturali scegli soluzioni modulari e documentale. Mantieni TypeScript strict, validazione Zod, RBAC e multi-tenant se presenti, transazioni dove necessarie. Non eseguire codice utente dinamico (eval, Function, JS arbitrario). Scrivi test automatici, esegui lint/typecheck/test disponibili e riferisci file cambiati, migrazioni, comandi e limiti.

OBIETTIVO: Condizioni composte AND OR NOT

Blocco logic.conditionGroup con gruppi annidati AND/OR/NOT, short-circuit, confronti su output QR/OCR/metadata e valori API. UI builder leggibile, JSON AST validato con limiti di profondità e numero condizioni, output boolean e porte true/false.

CRITERI DI ACCETTAZIONE: l implementazione è persistente, tipizzata, testata, con errori leggibili e nessun mock nel percorso produttivo.
```

## Prompt 10 — Ciclo PER OGNI PAGINA
# ** ** ** ** ** ** ** ** ** ** ** FATTO ** ** ** ** ** ** ** ** ** ** ** 
```text
Sei Codex in VS Code nel repository Next.js di PDFOrchestrator. Prima ispeziona package.json, struttura src/app, Prisma, auth, API e worker esistenti. Non sovrascrivere funzioni funzionanti; riusa convenzioni, dipendenze e librerie già installate. Implementa realmente, non solo pseudocodice. Se mancano decisioni architetturali scegli soluzioni modulari e documentale. Mantieni TypeScript strict, validazione Zod, RBAC e multi-tenant se presenti, transazioni dove necessarie. Non eseguire codice utente dinamico (eval, Function, JS arbitrario). Scrivi test automatici, esegui lint/typecheck/test disponibili e riferisci file cambiati, migrazioni, comandi e limiti.

OBIETTIVO: Ciclo PER OGNI PAGINA

Blocco loop.eachPage con document, start/end/step, currentPage, pageId stabile, pageCount, index, porte body/after, scope variabili e snapshot pagine. Gestisci documenti modificati: raccolta azioni differite o identificativi stabili, maxIterations, cancellation e progress. Test eliminazioni senza slittamento indici.

CRITERI DI ACCETTAZIONE: l implementazione è persistente, tipizzata, testata, con errori leggibili e nessun mock nel percorso produttivo.
```

## Prompt 11 — Ciclo su elenco e righe
# ** ** ** ** ** ** ** ** ** ** ** FATTO ** ** ** ** ** ** ** ** ** ** ** 
```text
Sei Codex in VS Code nel repository Next.js di PDFOrchestrator. Prima ispeziona package.json, struttura src/app, Prisma, auth, API e worker esistenti. Non sovrascrivere funzioni funzionanti; riusa convenzioni, dipendenze e librerie già installate. Implementa realmente, non solo pseudocodice. Se mancano decisioni architetturali scegli soluzioni modulari e documentale. Mantieni TypeScript strict, validazione Zod, RBAC e multi-tenant se presenti, transazioni dove necessarie. Non eseguire codice utente dinamico (eval, Function, JS arbitrario). Scrivi test automatici, esegui lint/typecheck/test disponibili e riferisci file cambiati, migrazioni, comandi e limiti.

OBIETTIVO: Ciclo su elenco e righe

Blocco loop.forEach su array JSON o tabella di oggetti, item/index, accesso colonna tipizzato, filtro opzionale, body/after, maxIterations e limite annidamento. Test su output pdf.qr.readAll e liste API.

CRITERI DI ACCETTAZIONE: l implementazione è persistente, tipizzata, testata, con errori leggibili e nessun mock nel percorso produttivo.
```

## Prompt 12 — WHILE e REPEAT
# ** ** ** ** ** ** ** ** ** ** ** FATTO ** ** ** ** ** ** ** ** ** ** ** 
```text
Sei Codex in VS Code nel repository Next.js di PDFOrchestrator. Prima ispeziona package.json, struttura src/app, Prisma, auth, API e worker esistenti. Non sovrascrivere funzioni funzionanti; riusa convenzioni, dipendenze e librerie già installate. Implementa realmente, non solo pseudocodice. Se mancano decisioni architetturali scegli soluzioni modulari e documentale. Mantieni TypeScript strict, validazione Zod, RBAC e multi-tenant se presenti, transazioni dove necessarie. Non eseguire codice utente dinamico (eval, Function, JS arbitrario). Scrivi test automatici, esegui lint/typecheck/test disponibili e riferisci file cambiati, migrazioni, comandi e limiti.

OBIETTIVO: WHILE e REPEAT

Blocchi loop.while e loop.repeatUntil con condizioni AST, controllo prima/dopo iterazione, maxIterations obbligatorio, timeout, cancellation, progress e protezione loop infinito. Porte body/after.

CRITERI DI ACCETTAZIONE: l implementazione è persistente, tipizzata, testata, con errori leggibili e nessun mock nel percorso produttivo.
```

## Prompt 13 — BREAK CONTINUE e salto pagina
# ** ** ** ** ** ** ** ** ** ** ** FATTO ** ** ** ** ** ** ** ** ** ** ** 
```text
Sei Codex in VS Code nel repository Next.js di PDFOrchestrator. Prima ispeziona package.json, struttura src/app, Prisma, auth, API e worker esistenti. Non sovrascrivere funzioni funzionanti; riusa convenzioni, dipendenze e librerie già installate. Implementa realmente, non solo pseudocodice. Se mancano decisioni architetturali scegli soluzioni modulari e documentale. Mantieni TypeScript strict, validazione Zod, RBAC e multi-tenant se presenti, transazioni dove necessarie. Non eseguire codice utente dinamico (eval, Function, JS arbitrario). Scrivi test automatici, esegui lint/typecheck/test disponibili e riferisci file cambiati, migrazioni, comandi e limiti.

OBIETTIVO: BREAK CONTINUE e salto pagina

Blocchi flow.break, flow.continue, flow.jumpPage: validazione scope ciclo, jump target relativo/assoluto con range check, no goto arbitrario, limiti per prevenire loop. I rami di controllo devono essere modellati nel compiledPlan e testati con cicli annidati.

CRITERI DI ACCETTAZIONE: l implementazione è persistente, tipizzata, testata, con errori leggibili e nessun mock nel percorso produttivo.
```

## Prompt 14 — Confronto elenco, lookup e variabili
# ** ** ** ** ** ** ** ** ** ** ** FATTO ** ** ** ** ** ** ** ** ** ** ** 
```text
Sei Codex in VS Code nel repository Next.js di PDFOrchestrator. Prima ispeziona package.json, struttura src/app, Prisma, auth, API e worker esistenti. Non sovrascrivere funzioni funzionanti; riusa convenzioni, dipendenze e librerie già installate. Implementa realmente, non solo pseudocodice. Se mancano decisioni architetturali scegli soluzioni modulari e documentale. Mantieni TypeScript strict, validazione Zod, RBAC e multi-tenant se presenti, transazioni dove necessarie. Non eseguire codice utente dinamico (eval, Function, JS arbitrario). Scrivi test automatici, esegui lint/typecheck/test disponibili e riferisci file cambiati, migrazioni, comandi e limiti.

OBIETTIVO: Confronto elenco, lookup e variabili

Blocchi data.lookup e data.setVariable: ricerca exact/contains/range su colonna di array, restituzione colonna o oggetto, found/notFound, default, primo/tutti, tipi e null. Variabili scoped workflow/loop, no mutazioni concorrenti implicite. Test lookup QR e metadati.

CRITERI DI ACCETTAZIONE: l implementazione è persistente, tipizzata, testata, con errori leggibili e nessun mock nel percorso produttivo.
```

## Prompt 15 — Unisci PDF
# ** ** ** ** ** ** ** ** ** ** ** FATTO ** ** ** ** ** ** ** ** ** ** ** 
```text
Sei Codex in VS Code nel repository Next.js di PDFOrchestrator. Prima ispeziona package.json, struttura src/app, Prisma, auth, API e worker esistenti. Non sovrascrivere funzioni funzionanti; riusa convenzioni, dipendenze e librerie già installate. Implementa realmente, non solo pseudocodice. Se mancano decisioni architetturali scegli soluzioni modulari e documentale. Mantieni TypeScript strict, validazione Zod, RBAC e multi-tenant se presenti, transazioni dove necessarie. Non eseguire codice utente dinamico (eval, Function, JS arbitrario). Scrivi test automatici, esegui lint/typecheck/test disponibili e riferisci file cambiati, migrazioni, comandi e limiti.

OBIETTIVO: Unisci PDF

Blocco pdf.merge con input files[] {fileRef, filename, order}, sort stabile, verifica formati/password, handler worker che genera artifact PDF, pagine totali e mapping pagine origine/destinazione. Test multipli file e ordinamento.

CRITERI DI ACCETTAZIONE: l implementazione è persistente, tipizzata, testata, con errori leggibili e nessun mock nel percorso produttivo.
```

## Prompt 16 — Dividi PDF
# ** ** ** ** ** ** ** ** ** ** ** FATTO ** ** ** ** ** ** ** ** ** ** ** 
```text
Sei Codex in VS Code nel repository Next.js di PDFOrchestrator. Prima ispeziona package.json, struttura src/app, Prisma, auth, API e worker esistenti. Non sovrascrivere funzioni funzionanti; riusa convenzioni, dipendenze e librerie già installate. Implementa realmente, non solo pseudocodice. Se mancano decisioni architetturali scegli soluzioni modulari e documentale. Mantieni TypeScript strict, validazione Zod, RBAC e multi-tenant se presenti, transazioni dove necessarie. Non eseguire codice utente dinamico (eval, Function, JS arbitrario). Scrivi test automatici, esegui lint/typecheck/test disponibili e riferisci file cambiati, migrazioni, comandi e limiti.

OBIETTIVO: Dividi PDF

Blocco pdf.split con daPagina/aPagina inclusivi 1-based, output document o documents[] secondo modalità, naming template, validazione limiti, artifact multipli, preservazione metadati compatibili e test.

CRITERI DI ACCETTAZIONE: l implementazione è persistente, tipizzata, testata, con errori leggibili e nessun mock nel percorso produttivo.
```

## Prompt 17 — Output file
# ** ** ** ** ** ** ** ** ** ** ** FATTO ** ** ** ** ** ** ** ** ** ** ** 
```text
Sei Codex in VS Code nel repository Next.js di PDFOrchestrator. Prima ispeziona package.json, struttura src/app, Prisma, auth, API e worker esistenti. Non sovrascrivere funzioni funzionanti; riusa convenzioni, dipendenze e librerie già installate. Implementa realmente, non solo pseudocodice. Se mancano decisioni architetturali scegli soluzioni modulari e documentale. Mantieni TypeScript strict, validazione Zod, RBAC e multi-tenant se presenti, transazioni dove necessarie. Non eseguire codice utente dinamico (eval, Function, JS arbitrario). Scrivi test automatici, esegui lint/typecheck/test disponibili e riferisci file cambiati, migrazioni, comandi e limiti.

OBIETTIVO: Output file

Blocco pdf.output con document, filename template sanificato, collision policy, contentType, output artifact e manifest. Non pubblicare direttamente filesystem; scrivi su storage gestito, rendi output disponibile via job e URL firmato a scadenza.

CRITERI DI ACCETTAZIONE: l implementazione è persistente, tipizzata, testata, con errori leggibili e nessun mock nel percorso produttivo.
```

## Prompt 18 — QR singola pagina
# ** ** ** ** ** ** ** ** ** ** ** FATTO ** ** ** ** ** ** ** ** ** ** ** 
```text
Sei Codex in VS Code nel repository Next.js di PDFOrchestrator. Prima ispeziona package.json, struttura src/app, Prisma, auth, API e worker esistenti. Non sovrascrivere funzioni funzionanti; riusa convenzioni, dipendenze e librerie già installate. Implementa realmente, non solo pseudocodice. Se mancano decisioni architetturali scegli soluzioni modulari e documentale. Mantieni TypeScript strict, validazione Zod, RBAC e multi-tenant se presenti, transazioni dove necessarie. Non eseguire codice utente dinamico (eval, Function, JS arbitrario). Scrivi test automatici, esegui lint/typecheck/test disponibili e riferisci file cambiati, migrazioni, comandi e limiti.

OBIETTIVO: QR singola pagina

Blocco pdf.qr.readPage con pagina 1-based, dpi e preprocess opzionali, multi-code per pagina, output codes[] {page,value,format,bbox,confidence?}, found/count, niente risultato fittizio; worker con libreria scanner verificata, test scansione e pagina vuota.

CRITERI DI ACCETTAZIONE: l implementazione è persistente, tipizzata, testata, con errori leggibili e nessun mock nel percorso produttivo.
```

## Prompt 19 — QR tutte le pagine
# ** ** ** ** ** ** ** ** ** ** ** FATTO ** ** ** ** ** ** ** ** ** ** ** 
```text
Sei Codex in VS Code nel repository Next.js di PDFOrchestrator. Prima ispeziona package.json, struttura src/app, Prisma, auth, API e worker esistenti. Non sovrascrivere funzioni funzionanti; riusa convenzioni, dipendenze e librerie già installate. Implementa realmente, non solo pseudocodice. Se mancano decisioni architetturali scegli soluzioni modulari e documentale. Mantieni TypeScript strict, validazione Zod, RBAC e multi-tenant se presenti, transazioni dove necessarie. Non eseguire codice utente dinamico (eval, Function, JS arbitrario). Scrivi test automatici, esegui lint/typecheck/test disponibili e riferisci file cambiati, migrazioni, comandi e limiti.

OBIETTIVO: QR tutte le pagine

Blocco pdf.qr.readAll con range, dpi, concurrency limitata, output codes[] ordinati per pagina e posizione, pagesScanned, progress e cancellation; test PDF misti, più codici stessa pagina e nessun codice.

CRITERI DI ACCETTAZIONE: l implementazione è persistente, tipizzata, testata, con errori leggibili e nessun mock nel percorso produttivo.
```

## Prompt 20 — Segnalibri PDF
# ** ** ** ** ** ** ** ** ** ** ** FATTO ** ** ** ** ** ** ** ** ** ** ** 
```text
Sei Codex in VS Code nel repository Next.js di PDFOrchestrator. Prima ispeziona package.json, struttura src/app, Prisma, auth, API e worker esistenti. Non sovrascrivere funzioni funzionanti; riusa convenzioni, dipendenze e librerie già installate. Implementa realmente, non solo pseudocodice. Se mancano decisioni architetturali scegli soluzioni modulari e documentale. Mantieni TypeScript strict, validazione Zod, RBAC e multi-tenant se presenti, transazioni dove necessarie. Non eseguire codice utente dinamico (eval, Function, JS arbitrario). Scrivi test automatici, esegui lint/typecheck/test disponibili e riferisci file cambiati, migrazioni, comandi e limiti.

OBIETTIVO: Segnalibri PDF

Blocco pdf.bookmark.add con pagina, descrizione, livello, parent opzionale, preserva outline esistente, output artifact aggiornato, test segnalibri multipli e caratteri Unicode.

CRITERI DI ACCETTAZIONE: l implementazione è persistente, tipizzata, testata, con errori leggibili e nessun mock nel percorso produttivo.
```

## Prompt 21 — Elimina pagine
# ** ** ** ** ** ** ** ** ** ** ** FATTO ** ** ** ** ** ** ** ** ** ** ** 
```text
Sei Codex in VS Code nel repository Next.js di PDFOrchestrator. Prima ispeziona package.json, struttura src/app, Prisma, auth, API e worker esistenti. Non sovrascrivere funzioni funzionanti; riusa convenzioni, dipendenze e librerie già installate. Implementa realmente, non solo pseudocodice. Se mancano decisioni architetturali scegli soluzioni modulari e documentale. Mantieni TypeScript strict, validazione Zod, RBAC e multi-tenant se presenti, transazioni dove necessarie. Non eseguire codice utente dinamico (eval, Function, JS arbitrario). Scrivi test automatici, esegui lint/typecheck/test disponibili e riferisci file cambiati, migrazioni, comandi e limiti.

OBIETTIVO: Elimina pagine

Blocco pdf.page.delete con pagina o pages[] e deduplica, ordine decrescente o stable page ids, protezione PDF senza pagine, output document e deletedPages, test ciclo QR e riferimenti di pagina.

CRITERI DI ACCETTAZIONE: l implementazione è persistente, tipizzata, testata, con errori leggibili e nessun mock nel percorso produttivo.
```

## Prompt 22 — Inserisci pagine
# ** ** ** ** ** ** ** ** ** ** ** FATTO ** ** ** ** ** ** ** ** ** ** ** 
```text
Sei Codex in VS Code nel repository Next.js di PDFOrchestrator. Prima ispeziona package.json, struttura src/app, Prisma, auth, API e worker esistenti. Non sovrascrivere funzioni funzionanti; riusa convenzioni, dipendenze e librerie già installate. Implementa realmente, non solo pseudocodice. Se mancano decisioni architetturali scegli soluzioni modulari e documentale. Mantieni TypeScript strict, validazione Zod, RBAC e multi-tenant se presenti, transazioni dove necessarie. Non eseguire codice utente dinamico (eval, Function, JS arbitrario). Scrivi test automatici, esegui lint/typecheck/test disponibili e riferisci file cambiati, migrazioni, comandi e limiti.

OBIETTIVO: Inserisci pagine

Blocco pdf.page.insert con sourceFile, sourcePages, posizione before/after, pagine importate, aggiornamento mapping, output document, insertedCount e test limiti/rotazioni.

CRITERI DI ACCETTAZIONE: l implementazione è persistente, tipizzata, testata, con errori leggibili e nessun mock nel percorso produttivo.
```

## Prompt 23 — Conversione PDF/A
# ** ** ** ** ** ** ** ** ** ** ** FATTO ** ** ** ** ** ** ** ** ** ** ** 
```text
Sei Codex in VS Code nel repository Next.js di PDFOrchestrator. Prima ispeziona package.json, struttura src/app, Prisma, auth, API e worker esistenti. Non sovrascrivere funzioni funzionanti; riusa convenzioni, dipendenze e librerie già installate. Implementa realmente, non solo pseudocodice. Se mancano decisioni architetturali scegli soluzioni modulari e documentale. Mantieni TypeScript strict, validazione Zod, RBAC e multi-tenant se presenti, transazioni dove necessarie. Non eseguire codice utente dinamico (eval, Function, JS arbitrario). Scrivi test automatici, esegui lint/typecheck/test disponibili e riferisci file cambiati, migrazioni, comandi e limiti.

OBIETTIVO: Conversione PDF/A

Blocco pdf.convert.pdfa con target PDF/A-1/2/3 e livello supportato, ICC profile, verifica PDF/A tramite validatore indipendente (es. veraPDF), errori per documenti non convertibili, artifact e validationReport. Non dichiarare conformità senza verifica.

CRITERI DI ACCETTAZIONE: l implementazione è persistente, tipizzata, testata, con errori leggibili e nessun mock nel percorso produttivo.
```

## Prompt 24 — OCR intervallo
# ** ** ** ** ** ** ** ** ** ** ** FATTO ** ** ** ** ** ** ** ** ** ** ** 
```text
Sei Codex in VS Code nel repository Next.js di PDFOrchestrator. Prima ispeziona package.json, struttura src/app, Prisma, auth, API e worker esistenti. Non sovrascrivere funzioni funzionanti; riusa convenzioni, dipendenze e librerie già installate. Implementa realmente, non solo pseudocodice. Se mancano decisioni architetturali scegli soluzioni modulari e documentale. Mantieni TypeScript strict, validazione Zod, RBAC e multi-tenant se presenti, transazioni dove necessarie. Non eseguire codice utente dinamico (eval, Function, JS arbitrario). Scrivi test automatici, esegui lint/typecheck/test disponibili e riferisci file cambiati, migrazioni, comandi e limiti.

OBIETTIVO: OCR intervallo

Blocco pdf.ocr con from/to, lingua, dpi, skipExistingText, searchableOverlay, OCR worker isolato con timeout/memory limits, output PDF con text layer, optional extractedText, progress per pagina, test pagine scansite e testo selezionabile.

CRITERI DI ACCETTAZIONE: l implementazione è persistente, tipizzata, testata, con errori leggibili e nessun mock nel percorso produttivo.
```

## Prompt 25 — Normalizzazione ISO
# ** ** ** ** ** ** ** ** ** ** ** FATTO ** ** ** ** ** ** ** ** ** ** ** 
```text
Sei Codex in VS Code nel repository Next.js di PDFOrchestrator. Prima ispeziona package.json, struttura src/app, Prisma, auth, API e worker esistenti. Non sovrascrivere funzioni funzionanti; riusa convenzioni, dipendenze e librerie già installate. Implementa realmente, non solo pseudocodice. Se mancano decisioni architetturali scegli soluzioni modulari e documentale. Mantieni TypeScript strict, validazione Zod, RBAC e multi-tenant se presenti, transazioni dove necessarie. Non eseguire codice utente dinamico (eval, Function, JS arbitrario). Scrivi test automatici, esegui lint/typecheck/test disponibili e riferisci file cambiati, migrazioni, comandi e limiti.

OBIETTIVO: Normalizzazione ISO

Blocco pdf.page.normalize con ISO A3/A4/A5/A6, orientation auto, tolerancePercent in difetto, modalità EXPAND_CANVAS o SCALE_CONTENT, anchor, pageScope; confronta larghezza e altezza, non modificare pagine sopra misura, conserva contenuto e metadata compatibili, ritorna modifiedPages, skippedPages e reason. Test dimensioni in punti PDF e casi limite.

CRITERI DI ACCETTAZIONE: l implementazione è persistente, tipizzata, testata, con errori leggibili e nessun mock nel percorso produttivo.
```

## Prompt 26 — Validatore e compilatore grafo
# ** ** ** ** ** ** ** ** ** ** ** FATTO ** ** ** ** ** ** ** ** ** ** ** 
```text
Sei Codex in VS Code nel repository Next.js di PDFOrchestrator. Prima ispeziona package.json, struttura src/app, Prisma, auth, API e worker esistenti. Non sovrascrivere funzioni funzionanti; riusa convenzioni, dipendenze e librerie già installate. Implementa realmente, non solo pseudocodice. Se mancano decisioni architetturali scegli soluzioni modulari e documentale. Mantieni TypeScript strict, validazione Zod, RBAC e multi-tenant se presenti, transazioni dove necessarie. Non eseguire codice utente dinamico (eval, Function, JS arbitrario). Scrivi test automatici, esegui lint/typecheck/test disponibili e riferisci file cambiati, migrazioni, comandi e limiti.

OBIETTIVO: Validatore e compilatore grafo

Implementa validazione topologia: start/end, porte, cardinalità, reachability, scope loop, IF con rami, terminali, dipendenze dati, no cicli arbitrari. Compila draft in ExecutionPlan deterministico con istruzioni tipizzate e riferimenti handler, version/hash e manifest variabili API. No codice generato/eseguito dinamicamente. Test snapshot piano e diagnostica nodo/edge.

CRITERI DI ACCETTAZIONE: l implementazione è persistente, tipizzata, testata, con errori leggibili e nessun mock nel percorso produttivo.
```

## Prompt 27 — Generatore schema API e preview
# ** ** ** ** ** ** ** ** ** ** ** FATTO ** ** ** ** ** ** ** ** ** ** ** 
```text
Sei Codex in VS Code nel repository Next.js di PDFOrchestrator. Prima ispeziona package.json, struttura src/app, Prisma, auth, API e worker esistenti. Non sovrascrivere funzioni funzionanti; riusa convenzioni, dipendenze e librerie già installate. Implementa realmente, non solo pseudocodice. Se mancano decisioni architetturali scegli soluzioni modulari e documentale. Mantieni TypeScript strict, validazione Zod, RBAC e multi-tenant se presenti, transazioni dove necessarie. Non eseguire codice utente dinamico (eval, Function, JS arbitrario). Scrivi test automatici, esegui lint/typecheck/test disponibili e riferisci file cambiati, migrazioni, comandi e limiti.

OBIETTIVO: Generatore schema API e preview

Dai parametri binding source=api deduci input JSON Schema/OpenAPI con tipi, required, defaults, descrizioni, enum e file references; risolvi collisioni nomi, input iniziali files[], segreti mai in body, output schema e esempio curl/JSON. Mostra anteprima request/response nell’editor e segnala input non risolti prima della pubblicazione.

CRITERI DI ACCETTAZIONE: l implementazione è persistente, tipizzata, testata, con errori leggibili e nessun mock nel percorso produttivo.
```

## Prompt 28 — Pubblicazione e versioni immutabili
# ** ** ** ** ** ** ** ** ** ** ** FATTO ** ** ** ** ** ** ** ** ** ** ** 
```text
Sei Codex in VS Code nel repository Next.js di PDFOrchestrator. Prima ispeziona package.json, struttura src/app, Prisma, auth, API e worker esistenti. Non sovrascrivere funzioni funzionanti; riusa convenzioni, dipendenze e librerie già installate. Implementa realmente, non solo pseudocodice. Se mancano decisioni architetturali scegli soluzioni modulari e documentale. Mantieni TypeScript strict, validazione Zod, RBAC e multi-tenant se presenti, transazioni dove necessarie. Non eseguire codice utente dinamico (eval, Function, JS arbitrario). Scrivi test automatici, esegui lint/typecheck/test disponibili e riferisci file cambiati, migrazioni, comandi e limiti.

OBIETTIVO: Pubblicazione e versioni immutabili

Workflow draft -> validate -> compile -> test -> publish. Crea WorkflowVersion immutabile con compiledPlan e schemi, pubblicazione atomica che punta a una versione, rollback senza modificare job esistenti. Stati DRAFT/VALIDATED/PUBLISHED/ARCHIVED; audit, permessi e controllo dipendenze handler.

CRITERI DI ACCETTAZIONE: l implementazione è persistente, tipizzata, testata, con errori leggibili e nessun mock nel percorso produttivo.
```

## Prompt 29 — Credenziali API e sicurezza
# ** ** ** ** ** ** ** ** ** ** ** FATTO ** ** ** ** ** ** ** ** ** ** ** 
```text
Sei Codex in VS Code nel repository Next.js di PDFOrchestrator. Prima ispeziona package.json, struttura src/app, Prisma, auth, API e worker esistenti. Non sovrascrivere funzioni funzionanti; riusa convenzioni, dipendenze e librerie già installate. Implementa realmente, non solo pseudocodice. Se mancano decisioni architetturali scegli soluzioni modulari e documentale. Mantieni TypeScript strict, validazione Zod, RBAC e multi-tenant se presenti, transazioni dove necessarie. Non eseguire codice utente dinamico (eval, Function, JS arbitrario). Scrivi test automatici, esegui lint/typecheck/test disponibili e riferisci file cambiati, migrazioni, comandi e limiti.

OBIETTIVO: Credenziali API e sicurezza

Provisioning per batch pubblicato di clientId/keyId e secret generato una volta, hash del secret in DB, scope per tenant/workflow/versione, revoca/rotazione, rate limit e quota, log redatti, HTTPS, header autenticazione con verifica constant-time, idempotency key, limiti upload, MIME/magic bytes, antivirus se presente. Preferire credenziali in header e mai URL.

CRITERI DI ACCETTAZIONE: l implementazione è persistente, tipizzata, testata, con errori leggibili e nessun mock nel percorso produttivo.
```

## Prompt 30 — API batch e job asincroni
# ** ** ** ** ** ** ** ** ** ** ** FATTO ** ** ** ** ** ** ** ** ** ** ** 
```text
Sei Codex in VS Code nel repository Next.js di PDFOrchestrator. Prima ispeziona package.json, struttura src/app, Prisma, auth, API e worker esistenti. Non sovrascrivere funzioni funzionanti; riusa convenzioni, dipendenze e librerie già installate. Implementa realmente, non solo pseudocodice. Se mancano decisioni architetturali scegli soluzioni modulari e documentale. Mantieni TypeScript strict, validazione Zod, RBAC e multi-tenant se presenti, transazioni dove necessarie. Non eseguire codice utente dinamico (eval, Function, JS arbitrario). Scrivi test automatici, esegui lint/typecheck/test disponibili e riferisci file cambiati, migrazioni, comandi e limiti.

OBIETTIVO: API batch e job asincroni

Endpoint POST /api/public/v1/batches/{slug}/runs con credenziali e JSON schema validato, upload tramite presigned URLs o artifact refs, risposta 202 con runId e statusUrl; GET status/progress/error/output; download via URL firmata; idempotenza, 4xx/5xx coerenti, tenancy e audit. Non processare PDF pesanti nella richiesta HTTP.

CRITERI DI ACCETTAZIONE: l implementazione è persistente, tipizzata, testata, con errori leggibili e nessun mock nel percorso produttivo.
```

## Prompt 31 — Runtime worker e monitoraggio
# ** ** ** ** ** ** ** ** ** ** ** FATTO ** ** ** ** ** ** ** ** ** ** ** 
```text
Sei Codex in VS Code nel repository Next.js di PDFOrchestrator. Prima ispeziona package.json, struttura src/app, Prisma, auth, API e worker esistenti. Non sovrascrivere funzioni funzionanti; riusa convenzioni, dipendenze e librerie già installate. Implementa realmente, non solo pseudocodice. Se mancano decisioni architetturali scegli soluzioni modulari e documentale. Mantieni TypeScript strict, validazione Zod, RBAC e multi-tenant se presenti, transazioni dove necessarie. Non eseguire codice utente dinamico (eval, Function, JS arbitrario). Scrivi test automatici, esegui lint/typecheck/test disponibili e riferisci file cambiati, migrazioni, comandi e limiti.

OBIETTIVO: Runtime worker e monitoraggio

Executor che interpreta ExecutionPlan, scheduling worker queue persistente, handler registry, artifact manager, stato RUNNING/SUCCEEDED/FAILED/CANCELLED, progress per blocco/pagina, retry solo idempotenti, timeout, cancellazione, cleanup temporanei, log e metriche. Ripartenza dopo crash con checkpoint sicuri, isolamento processi OCR/QR, test errori e recovery.

CRITERI DI ACCETTAZIONE: l implementazione è persistente, tipizzata, testata, con errori leggibili e nessun mock nel percorso produttivo.
```

## Prompt 32 — Test integrati e collaudo
# ** ** ** ** ** ** ** ** ** ** ** FATTO ** ** ** ** ** ** ** ** ** ** ** 
```text
Sei Codex in VS Code nel repository Next.js di PDFOrchestrator. Prima ispeziona package.json, struttura src/app, Prisma, auth, API e worker esistenti. Non sovrascrivere funzioni funzionanti; riusa convenzioni, dipendenze e librerie già installate. Implementa realmente, non solo pseudocodice. Se mancano decisioni architetturali scegli soluzioni modulari e documentale. Mantieni TypeScript strict, validazione Zod, RBAC e multi-tenant se presenti, transazioni dove necessarie. Non eseguire codice utente dinamico (eval, Function, JS arbitrario). Scrivi test automatici, esegui lint/typecheck/test disponibili e riferisci file cambiati, migrazioni, comandi e limiti.

OBIETTIVO: Test integrati e collaudo

Crea fixture PDF di test e workflow: merge->QR all->IF->delete->OCR->normalize->PDF/A->output; test editor save/reopen, reconnect edge, publish, request API, job async, status e artifact; test accesso tenant incrociato, API key revocata, schema invalido, loop infinito, file corrotti e concorrenza. Aggiorna README e checklist deploy.

CRITERI DI ACCETTAZIONE: l implementazione è persistente, tipizzata, testata, con errori leggibili e nessun mock nel percorso produttivo.
```


## Prompt 33 — Crea pagina di esecuzione batch
# ** ** ** ** ** ** ** ** ** ** ** FATTO ** ** ** ** ** ** ** ** ** ** ** 
```text
Sei Codex in VS Code nel repository Next.js di PDFOrchestrator. Prima ispeziona package.json, struttura src/app, Prisma, auth, API e worker esistenti. Non sovrascrivere funzioni funzionanti; riusa convenzioni, dipendenze e librerie già installate. Implementa realmente, non solo pseudocodice. Se mancano decisioni architetturali scegli soluzioni modulari e documentale. Mantieni TypeScript strict, validazione Zod, RBAC e multi-tenant se presenti, transazioni dove necessarie. Non eseguire codice utente dinamico (eval, Function, JS arbitrario). Scrivi test automatici, esegui lint/typecheck/test disponibili e riferisci file cambiati, migrazioni, comandi e limiti.

OBIETTIVO: Pagina di esecuzione batch

Crea una pagina dove selezionando il file batch pubblicato, compaia in una prima colonna a sinistra il dettaglio json della chiamata per eseguire il batch; nella colonna centrale i campi richiesti come input per l'esecuzione dei files (se ci sono files singoli o multipli abilitare l'upload dei documenti su Cubbit e se sono multipli creare il pdf list), nella terza e ultima colonna a destra elencare i dati di output, se l'output sono uno o più files abilita il download.

CRITERI DI ACCETTAZIONE: l implementazione è persistente, tipizzata, testata, con errori leggibili e nessun mock nel percorso produttivo.
```

## ** ** ** ** ** ** **
Crea questo batch: in input un file pdf, cerca in ogni pagina se c'è un qr code, lo esamina e lo confronta con un record di un elenco json composto da {testo QR},{nomeQR}, elimina la pagina con il QR e alla pagina successiva imposta un segnalibro con il nome {nomeQR}, se non c'è un QR corrispondente all'elenco prosegue; alla fine salva il PDF con il nome {FileFinale} passato come parametro al batch. Utilizza le funzioni del worker già esistenti, se servono utilizza cicli, condizioni. Non utilizzare le funzioni "pdf.qr.removeMatchedPages · v1.0.0" e "pdf.output.apiName · v1.0.0", non creare altre funzioni, utilizza esclusivamente le funzioni già presenti sia per input, condizioni, elaborazioni ed output. Crea il bacth grafico e salvalo nell'organizzazione dell'utente paolo@kps.it già presente nel database.

## Prompt 34 — Crea pagina di controllo accesso ai servizi esterni e variabili di configurazione
# ** ** ** ** ** ** ** ** ** ** ** FATTO ** ** ** ** ** ** ** ** ** ** ** 
Sei Codex in VS Code nel repository Next.js di PDFOrchestrator. Prima ispeziona package.json, struttura src/app, Prisma, auth, API e worker esistenti. Non sovrascrivere funzioni funzionanti; riusa convenzioni, dipendenze e librerie già installate. Implementa realmente, non solo pseudocodice. Se mancano decisioni architetturali scegli soluzioni modulari e documentale. Mantieni TypeScript strict, validazione Zod, RBAC e multi-tenant se presenti, transazioni dove necessarie. Non eseguire codice utente dinamico (eval, Function, JS arbitrario). Scrivi test automatici, esegui lint/typecheck/test disponibili e riferisci file cambiati, migrazioni, comandi e limiti.

OBIETTIVO: Crea pagina di controllo accesso ai servizi esterni e variabili di configurazione

Crea una pagina di test di funzionamento dei servizi esterni, la pagina deve essere visibile solo agli utenti ADMIN (come la pagina utenti). La pagina deve verificare se sono configurate e leggibili tutte le variabili env e i collegamenti con i servizi esterni:
- supabase
- cubbit
- neondb
- worker
se ci sono altri collegamenti esterni che rilevi nel codice aggiungili. Metti un sistema a semaforo per tutti i parametri da verificare e scrivi anche le variabili lette e le risposte alle interrogazioni.

CRITERI DI ACCETTAZIONE: l implementazione è persistente, tipizzata, testata, con errori leggibili e nessun mock nel percorso produttivo.


# **

Crea una pagina dove selezionando il file batch pubblicato, compaia in una prima colonna a sinistra il dettaglio json della chiamata per eseguire il batch; nella colonna centrale i campi richiesti come input per l'esecuzione dei files (se ci sono files singoli o multipli abilitare l'upload dei documenti su Cubbit e se sono multipli creare il pdf list), nella terza e ultima colonna a destra elencare i dati di output, se l'output sono uno o più files abilita il download.

# **


# ** Prompt 35 - Togli salvataggio automatico script **
Sei Codex in VS Code nel repository Next.js di PDFOrchestrator. Prima ispeziona package.json, struttura src/app, Prisma, auth, API e worker esistenti. Non sovrascrivere funzioni funzionanti; riusa convenzioni, dipendenze e librerie già installate. Implementa realmente, non solo pseudocodice. Se mancano decisioni architetturali scegli soluzioni modulari e documentale. Mantieni TypeScript strict, validazione Zod, RBAC e multi-tenant se presenti, transazioni dove necessarie. Non eseguire codice utente dinamico (eval, Function, JS arbitrario). Scrivi test automatici, esegui lint/typecheck/test disponibili e riferisci file cambiati, migrazioni, comandi e limiti.
/dashboard/batches/[id]]/edit togli il salvataggio automatico ad ogni modifica, quando viene modificato qualcosa nello script colora il pulsante salva di blu più evidente, quando si esce senza salvare fai comparire il popup che chiede la conferma di non salvare oppure di salvare. Mantieni la storia delle revisioni. Aggiungi anche il pulsante "Rinomina" che fa apparire un popup per rinominare il titolo del batch. Nella barra in alto in fondo a destra aggiungi il pulsante "Esci" che torna alla pagina con l'elenco dei batch /dashboard/batches.
CRITERI DI ACCETTAZIONE: l implementazione è persistente, tipizzata, testata, con errori leggibili e nessun mock nel percorso produttivo.

# ** Prompt 36 - Visualizzazione operazione in corso
Sei Codex in VS Code nel repository Next.js di PDFOrchestrator. Prima ispeziona package.json, struttura src/app, Prisma, auth, API e worker esistenti. Non sovrascrivere funzioni funzionanti; riusa convenzioni, dipendenze e librerie già installate. Implementa realmente, non solo pseudocodice. Se mancano decisioni architetturali scegli soluzioni modulari e documentale. Mantieni TypeScript strict, validazione Zod, RBAC e multi-tenant se presenti, transazioni dove necessarie. Non eseguire codice utente dinamico (eval, Function, JS arbitrario). Scrivi test automatici, esegui lint/typecheck/test disponibili e riferisci file cambiati, migrazioni, comandi e limiti.
OBIETTIVO: Avere nella pagina di esecuzione dei batch lo stato di avanzamento del batch descrivendo tutti i parametri iniziali, interni e finali di ogni blocco con indicazione del timestamp per fare le verifiche.
Aggiungi alla pagina /dashboard/execute nella terza colonna "output" un textbox dove indicare lo stato di avanzamento del job che si sta monitorando:
- avvio job (con timestamp)
- recepimento parametri di ingresso API
per ogni blocco operativo, indicare gli input, gli output, se si creano variabili interne, se si attiva il run, se si attivano gli error schematizzando in testo e mettando i nomi dei blocchi e dei campi presenti nel batch. Utilizza una textbox RTF così puoi indicare in grassetto il cambio blocco e in sottolineato i cambi di stato. Aggiungi anche il pulsante copia per facilitare il debug e la visione del log.
CRITERI DI ACCETTAZIONE: l implementazione è persistente, tipizzata, testata, con errori leggibili e nessun mock nel percorso produttivo.