# Sviluppare uno strumento

1. Aggiungi una definizione versionata in `src/lib/blocks/registry.ts`: type, versione semantica, categoria, icona Lucide, colori, label italiana, porte tipizzate, `parametersSchema` Zod, default e capacità/handler del worker.
2. Implementa lo stesso `logicalId` e versione in `worker/pdforchestrator/tools.py`, usando `ToolContext` per limiti PDF, timeout e cancellazione.
3. Valida parametri e input, restituisci output riferimenti file/JSON serializzabili e segnala errori tipizzati senza includere dati sensibili.
4. Aggiungi test unitari e fixture riproducibili; verifica anche output PDF con pypdf.
5. Pubblica le nuove versioni di catalogo solo insieme al worker compatibile. Non modificare il comportamento di una versione già usata da batch pubblicati.

Il medesimo registry genera la palette/editor, gli endpoint del catalogo, la validazione e il piano persistito in `BatchVersion.toolManifest`. Il compiler ordina i nodi topologicamente e memorizza handler e porte per versione: aggiunte o cambi di comportamento richiedono una nuova versione del blocco. Rigenera la documentazione con `npm run docs:blocks`.

I binding parametro supportano `constant`, `api`, `node`, `variable` ed `expression`; le espressioni usano un AST allowlist in `src/lib/blocks/bindings.ts` (literal, path, confronti, logica, add, concat e if). Non vengono eseguiti JavaScript forniti dall'utente. I percorsi rifiutano proprietà prototipo e la valutazione applica limiti di profondità e nodi.

Non eseguire codice arbitrario, shell fornita dall'utente o accessi di rete non previsti. I tool pesanti restano nel worker esterno.
