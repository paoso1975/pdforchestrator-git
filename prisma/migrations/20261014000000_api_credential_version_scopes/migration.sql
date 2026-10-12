ALTER TABLE "ApiCredentialGrant"
  ADD COLUMN "batchVersionIds" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];

ALTER TABLE "WorkflowCredentialGrant"
  ADD COLUMN "workflowVersionIds" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];
