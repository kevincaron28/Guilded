-- Open-world kills and deaths with their place (addon 9.3.2 "pvp-events"): additive, nothing existing changes.
-- Undo: DROP TABLE "WorldPvpEvent";
CREATE TABLE "WorldPvpEvent" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "weekKey" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "mapId" INTEGER NOT NULL,
    "x" DOUBLE PRECISION,
    "y" DOUBLE PRECISION,
    "approx" BOOLEAN NOT NULL DEFAULT false,
    "eventId" INTEGER NOT NULL,

    CONSTRAINT "WorldPvpEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorldPvpEvent_memberId_eventId_at_key" ON "WorldPvpEvent"("memberId", "eventId", "at");
CREATE INDEX "WorldPvpEvent_guildId_at_idx" ON "WorldPvpEvent"("guildId", "at");
CREATE INDEX "WorldPvpEvent_guildId_weekKey_idx" ON "WorldPvpEvent"("guildId", "weekKey");

ALTER TABLE "WorldPvpEvent" ADD CONSTRAINT "WorldPvpEvent_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorldPvpEvent" ADD CONSTRAINT "WorldPvpEvent_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
