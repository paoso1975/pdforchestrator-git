-- Additive queue fields for external, leased workers. Existing executions and data are preserved.
ALTER TYPE "ExecutionStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';
ALTER TYPE "ExecutionStatus" ADD VALUE IF NOT EXISTS 'CANCEL_REQUESTED';

ALTER TABLE "BatchExecution"
  ADD COLUMN "leaseOwner" TEXT,
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "heartbeatAt" TIMESTAMP(3),
  ADD COLUMN "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "currentStepId" TEXT,
  ADD COLUMN "pagesProcessed" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "durationMs" INTEGER,
  ADD COLUMN "cancelRequestedAt" TIMESTAMP(3);

CREATE INDEX "BatchExecution_status_runAfter_leaseExpiresAt_idx"
  ON "BatchExecution"("status", "runAfter", "leaseExpiresAt");
