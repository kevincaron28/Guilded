ALTER TABLE "WeeklyQuestionPlan" ADD COLUMN "automation" JSONB;
ALTER TABLE "GuildSettings" ADD COLUMN "targetedAlertsAutomationApprovedBy" TEXT;
CREATE TABLE "RecurringRecap" (
  "memberId" TEXT PRIMARY KEY,
  "guildId" TEXT NOT NULL,
  "settings" JSONB NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "lastPeriod" TEXT,
  "lastAttemptAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'OFF',
  "messageId" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecurringRecap_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RecurringRecap_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "RecurringRecap_enabled_guildId_idx" ON "RecurringRecap"("enabled", "guildId");
