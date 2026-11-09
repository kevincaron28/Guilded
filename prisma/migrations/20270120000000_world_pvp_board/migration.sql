-- 9.1 world PvP board (docs/WORLD_PVP.md stage 2 and 3): weekly open-world kills, defends and calls answered per member,
-- shown on the PvP ladder message. On by default, officers can turn it off.
ALTER TABLE "GuildSettings" ADD COLUMN "worldPvpEnabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "WorldPvpWeek" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "weekKey" INTEGER NOT NULL,
    "kills" INTEGER NOT NULL DEFAULT 0,
    "defends" INTEGER NOT NULL DEFAULT 0,
    "helped" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorldPvpWeek_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorldPvpWeek_guildId_memberId_weekKey_key" ON "WorldPvpWeek"("guildId", "memberId", "weekKey");
CREATE INDEX "WorldPvpWeek_guildId_weekKey_idx" ON "WorldPvpWeek"("guildId", "weekKey");
ALTER TABLE "WorldPvpWeek" ADD CONSTRAINT "WorldPvpWeek_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorldPvpWeek" ADD CONSTRAINT "WorldPvpWeek_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
