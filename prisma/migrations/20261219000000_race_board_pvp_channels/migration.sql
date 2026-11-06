-- 8.5 track B: Race to 60 board and the PvP channel module. Additive only. Owner decision (6 Nov 2026): new 8.5 features are on
-- by default in every server; boards post only once their channel exists (created or adopted by /setup). Officers switch them off.
ALTER TABLE "GuildSettings" ADD COLUMN "raceBoardEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "GuildSettings" ADD COLUMN "raceBoardChannelId" TEXT;
ALTER TABLE "GuildSettings" ADD COLUMN "raceBoardMessageId" TEXT;
ALTER TABLE "GuildSettings" ADD COLUMN "pvpModuleEnabled" BOOLEAN NOT NULL DEFAULT true;
-- The 8.4.6 duel board (the PvP ladder) follows the same rule; it still needs the statistics channel to post.
ALTER TABLE "GuildSettings" ALTER COLUMN "duelBoardEnabled" SET DEFAULT true;
UPDATE "GuildSettings" SET "duelBoardEnabled" = true;
ALTER TABLE "Member" ADD COLUMN "raceHidden" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "LevelRaceEntry" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "className" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "reachedMaxAt" TIMESTAMP(3),
    "weekStartLevel" INTEGER NOT NULL,
    "weekStartedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LevelRaceEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LevelRaceEntry_guildId_nameKey_key" ON "LevelRaceEntry"("guildId", "nameKey");
ALTER TABLE "LevelRaceEntry" ADD CONSTRAINT "LevelRaceEntry_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
