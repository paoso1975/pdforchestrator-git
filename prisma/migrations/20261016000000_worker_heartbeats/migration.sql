CREATE TABLE "WorkerHeartbeat" (
    "workerId" VARCHAR(160) NOT NULL,
    "version" VARCHAR(80),
    "concurrency" INTEGER NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("workerId")
);

CREATE INDEX "WorkerHeartbeat_lastSeenAt_idx" ON "WorkerHeartbeat"("lastSeenAt");
