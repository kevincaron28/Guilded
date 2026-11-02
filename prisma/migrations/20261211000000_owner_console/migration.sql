-- CreateTable
CREATE TABLE "OwnerConsole" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "channelId" TEXT,
    "boardMessageId" TEXT,
    "digestEnabled" BOOLEAN NOT NULL DEFAULT false,
    "digestLastAt" TIMESTAMP(3),
    "knownGuilds" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OwnerConsole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnerConsoleAudit" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetGuildId" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnerConsoleAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OwnerConsoleAudit_createdAt_idx" ON "OwnerConsoleAudit"("createdAt");
