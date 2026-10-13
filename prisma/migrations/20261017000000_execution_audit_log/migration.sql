CREATE TYPE "ExecutionOrigin" AS ENUM ('DASHBOARD_SESSION', 'API_CREDENTIAL');

ALTER TABLE "BatchExecution"
  ADD COLUMN "requestedByUserId" UUID,
  ADD COLUMN "origin" "ExecutionOrigin" NOT NULL DEFAULT 'DASHBOARD_SESSION',
  ADD COLUMN "requestId" VARCHAR(128),
  ADD COLUMN "requestMethod" VARCHAR(10),
  ADD COLUMN "requestPath" VARCHAR(2048),
  ADD COLUMN "executionString" TEXT NOT NULL DEFAULT '';

UPDATE "BatchExecution"
SET "origin" = 'API_CREDENTIAL'
WHERE "credentialId" IS NOT NULL;

ALTER TABLE "BatchExecution"
  ADD CONSTRAINT "BatchExecution_requestedByUserId_fkey"
  FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "BatchExecution_requestedByUserId_createdAt_idx" ON "BatchExecution"("requestedByUserId", "createdAt");
CREATE INDEX "BatchExecution_origin_createdAt_idx" ON "BatchExecution"("origin", "createdAt");

ALTER TABLE "StepExecution"
  ADD COLUMN "parameters" JSONB,
  ADD COLUMN "variablesIn" JSONB,
  ADD COLUMN "variablesOut" JSONB,
  ADD COLUMN "executionString" TEXT;
