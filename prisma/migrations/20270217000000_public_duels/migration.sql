-- Global duel ladder: canonical duels, their reports and device exclusions. Inert until the rating start (1 December 2026).
CREATE TABLE "PublicDuel" (
    "id" TEXT NOT NULL,
    "gameEdition" TEXT NOT NULL DEFAULT 'forever',
    "winnerKey" TEXT NOT NULL,
    "loserKey" TEXT NOT NULL,
    "winnerName" TEXT NOT NULL,
    "winnerRealm" TEXT NOT NULL DEFAULT '',
    "loserName" TEXT NOT NULL,
    "loserRealm" TEXT NOT NULL DEFAULT '',
    "winnerClass" TEXT,
    "loserClass" TEXT,
    "winnerLevel" INTEGER,
    "loserLevel" INTEGER,
    "winnerGuild" TEXT,
    "loserGuild" TEXT,
    "winnerMemberId" TEXT,
    "loserMemberId" TEXT,
    "zone" TEXT,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "durationSec" INTEGER,
    "reason" TEXT NOT NULL,
    "counted" BOOLEAN NOT NULL DEFAULT true,
    "pairKey" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "confirmations" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PublicDuel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PublicDuelReport" (
    "id" TEXT NOT NULL,
    "duelId" TEXT NOT NULL,
    "reporterKey" TEXT NOT NULL,
    "reporterCharacterKey" TEXT NOT NULL,
    "deviceId" TEXT,
    "guildId" TEXT,
    "dayKey" TEXT NOT NULL,
    "seq" INTEGER,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PublicDuelReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PublicDuelExclusion" (
    "deviceId" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PublicDuelExclusion_pkey" PRIMARY KEY ("deviceId")
);

CREATE INDEX "PublicDuel_gameEdition_counted_endedAt_idx" ON "PublicDuel"("gameEdition", "counted", "endedAt");
CREATE INDEX "PublicDuel_pairKey_dayKey_idx" ON "PublicDuel"("pairKey", "dayKey");
CREATE INDEX "PublicDuel_winnerKey_loserKey_endedAt_idx" ON "PublicDuel"("winnerKey", "loserKey", "endedAt");
CREATE UNIQUE INDEX "PublicDuelReport_duelId_reporterKey_key" ON "PublicDuelReport"("duelId", "reporterKey");
CREATE INDEX "PublicDuelReport_reporterKey_dayKey_idx" ON "PublicDuelReport"("reporterKey", "dayKey");
CREATE INDEX "PublicDuelReport_deviceId_seq_idx" ON "PublicDuelReport"("deviceId", "seq");
CREATE INDEX "PublicDuelReport_reporterCharacterKey_idx" ON "PublicDuelReport"("reporterCharacterKey");

ALTER TABLE "PublicDuelReport" ADD CONSTRAINT "PublicDuelReport_duelId_fkey" FOREIGN KEY ("duelId") REFERENCES "PublicDuel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
