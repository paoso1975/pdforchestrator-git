CREATE TABLE "UserProfile" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "displayName" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserProfile_email_key" ON "UserProfile"("email");
CREATE INDEX "UserProfile_role_createdAt_idx" ON "UserProfile"("role", "createdAt");
