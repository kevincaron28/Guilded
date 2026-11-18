-- Raid progress (services/raid-progress.ts): one boss kill by one guild.
CREATE TABLE "RaidKill" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "instanceId" INTEGER NOT NULL,
    "instanceName" TEXT NOT NULL,
    "encounterId" INTEGER NOT NULL,
    "bossName" TEXT NOT NULL,
    "difficultyId" INTEGER NOT NULL DEFAULT 0,
    "difficultyName" TEXT,
    "killedAt" TIMESTAMP(3) NOT NULL,
    "durationSec" INTEGER,
    "groupSize" INTEGER NOT NULL,
    "guildCount" INTEGER NOT NULL,
    "members" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "trust" TEXT NOT NULL DEFAULT 'member',
    "reporters" INTEGER NOT NULL DEFAULT 1,
    "valid" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RaidKill_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RaidKill_guildId_instanceId_encounterId_difficultyId_killedAt_key" ON "RaidKill"("guildId", "instanceId", "encounterId", "difficultyId", "killedAt");
CREATE INDEX "RaidKill_guildId_killedAt_idx" ON "RaidKill"("guildId", "killedAt");
CREATE INDEX "RaidKill_instanceId_encounterId_difficultyId_killedAt_idx" ON "RaidKill"("instanceId", "encounterId", "difficultyId", "killedAt");

ALTER TABLE "RaidKill" ADD CONSTRAINT "RaidKill_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
