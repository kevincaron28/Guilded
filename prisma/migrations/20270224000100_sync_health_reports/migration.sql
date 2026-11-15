-- Sync health (officer view and developer alert): what a companion says about itself on an upload (records it could not send,
-- a damaged parked-uploads record). One row per companion (member credential or device key); additive, no data is changed.
CREATE TABLE "SyncHealthReport" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "ownerKey" TEXT NOT NULL,
    "memberId" TEXT,
    "parked" INTEGER NOT NULL DEFAULT 0,
    "damaged" BOOLEAN NOT NULL DEFAULT false,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncHealthReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SyncHealthReport_guildId_ownerKey_key" ON "SyncHealthReport"("guildId", "ownerKey");
CREATE INDEX "SyncHealthReport_guildId_reportedAt_idx" ON "SyncHealthReport"("guildId", "reportedAt");
