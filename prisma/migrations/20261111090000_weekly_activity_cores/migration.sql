CREATE TABLE "ActivityCore" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "guildId" TEXT NOT NULL REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "nameKey" TEXT NOT NULL,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('DUNGEON', 'PVP')),
  "goal" TEXT,
  "channelId" TEXT NOT NULL,
  "rosterMessageId" TEXT,
  "weeklySchedule" TEXT,
  "timezone" TEXT NOT NULL,
  "durationMinutes" INTEGER NOT NULL DEFAULT 120 CHECK ("durationMinutes" BETWEEN 15 AND 480),
  "tanks" INTEGER NOT NULL CHECK ("tanks" >= 0),
  "healers" INTEGER NOT NULL CHECK ("healers" >= 0),
  "dps" INTEGER NOT NULL CHECK ("dps" >= 0),
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("tanks" + "healers" + "dps" BETWEEN 2 AND 40),
  CHECK ("kind" <> 'DUNGEON' OR ("tanks" = 1 AND "healers" = 1 AND "dps" = 3))
);
CREATE UNIQUE INDEX "ActivityCore_guildId_nameKey_key" ON "ActivityCore"("guildId", "nameKey");
CREATE INDEX "ActivityCore_guildId_archived_idx" ON "ActivityCore"("guildId", "archived");
CREATE TABLE "ActivityCoreMember" (
  "coreId" TEXT NOT NULL REFERENCES "ActivityCore"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "memberId" TEXT NOT NULL REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "characterId" TEXT REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "role" "RaidRole" NOT NULL,
  "bench" BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY ("coreId", "memberId")
);
CREATE TABLE "ActivitySession" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "coreId" TEXT NOT NULL REFERENCES "ActivityCore"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "occurrence" TEXT NOT NULL,
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "status" "RaidStatus" NOT NULL DEFAULT 'PLANNED',
  "openRecruitment" BOOLEAN NOT NULL DEFAULT false,
  "messageId" TEXT,
  "reminderQueued" BOOLEAN NOT NULL DEFAULT false,
  "result" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("endsAt" > "scheduledAt")
);
CREATE UNIQUE INDEX "ActivitySession_coreId_occurrence_key" ON "ActivitySession"("coreId", "occurrence");
CREATE INDEX "ActivitySession_status_scheduledAt_idx" ON "ActivitySession"("status", "scheduledAt");
CREATE TABLE "ActivityResponse" (
  "sessionId" TEXT NOT NULL REFERENCES "ActivitySession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "memberId" TEXT NOT NULL REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "characterId" TEXT REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "role" "RaidRole" NOT NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('CONFIRMED', 'WAITLISTED', 'ABSENT', 'TENTATIVE', 'UNANSWERED')),
  "attendance" "RaidAttendanceStatus",
  "lineupOverride" TEXT CHECK ("lineupOverride" IN ('SELECTED', 'BENCHED')),
  "respondedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("sessionId", "memberId")
);
CREATE INDEX "ActivityResponse_memberId_status_idx" ON "ActivityResponse"("memberId", "status");
