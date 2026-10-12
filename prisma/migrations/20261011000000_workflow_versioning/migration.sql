CREATE TYPE "WorkflowStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "WorkflowRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCEL_REQUESTED', 'CANCELLED');
CREATE TYPE "WorkflowNodeRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED');

CREATE TABLE "Workflow" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "status" "WorkflowStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "activeVersionId" UUID,
    "createdById" UUID,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Workflow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkflowDraft" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "workflowId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "nodes" JSONB NOT NULL,
    "edges" JSONB NOT NULL,
    "viewport" JSONB NOT NULL,
    "inputSchema" JSONB NOT NULL,
    "outputSchema" JSONB NOT NULL,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkflowDraft_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkflowVersion" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "workflowId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "nodes" JSONB NOT NULL,
    "edges" JSONB NOT NULL,
    "viewport" JSONB NOT NULL,
    "compiledPlan" JSONB NOT NULL,
    "inputSchema" JSONB NOT NULL,
    "outputSchema" JSONB NOT NULL,
    "hash" CHAR(64) NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkflowVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkflowPublication" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "workflowId" UUID NOT NULL,
    "workflowVersionId" UUID NOT NULL,
    "publishedById" UUID,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "WorkflowPublication_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkflowCredentialGrant" (
    "organizationId" UUID NOT NULL,
    "workflowId" UUID NOT NULL,
    "credentialId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkflowCredentialGrant_pkey" PRIMARY KEY ("organizationId", "workflowId", "credentialId")
);

CREATE TABLE "WorkflowRun" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "workflowId" UUID NOT NULL,
    "workflowVersionId" UUID NOT NULL,
    "credentialId" UUID,
    "status" "WorkflowRunStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "error" JSONB,
    "idempotencyKey" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "currentNodeId" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkflowNodeRun" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "workflowRunId" UUID NOT NULL,
    "nodeId" VARCHAR(200) NOT NULL,
    "toolId" VARCHAR(200) NOT NULL,
    "toolVersion" VARCHAR(64) NOT NULL,
    "status" "WorkflowNodeRunStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "input" JSONB,
    "output" JSONB,
    "error" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "WorkflowNodeRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkflowArtifact" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "workflowRunId" UUID NOT NULL,
    "nodeRunId" UUID,
    "bucket" VARCHAR(255) NOT NULL,
    "objectKey" VARCHAR(1024) NOT NULL,
    "filename" VARCHAR(255) NOT NULL,
    "mimeType" VARCHAR(255) NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    CONSTRAINT "WorkflowArtifact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "workflowId" UUID,
    "actorId" UUID,
    "action" VARCHAR(120) NOT NULL,
    "resourceType" VARCHAR(80) NOT NULL,
    "resourceId" VARCHAR(200),
    "requestId" VARCHAR(128),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Workflow_activeVersionId_key" ON "Workflow"("activeVersionId");
