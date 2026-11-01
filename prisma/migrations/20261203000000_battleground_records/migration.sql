CREATE TABLE "BattlegroundConsent" (
 "memberId" TEXT PRIMARY KEY, "guildId" TEXT NOT NULL,
 "capture" BOOLEAN NOT NULL DEFAULT false, "guildStats" BOOLEAN NOT NULL DEFAULT false,
 "consentedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "BattlegroundConsent_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "BattlegroundConsent_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "BattlegroundConsent_stats_capture_check" CHECK (NOT "guildStats" OR "capture")
);
CREATE INDEX "BattlegroundConsent_guildId_guildStats_idx" ON "BattlegroundConsent"("guildId", "guildStats");
CREATE TABLE "BattlegroundReport" (
 "id" TEXT PRIMARY KEY, "guildId" TEXT NOT NULL, "memberId" TEXT NOT NULL, "characterId" TEXT NOT NULL,
 "reportId" TEXT NOT NULL, "adapter" TEXT NOT NULL, "gameEdition" TEXT NOT NULL, "mode" TEXT NOT NULL,
 "mapId" INTEGER NOT NULL, "bracket" TEXT NOT NULL, "endedAt" TIMESTAMP(3) NOT NULL,
 "durationSeconds" INTEGER NOT NULL, "outcome" TEXT NOT NULL, "presence" TEXT NOT NULL,
 "reloaded" BOOLEAN NOT NULL, "premadeNonce" TEXT, "corroborated" BOOLEAN NOT NULL DEFAULT false, "fingerprint" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'PROVISIONAL', "correctionReason" TEXT, "correctedAt" TIMESTAMP(3),
 "conflictFingerprint" TEXT, "conflictSummary" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "BattlegroundReport_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "BattlegroundReport_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "BattlegroundReport_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BattlegroundReport_guildId_memberId_reportId_key" ON "BattlegroundReport"("guildId", "memberId", "reportId");
CREATE INDEX "BattlegroundReport_guildId_gameEdition_endedAt_idx" ON "BattlegroundReport"("guildId", "gameEdition", "endedAt");
CREATE INDEX "BattlegroundReport_memberId_endedAt_idx" ON "BattlegroundReport"("memberId", "endedAt");
CREATE INDEX "BattlegroundReport_guildId_premadeNonce_idx" ON "BattlegroundReport"("guildId", "premadeNonce");
