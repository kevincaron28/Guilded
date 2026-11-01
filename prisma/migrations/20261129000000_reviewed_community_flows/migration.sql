ALTER TABLE "GuildSettings" ADD COLUMN "targetedAlertsEnabled" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "targetedAlertsChannelId" TEXT;
ALTER TABLE "GroupAlert" ADD COLUMN "subscription" JSONB;
CREATE TABLE "CooperativeGoal" (
 "guildId" TEXT PRIMARY KEY REFERENCES "Guild"("id") ON DELETE CASCADE,
 "seasonId" TEXT NOT NULL, "edition" TEXT NOT NULL, "seasonStartsAt" TIMESTAMP(3) NOT NULL, "seasonEndsAt" TIMESTAMP(3), "target" INTEGER NOT NULL CHECK ("target" BETWEEN 1 AND 100),
 "metric" TEXT NOT NULL CHECK ("metric" IN ('dungeons','runs')), "startsAt" TIMESTAMP(3) NOT NULL, "endsAt" TIMESTAMP(3) NOT NULL,
 "rules" JSONB NOT NULL, "rulesHash" TEXT NOT NULL, "paused" BOOLEAN NOT NULL DEFAULT false, "createdBy" TEXT NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL,
 CHECK ("startsAt" < "endsAt")
);
CREATE TABLE "TargetedAlertAttempt" (
 "id" TEXT PRIMARY KEY, "guildId" TEXT NOT NULL REFERENCES "Guild"("id") ON DELETE CASCADE,
 "memberId" TEXT NOT NULL REFERENCES "Member"("id") ON DELETE CASCADE, "eventKey" TEXT NOT NULL, "channelId" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'ATTEMPTED' CHECK ("status" IN ('ATTEMPTED','SENT','UNCERTAIN','CANCELLED')),
 "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "messageId" TEXT
);
CREATE UNIQUE INDEX "TargetedAlertAttempt_guildId_memberId_eventKey_key" ON "TargetedAlertAttempt"("guildId","memberId","eventKey");
CREATE INDEX "TargetedAlertAttempt_guildId_memberId_attemptedAt_idx" ON "TargetedAlertAttempt"("guildId","memberId","attemptedAt");
CREATE TABLE "WeeklyQuestionPlan" (
 "guildId" TEXT PRIMARY KEY REFERENCES "Guild"("id") ON DELETE CASCADE, "settings" JSONB NOT NULL,
 "revision" INTEGER NOT NULL DEFAULT 1, "paused" BOOLEAN NOT NULL DEFAULT false, "createdBy" TEXT NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "WeeklyQuestionReview" (
 "id" TEXT PRIMARY KEY, "guildId" TEXT NOT NULL REFERENCES "Guild"("id") ON DELETE CASCADE,
 "actorId" TEXT NOT NULL, "revision" INTEGER NOT NULL, "weekKey" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "WeeklyQuestionReview_guildId_expiresAt_idx" ON "WeeklyQuestionReview"("guildId","expiresAt");
CREATE TABLE "WeeklyQuestionOccurrence" (
 "id" TEXT PRIMARY KEY, "guildId" TEXT NOT NULL REFERENCES "Guild"("id") ON DELETE CASCADE,
 "weekKey" TEXT NOT NULL, "status" TEXT NOT NULL CHECK ("status" IN ('ATTEMPTED','SENT','UNCERTAIN','SKIPPED')),
 "pollId" TEXT, "channelId" TEXT NOT NULL, "messageId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "WeeklyQuestionOccurrence_guildId_weekKey_key" ON "WeeklyQuestionOccurrence"("guildId","weekKey");
