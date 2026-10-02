CREATE TABLE "CommunityParticipationConfig" (
  "seasonId" TEXT PRIMARY KEY, "enabled" BOOLEAN NOT NULL DEFAULT false,
  "rules" JSONB NOT NULL, "revision" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommunityParticipationConfig_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "CommunitySeason"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "CommunityParticipationDay" (
  "id" TEXT PRIMARY KEY, "seasonId" TEXT NOT NULL, "userId" TEXT NOT NULL, "day" TEXT NOT NULL,
  "messages" INTEGER NOT NULL DEFAULT 0, "reactions" INTEGER NOT NULL DEFAULT 0,
  "voiceMs" INTEGER NOT NULL DEFAULT 0, "voicePoints" INTEGER NOT NULL DEFAULT 0,
  "lastVoiceAt" TIMESTAMP(3), "lastMessageAt" TIMESTAMP(3), "messageHashes" JSONB NOT NULL DEFAULT '[]',
  CONSTRAINT "CommunityParticipationDay_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "CommunitySeason"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CommunityParticipationDay_nonnegative" CHECK ("messages" >= 0 AND "reactions" >= 0 AND "voiceMs" BETWEEN 0 AND 14400000 AND "voicePoints" >= 0)
);
CREATE UNIQUE INDEX "CommunityParticipationDay_seasonId_userId_day_key" ON "CommunityParticipationDay"("seasonId", "userId", "day");
CREATE INDEX "CommunityParticipationDay_seasonId_day_idx" ON "CommunityParticipationDay"("seasonId", "day");
CREATE TABLE "CommunityKudos" (
  "id" TEXT PRIMARY KEY, "seasonId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "nominatorId" TEXT NOT NULL, "week" TEXT NOT NULL, "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING', "reviewedBy" TEXT, "reviewNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommunityKudos_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "CommunitySeason"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CommunityKudos_status_check" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'REVERSED')),
  CONSTRAINT "CommunityKudos_not_self" CHECK ("userId" <> "nominatorId")
);
CREATE UNIQUE INDEX "CommunityKudos_seasonId_nominatorId_userId_week_key" ON "CommunityKudos"("seasonId", "nominatorId", "userId", "week");
CREATE INDEX "CommunityKudos_seasonId_status_idx" ON "CommunityKudos"("seasonId", "status");
CREATE INDEX "CommunityPoint_seasonId_userId_createdAt_idx" ON "CommunityPoint"("seasonId", "userId", "createdAt");
CREATE TABLE "CommunityParticipationDeletion" (
  "seasonId" TEXT NOT NULL, "messageId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommunityParticipationDeletion_pkey" PRIMARY KEY ("seasonId", "messageId"),
  CONSTRAINT "CommunityParticipationDeletion_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "CommunitySeason"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
