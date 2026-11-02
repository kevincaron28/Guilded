CREATE TABLE "MemberAchievement" (
 "id" TEXT PRIMARY KEY, "guildId" TEXT NOT NULL, "memberId" TEXT NOT NULL, "key" TEXT NOT NULL,
 "earnedAt" TIMESTAMP(3) NOT NULL, "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "value" INTEGER NOT NULL,
 CONSTRAINT "MemberAchievement_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "MemberAchievement_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MemberAchievement_guildId_memberId_key_key" ON "MemberAchievement"("guildId", "memberId", "key");
CREATE INDEX "MemberAchievement_memberId_idx" ON "MemberAchievement"("memberId");

CREATE TABLE "PoeLevelReached" (
 "id" TEXT PRIMARY KEY, "guildId" TEXT NOT NULL, "memberId" TEXT NOT NULL, "character" TEXT NOT NULL, "league" TEXT NOT NULL,
 "level" INTEGER NOT NULL, "reachedAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "PoeLevelReached_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "PoeLevelReached_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "PoeLevelReached_level_check" CHECK ("level" BETWEEN 1 AND 100)
);
CREATE UNIQUE INDEX "PoeLevelReached_guildId_memberId_character_league_level_key" ON "PoeLevelReached"("guildId", "memberId", "character", "league", "level");
CREATE INDEX "PoeLevelReached_memberId_level_idx" ON "PoeLevelReached"("memberId", "level");