CREATE UNIQUE INDEX "Workflow_organizationId_slug_key" ON "Workflow"("organizationId", "slug");
CREATE UNIQUE INDEX "Workflow_organizationId_id_key" ON "Workflow"("organizationId", "id");
CREATE UNIQUE INDEX "Workflow_organizationId_id_activeVersionId_key" ON "Workflow"("organizationId", "id", "activeVersionId");
CREATE INDEX "Workflow_organizationId_status_updatedAt_idx" ON "Workflow"("organizationId", "status", "updatedAt");
CREATE UNIQUE INDEX "WorkflowDraft_workflowId_key" ON "WorkflowDraft"("workflowId");
CREATE UNIQUE INDEX "WorkflowDraft_organizationId_workflowId_revision_key" ON "WorkflowDraft"("organizationId", "workflowId", "revision");
CREATE INDEX "WorkflowDraft_organizationId_updatedAt_idx" ON "WorkflowDraft"("organizationId", "updatedAt");
CREATE UNIQUE INDEX "WorkflowVersion_workflowId_version_key" ON "WorkflowVersion"("workflowId", "version");
CREATE UNIQUE INDEX "WorkflowVersion_organizationId_workflowId_id_key" ON "WorkflowVersion"("organizationId", "workflowId", "id");
CREATE INDEX "WorkflowVersion_organizationId_workflowId_createdAt_idx" ON "WorkflowVersion"("organizationId", "workflowId", "createdAt");
CREATE UNIQUE INDEX "WorkflowPublication_organizationId_workflowId_workflowVersi_key" ON "WorkflowPublication"("organizationId", "workflowId", "workflowVersionId");
CREATE INDEX "WorkflowPublication_organizationId_workflowId_publishedAt_idx" ON "WorkflowPublication"("organizationId", "workflowId", "publishedAt");
CREATE INDEX "WorkflowCredentialGrant_organizationId_credentialId_idx" ON "WorkflowCredentialGrant"("organizationId", "credentialId");
CREATE UNIQUE INDEX "WorkflowRun_organizationId_idempotencyKey_key" ON "WorkflowRun"("organizationId", "idempotencyKey");
CREATE UNIQUE INDEX "WorkflowRun_organizationId_id_key" ON "WorkflowRun"("organizationId", "id");
CREATE INDEX "WorkflowRun_organizationId_status_createdAt_idx" ON "WorkflowRun"("organizationId", "status", "createdAt");
CREATE INDEX "WorkflowRun_status_leaseExpiresAt_createdAt_idx" ON "WorkflowRun"("status", "leaseExpiresAt", "createdAt");
CREATE INDEX "WorkflowRun_organizationId_workflowId_createdAt_idx" ON "WorkflowRun"("organizationId", "workflowId", "createdAt");
CREATE UNIQUE INDEX "WorkflowNodeRun_workflowRunId_nodeId_key" ON "WorkflowNodeRun"("workflowRunId", "nodeId");
CREATE UNIQUE INDEX "WorkflowNodeRun_organizationId_workflowRunId_id_key" ON "WorkflowNodeRun"("organizationId", "workflowRunId", "id");
CREATE INDEX "WorkflowNodeRun_organizationId_workflowRunId_status_idx" ON "WorkflowNodeRun"("organizationId", "workflowRunId", "status");
CREATE UNIQUE INDEX "WorkflowArtifact_bucket_objectKey_key" ON "WorkflowArtifact"("bucket", "objectKey");
CREATE INDEX "WorkflowArtifact_organizationId_workflowRunId_createdAt_idx" ON "WorkflowArtifact"("organizationId", "workflowRunId", "createdAt");
CREATE INDEX "WorkflowArtifact_expiresAt_idx" ON "WorkflowArtifact"("expiresAt");
CREATE INDEX "AuditEvent_organizationId_createdAt_idx" ON "AuditEvent"("organizationId", "createdAt");
CREATE INDEX "AuditEvent_organizationId_workflowId_createdAt_idx" ON "AuditEvent"("organizationId", "workflowId", "createdAt");
CREATE INDEX "AuditEvent_actorId_createdAt_idx" ON "AuditEvent"("actorId", "createdAt");
CREATE UNIQUE INDEX "ApiCredential_organizationId_id_key" ON "ApiCredential"("organizationId", "id");

ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkflowDraft" ADD CONSTRAINT "WorkflowDraft_organizationId_workflowId_fkey" FOREIGN KEY ("organizationId", "workflowId") REFERENCES "Workflow"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkflowVersion" ADD CONSTRAINT "WorkflowVersion_organizationId_workflowId_fkey" FOREIGN KEY ("organizationId", "workflowId") REFERENCES "Workflow"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkflowPublication" ADD CONSTRAINT "WorkflowPublication_organizationId_workflowId_fkey" FOREIGN KEY ("organizationId", "workflowId") REFERENCES "Workflow"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkflowPublication" ADD CONSTRAINT "WorkflowPublication_organizationId_workflowId_workflowVers_fkey" FOREIGN KEY ("organizationId", "workflowId", "workflowVersionId") REFERENCES "WorkflowVersion"("organizationId", "workflowId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkflowCredentialGrant" ADD CONSTRAINT "WorkflowCredentialGrant_organizationId_workflowId_fkey" FOREIGN KEY ("organizationId", "workflowId") REFERENCES "Workflow"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkflowCredentialGrant" ADD CONSTRAINT "WorkflowCredentialGrant_organizationId_credentialId_fkey" FOREIGN KEY ("organizationId", "credentialId") REFERENCES "ApiCredential"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_organizationId_workflowId_fkey" FOREIGN KEY ("organizationId", "workflowId") REFERENCES "Workflow"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_organizationId_workflowId_workflowVersionId_fkey" FOREIGN KEY ("organizationId", "workflowId", "workflowVersionId") REFERENCES "WorkflowVersion"("organizationId", "workflowId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_organizationId_credentialId_fkey" FOREIGN KEY ("organizationId", "credentialId") REFERENCES "ApiCredential"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkflowNodeRun" ADD CONSTRAINT "WorkflowNodeRun_organizationId_workflowRunId_fkey" FOREIGN KEY ("organizationId", "workflowRunId") REFERENCES "WorkflowRun"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkflowArtifact" ADD CONSTRAINT "WorkflowArtifact_organizationId_workflowRunId_fkey" FOREIGN KEY ("organizationId", "workflowRunId") REFERENCES "WorkflowRun"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkflowArtifact" ADD CONSTRAINT "WorkflowArtifact_organizationId_workflowRunId_nodeRunId_fkey" FOREIGN KEY ("organizationId", "workflowRunId", "nodeRunId") REFERENCES "WorkflowNodeRun"("organizationId", "workflowRunId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organizationId_workflowId_fkey" FOREIGN KEY ("organizationId", "workflowId") REFERENCES "Workflow"("organizationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_organizationId_id_activeVersionId_fkey" FOREIGN KEY ("organizationId", "id", "activeVersionId") REFERENCES "WorkflowVersion"("organizationId", "workflowId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "prevent_workflow_version_mutation"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'WorkflowVersion rows are immutable' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "WorkflowVersion_immutable" BEFORE UPDATE OR DELETE ON "WorkflowVersion"
FOR EACH ROW EXECUTE FUNCTION "prevent_workflow_version_mutation"();
