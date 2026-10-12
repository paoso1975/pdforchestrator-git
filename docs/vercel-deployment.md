# Deployment Vercel

Importa il repository e lascia che Vercel rilevi Next.js. Non impostare Output Directory: usare il default Next.js. Build Command `npm run build` (lo script esegue `prisma generate && next build`); Install Command default `npm install`/lockfile. Node.js runtime è esplicito `nodejs` sulle route che usano Prisma, S3 e crypto. Non inserire `prisma migrate deploy` nella build.

Configura in Vercel per Preview/Production le variabili server-side necessarie: `DATABASE_URL` (pooler Neon), `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` solo se admin API abilitate, `NEXT_PUBLIC_SITE_URL`, `PUBLIC_API_URL`, valori Cubbit server, `PFO_CREDENTIAL_MASTER_KEY`, `WORKER_SHARED_SECRET`, limiti rate/storage e retention. `DIRECT_URL` è necessario solo all'ambiente operativo che esegue migrazioni, non alle richieste runtime; se configurato su Vercel, limitarne l'accesso e non usarlo nel client.

Dominio UI: configurare nel progetto Vercel e in Supabase Auth redirect URL. Dominio API `api.pdforchestrator.com`: assegnarlo allo stesso progetto e configurare DNS secondo i valori mostrati nel dashboard Vercel; `PUBLIC_API_URL` deve usare il dominio effettivamente attivo. Nessuna modifica DNS/deploy viene fatta da questo repository.

Verificare build logs e runtime logs senza registrare headers HMAC, cookie, URL firmate o secret. `x-request-id` viene propagato/generato dal proxy per correlare richieste. Le migrazioni restano operazione esplicita separata dopo backup e review.
