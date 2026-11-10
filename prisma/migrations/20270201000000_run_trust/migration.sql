-- Dungeon run trust (docs/plans/RUN_TRUST_2026-11-10.md): a run from unsigned companions counts by
-- corroboration. Existing runs keep trust NULL (treated as a member's upload, as before).
-- Owner's choice, not run here: mark the runs unsigned companions stored since 9.1.1 as "device":
--   UPDATE "DungeonRun" SET "trust" = 'device' WHERE "importId" IS NULL AND "createdAt" >= '2026-11-09' AND "runRef" NOT LIKE 'SIM-%';
ALTER TABLE "DungeonRun" ADD COLUMN "trust" TEXT;

CREATE TABLE "DungeonRunWitness" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "runRef" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "voucher" TEXT NOT NULL,
    "instanceId" INTEGER NOT NULL,
    "difficultyId" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "players" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bosses" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "payload" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "trust" TEXT,
    "reason" TEXT,
    "runId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "DungeonRunWitness_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DungeonRunWitness_guildId_runRef_deviceId_key" ON "DungeonRunWitness"("guildId", "runRef", "deviceId");
CREATE INDEX "DungeonRunWitness_guildId_instanceId_endedAt_idx" ON "DungeonRunWitness"("guildId", "instanceId", "endedAt");
CREATE INDEX "DungeonRunWitness_deviceId_status_idx" ON "DungeonRunWitness"("deviceId", "status");
ALTER TABLE "DungeonRunWitness" ADD CONSTRAINT "DungeonRunWitness_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "CompanionDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "GuildNameAlias" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "realm" TEXT NOT NULL DEFAULT '',
    "seen" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuildNameAlias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GuildNameAlias_guildId_nameKey_key" ON "GuildNameAlias"("guildId", "nameKey");
