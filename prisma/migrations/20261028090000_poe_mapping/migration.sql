ALTER TABLE "GuildSettings" ADD COLUMN "poeTrackingEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "PoeMapVisit" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "runRef" TEXT NOT NULL,
    "character" TEXT NOT NULL,
    "league" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "areaLevel" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "durationSeconds" INTEGER,
    "endReason" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'CLIENT_LOG',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PoeMapVisit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PoeMapVisit_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PoeMapVisit_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PoeMapVisit_observation_check" CHECK (
        "areaLevel" BETWEEN 1 AND 100 AND "endedAt" >= "startedAt"
        AND "endReason" IN ('AREA_CHANGED', 'INTERRUPTED')
        AND "mode" IN ('STANDARD', 'HARDCORE', 'SSF', 'SSF_HARDCORE')
        AND ("durationSeconds" IS NULL OR ("durationSeconds" BETWEEN 0 AND 21600 AND "endReason" = 'AREA_CHANGED'))
    )
);
CREATE UNIQUE INDEX "PoeMapVisit_guildId_memberId_runRef_key" ON "PoeMapVisit"("guildId", "memberId", "runRef");
CREATE INDEX "PoeMapVisit_guildId_league_mode_startedAt_idx" ON "PoeMapVisit"("guildId", "league", "mode", "startedAt");
CREATE INDEX "PoeMapVisit_memberId_startedAt_idx" ON "PoeMapVisit"("memberId", "startedAt");
