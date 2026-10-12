ALTER TABLE "ApiCredential"
  ADD COLUMN "keyId" TEXT,
  ADD COLUMN "secretCiphertext" TEXT,
  ADD COLUMN "secretIv" TEXT,
  ADD COLUMN "secretAuthTag" TEXT,
  ADD COLUMN "secretKeyVersion" INTEGER;
CREATE UNIQUE INDEX "ApiCredential_keyId_key" ON "ApiCredential"("keyId");
CREATE TABLE "ApiRequestNonce" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "credentialId" UUID NOT NULL,
  "nonce" VARCHAR(128) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApiRequestNonce_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ApiRequestNonce_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "ApiCredential"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ApiRequestNonce_credentialId_nonce_key" ON "ApiRequestNonce"("credentialId", "nonce");
CREATE INDEX "ApiRequestNonce_expiresAt_idx" ON "ApiRequestNonce"("expiresAt");
CREATE TABLE "ApiRateBucket" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "credentialId" UUID NOT NULL,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "requestCount" INTEGER NOT NULL DEFAULT 0,
  "jobCount" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ApiRateBucket_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ApiRateBucket_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "ApiCredential"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ApiRateBucket_credentialId_windowStart_key" ON "ApiRateBucket"("credentialId", "windowStart");
CREATE INDEX "ApiRateBucket_windowStart_idx" ON "ApiRateBucket"("windowStart");
ALTER TABLE "StoredFile" ADD COLUMN "expectedSizeBytes" BIGINT, ADD COLUMN "uploadState" TEXT NOT NULL DEFAULT 'UPLOADED', ADD COLUMN "uploadId" TEXT, ADD COLUMN "retentionLeaseUntil" TIMESTAMP(3), ADD COLUMN "retentionLeaseOwner" TEXT;
ALTER TABLE "WebhookEndpoint" ADD COLUMN "secretIv" TEXT, ADD COLUMN "secretAuthTag" TEXT, ADD COLUMN "secretKeyVersion" INTEGER;
ALTER TABLE "WebhookDelivery" ADD COLUMN "leaseExpiresAt" TIMESTAMP(3), ADD COLUMN "leaseOwner" TEXT;
