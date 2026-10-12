ALTER TABLE "BatchVersion"
ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "BatchDraftRevision" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "batchName" VARCHAR(120) NOT NULL,
    "graph" JSONB NOT NULL,
    "inputSchema" JSONB NOT NULL,
    "outputSchema" JSONB NOT NULL,
    "actorId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BatchDraftRevision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BatchDraftRevision_batchId_revision_key" ON "BatchDraftRevision"("batchId", "revision");
CREATE INDEX "BatchDraftRevision_organizationId_batchId_createdAt_idx" ON "BatchDraftRevision"("organizationId", "batchId", "createdAt");
ALTER TABLE "BatchDraftRevision" ADD CONSTRAINT "BatchDraftRevision_organizationId_batchId_fkey" FOREIGN KEY ("organizationId", "batchId") REFERENCES "Batch"("organizationId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "BatchDraftRevision" ("id", "organizationId", "batchId", "revision", "batchName", "graph", "inputSchema", "outputSchema", "actorId", "createdAt")
SELECT gen_random_uuid(), b."organizationId", b."id", bv."revision", b."name", bv."graph", bv."inputSchema", bv."outputSchema", NULL, bv."createdAt"
FROM "Batch" b
JOIN "BatchVersion" bv ON bv."batchId" = b."id" AND bv."publishedAt" IS NULL
WHERE NOT EXISTS (
  SELECT 1 FROM "BatchVersion" newer
  WHERE newer."batchId" = bv."batchId" AND newer."publishedAt" IS NULL AND newer."version" > bv."version"
);
