-- 8.5 track C5: promotion panel (Initiate -> Member). Additive; on by default (owner decision, 6 November 2026).
ALTER TABLE "GuildSettings" ADD COLUMN "promotionEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "GuildSettings" ADD COLUMN "promotionFromRank" TEXT NOT NULL DEFAULT 'Initiate';
ALTER TABLE "GuildSettings" ADD COLUMN "promotionMinDays" INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "GuildSettings" ADD COLUMN "promotionMinLevel" INTEGER;
ALTER TABLE "GuildSettings" ADD COLUMN "promotionWeeklyEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "GuildSettings" ADD COLUMN "promotionChannelId" TEXT;
ALTER TABLE "GuildSettings" ADD COLUMN "promotionLastPostAt" TIMESTAMP(3);
ALTER TABLE "UnclaimedCharacter" ADD COLUMN "guildRankName" TEXT;
ALTER TABLE "UnclaimedCharacter" ADD COLUMN "guildRankAt" TIMESTAMP(3);

CREATE TABLE "CharacterRankSeen" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "rankName" TEXT NOT NULL,
    "since" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CharacterRankSeen_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CharacterRankSeen_characterId_key" ON "CharacterRankSeen"("characterId");
ALTER TABLE "CharacterRankSeen" ADD CONSTRAINT "CharacterRankSeen_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
