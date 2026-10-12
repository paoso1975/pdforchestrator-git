# Public API deployment checklist

## Vercel environment

Add server-only variables for each Vercel environment: `DATABASE_URL` (Neon pooled runtime URL), `DIRECT_URL` (Neon direct migration URL), `DATABASE_POOL_MAX` within the provider's connection cap, `PFO_CREDENTIAL_MASTER_KEY` (base64 encoding of exactly 32 random bytes), `WORKER_SHARED_SECRET`, and the `S3_*` Cubbit values. Never prefix keys with `NEXT_PUBLIC_`. Keep the master key stable for credentials already stored; losing it makes their HMAC Secrets undecryptable. Worker host credentials are separate and belong only in `worker/.env`.

The API defaults are 120 requests/minute and 30 job requests/minute per credential, 10 concurrent jobs per credential, 100 MiB per PDF, 10 GiB organization storage and 30-day file retention. Set `PFO_RATE_LIMIT_RPM`, `PFO_JOB_LIMIT_RPM`, `PFO_MAX_CONCURRENT_JOBS`, `PFO_MAX_UPLOAD_BYTES`, `PFO_ORG_STORAGE_QUOTA_BYTES` and `PFO_RETENTION_DAYS` to match your tenant plan. The external worker must use the same `WORKER_SHARED_SECRET`; it processes PDF jobs, webhook retries and retention deletions.

Secrets use CSPRNG, their SHA-256 digest is stored for legacy token lookup, and HMAC Secrets are stored encrypted with AES-256-GCM because the server must recover the signing key to verify each request. The master key is never sent to the client. Secrets are returned only in the create/rotate response. Rate limits and idempotency are persisted in PostgreSQL. `ApiCredentialGrant.batchVersionIds` is an exact published-version allow-list; an empty list means all published versions in that batch. Input uploads are isolated to the credential that created them, checked against size, object metadata and the `%PDF-` magic prefix, and the worker recalculates SHA-256 before parsing. No antivirus executable is currently configured in the repository; worker PDF parsing still applies file, page, encryption, timeout and resource limits.

## Domain and database rollout

Assign `api.pdforchestrator.com` to this Vercel project and configure its DNS records as Vercel specifies. `/v1/*` maps directly to Node.js Route Handlers and is also the canonical path signed by clients. The default `*.vercel.app` URL works the same way.

Before rollout, verify `DATABASE_URL` and `DIRECT_URL` point to the intended Neon instance and that the correct database backup exists. Then apply only the additive migrations:

```sh
npx prisma migrate deploy
npx prisma migrate status
```

Do not run `migrate reset` or point this deployment at another provider's database. Apply migrations before deploying code that uses the new columns and tables. No database migration is executed by this repository's build.

## Direct uploads

Native clients PUT to short-lived presigned Cubbit URLs; files do not pass through Vercel. Uploads above 8 MiB use multipart parts with per-part signed URLs. Browser uploads need Cubbit bucket CORS, which its documented S3 endpoint currently does not support; use a native client until that capability is available. Worker retention requires `DeleteObject` and `AbortMultipartUpload` on the configured bucket prefixes.

Webhook destinations must be HTTPS on port 443 and resolve to public addresses. Redirects are disabled at delivery; the worker rechecks DNS before each request. Configure network egress restrictions on the worker host as an additional boundary.
