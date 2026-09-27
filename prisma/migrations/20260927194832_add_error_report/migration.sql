-- CreateTable
CREATE TABLE "ErrorReport" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "guildId" TEXT,
    "userId" TEXT,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "context" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErrorReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ErrorReport_source_createdAt_idx" ON "ErrorReport"("source", "createdAt");

-- CreateIndex
CREATE INDEX "ErrorReport_guildId_createdAt_idx" ON "ErrorReport"("guildId", "createdAt");
