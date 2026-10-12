-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'DESIGNER', 'OPERATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StepExecutionStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "StoredFileKind" AS ENUM ('INPUT', 'INTERMEDIATE', 'OUTPUT');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT,
    "displayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationMembership" (
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationMembership_pkey" PRIMARY KEY ("organizationId","userId")
);

-- CreateTable
CREATE TABLE "Batch" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "status" "BatchStatus" NOT NULL DEFAULT 'DRAFT',
    "activeVersionId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchVersion" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "graph" JSONB NOT NULL,
    "inputSchema" JSONB NOT NULL,
    "outputSchema" JSONB NOT NULL,
    "toolManifest" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "configHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BatchVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolDefinition" (
    "id" UUID NOT NULL,
    "logicalId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "runtime" TEXT NOT NULL,
    "inputPorts" JSONB NOT NULL,
    "outputPorts" JSONB NOT NULL,
    "parametersSchema" JSONB NOT NULL,
    "timeoutSeconds" INTEGER NOT NULL DEFAULT 60,
    "resourceClass" TEXT NOT NULL DEFAULT 'standard',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ToolDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiCredential" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiCredentialGrant" (
    "credentialId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiCredentialGrant_pkey" PRIMARY KEY ("credentialId","batchId")
);

-- CreateTable
CREATE TABLE "BatchExecution" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "batchVersionId" UUID NOT NULL,
    "credentialId" UUID,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "idempotencyKey" TEXT,
    "error" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "BatchExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StepExecution" (
    "id" UUID NOT NULL,
    "executionId" UUID NOT NULL,
    "nodeId" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "toolVersion" TEXT NOT NULL,
    "status" "StepExecutionStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "input" JSONB,
    "output" JSONB,
    "error" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "StepExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionEvent" (
    "id" UUID NOT NULL,
    "executionId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoredFile" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "bucket" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "sha256" TEXT NOT NULL,
    "kind" "StoredFileKind" NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEndpoint" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "eventTypes" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" UUID NOT NULL,
    "endpointId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "OrganizationMembership_userId_createdAt_idx" ON "OrganizationMembership"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Batch_activeVersionId_key" ON "Batch"("activeVersionId");

-- CreateIndex
CREATE INDEX "Batch_organizationId_status_updatedAt_idx" ON "Batch"("organizationId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Batch_organizationId_slug_key" ON "Batch"("organizationId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Batch_organizationId_id_key" ON "Batch"("organizationId", "id");

-- CreateIndex
CREATE INDEX "BatchVersion_batchId_publishedAt_idx" ON "BatchVersion"("batchId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BatchVersion_batchId_version_key" ON "BatchVersion"("batchId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "BatchVersion_batchId_id_key" ON "BatchVersion"("batchId", "id");

-- CreateIndex
CREATE INDEX "ToolDefinition_enabled_category_logicalId_idx" ON "ToolDefinition"("enabled", "category", "logicalId");

-- CreateIndex
CREATE UNIQUE INDEX "ToolDefinition_logicalId_version_key" ON "ToolDefinition"("logicalId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ApiCredential_tokenHash_key" ON "ApiCredential"("tokenHash");

-- CreateIndex
CREATE INDEX "ApiCredential_organizationId_revokedAt_idx" ON "ApiCredential"("organizationId", "revokedAt");

-- CreateIndex
CREATE INDEX "ApiCredentialGrant_batchId_idx" ON "ApiCredentialGrant"("batchId");

-- CreateIndex
CREATE INDEX "BatchExecution_organizationId_status_createdAt_idx" ON "BatchExecution"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "BatchExecution_batchId_createdAt_idx" ON "BatchExecution"("batchId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BatchExecution_organizationId_idempotencyKey_key" ON "BatchExecution"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "StepExecution_executionId_status_idx" ON "StepExecution"("executionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StepExecution_executionId_nodeId_key" ON "StepExecution"("executionId", "nodeId");

-- CreateIndex
CREATE INDEX "ExecutionEvent_executionId_createdAt_idx" ON "ExecutionEvent"("executionId", "createdAt");

-- CreateIndex
CREATE INDEX "StoredFile_organizationId_kind_createdAt_idx" ON "StoredFile"("organizationId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "StoredFile_expiresAt_idx" ON "StoredFile"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "StoredFile_bucket_objectKey_key" ON "StoredFile"("bucket", "objectKey");

-- CreateIndex
CREATE INDEX "WebhookEndpoint_organizationId_enabled_idx" ON "WebhookEndpoint"("organizationId", "enabled");

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_endpointId_createdAt_idx" ON "WebhookDelivery"("endpointId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_endpointId_eventId_key" ON "WebhookDelivery"("endpointId", "eventId");

-- AddForeignKey
ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMembership" ADD CONSTRAINT "OrganizationMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_activeVersionId_fkey" FOREIGN KEY ("activeVersionId") REFERENCES "BatchVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchVersion" ADD CONSTRAINT "BatchVersion_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiCredential" ADD CONSTRAINT "ApiCredential_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiCredentialGrant" ADD CONSTRAINT "ApiCredentialGrant_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "ApiCredential"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiCredentialGrant" ADD CONSTRAINT "ApiCredentialGrant_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchExecution" ADD CONSTRAINT "BatchExecution_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchExecution" ADD CONSTRAINT "BatchExecution_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchExecution" ADD CONSTRAINT "BatchExecution_batchVersionId_fkey" FOREIGN KEY ("batchVersionId") REFERENCES "BatchVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchExecution" ADD CONSTRAINT "BatchExecution_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "ApiCredential"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepExecution" ADD CONSTRAINT "StepExecution_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "BatchExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutionEvent" ADD CONSTRAINT "ExecutionEvent_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "BatchExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Published version content cannot be edited in place. New configuration requires a new version.
CREATE FUNCTION "reject_published_batch_version_update"() RETURNS trigger AS $$
BEGIN
    IF OLD."publishedAt" IS NOT NULL THEN
        RAISE EXCEPTION 'Published batch versions are immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "BatchVersion_immutable_published"
BEFORE UPDATE ON "BatchVersion"
FOR EACH ROW EXECUTE FUNCTION "reject_published_batch_version_update"();
