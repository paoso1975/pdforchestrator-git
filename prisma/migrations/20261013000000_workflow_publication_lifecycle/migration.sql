ALTER TYPE "WorkflowStatus" ADD VALUE IF NOT EXISTS 'VALIDATED';

ALTER TABLE "WorkflowDraft"
  ADD COLUMN "compiledPlan" JSONB,
  ADD COLUMN "hash" CHAR(64),
  ADD COLUMN "validatedAt" TIMESTAMP(3);

DROP INDEX IF EXISTS "WorkflowPublication_organizationId_workflowId_workflowVersi_key";
CREATE INDEX "WorkflowPublication_organizationId_workflowId_workflowVersionId_idx"
  ON "WorkflowPublication"("organizationId", "workflowId", "workflowVersionId");
