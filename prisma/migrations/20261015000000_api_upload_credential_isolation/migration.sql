ALTER TABLE "StoredFile" ADD COLUMN "credentialId" UUID;
CREATE INDEX "StoredFile_organizationId_credentialId_kind_createdAt_idx"
  ON "StoredFile"("organizationId", "credentialId", "kind", "createdAt");
ALTER TABLE "StoredFile"
  ADD CONSTRAINT "StoredFile_organizationId_credentialId_fkey"
  FOREIGN KEY ("organizationId", "credentialId")
  REFERENCES "ApiCredential"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP INDEX IF EXISTS "BatchExecution_organizationId_idempotencyKey_key";
CREATE UNIQUE INDEX "BatchExecution_credentialId_idempotencyKey_key"
  ON "BatchExecution"("credentialId", "idempotencyKey");
