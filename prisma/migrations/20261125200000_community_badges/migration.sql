
CREATE TABLE "CommunityBadgeConfig" (
 "seasonId" TEXT PRIMARY KEY REFERENCES "CommunitySeason"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "enabled" BOOLEAN NOT NULL DEFAULT false, "channelId" TEXT NOT NULL, "baselineAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "CommunityBadge" (
 "id" TEXT PRIMARY KEY, "seasonId" TEXT NOT NULL REFERENCES "CommunitySeason"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "userId" TEXT NOT NULL, "code" TEXT NOT NULL, "earnedAt" TIMESTAMP(3), "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "source" TEXT NOT NULL, "evidenceRef" TEXT, "delivery" TEXT NOT NULL DEFAULT 'SILENT', "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "attemptedAt" TIMESTAMP(3), "messageId" TEXT,
 CONSTRAINT "CommunityBadge_delivery_check" CHECK ("delivery" IN ('SILENT','PENDING','ATTEMPTED','SENT','UNCERTAIN','CANCELLED'))
);
CREATE UNIQUE INDEX "CommunityBadge_seasonId_userId_code_key" ON "CommunityBadge"("seasonId", "userId", "code");
CREATE INDEX "CommunityBadge_delivery_nextAttemptAt_idx" ON "CommunityBadge"("delivery", "nextAttemptAt");
CREATE TABLE "CommunityBadgeSharing" (
 "seasonId" TEXT NOT NULL REFERENCES "CommunitySeason"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "userId" TEXT NOT NULL, "shared" BOOLEAN NOT NULL DEFAULT false,
 PRIMARY KEY ("seasonId", "userId")
);
