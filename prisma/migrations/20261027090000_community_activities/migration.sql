CREATE TABLE "CommunitySeason" (
  "id" TEXT NOT NULL, "guildId" TEXT NOT NULL, "game" TEXT NOT NULL,
  "name" TEXT NOT NULL, "channelId" TEXT NOT NULL, "audienceRoleId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE', "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3), "finalStandings" JSONB,
  CONSTRAINT "CommunitySeason_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommunitySeason_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CommunitySeason_game_check" CHECK ("game" IN ('DISCORD', 'WOW', 'POE2', 'DIABLO4', 'OTHER')),
  CONSTRAINT "CommunitySeason_status_check" CHECK ("status" IN ('ACTIVE', 'ENDED'))
);
CREATE INDEX "CommunitySeason_guildId_game_status_idx" ON "CommunitySeason"("guildId", "game", "status");
CREATE UNIQUE INDEX "CommunitySeason_one_active_game" ON "CommunitySeason"("guildId", "game") WHERE "status" = 'ACTIVE';
CREATE TABLE "CommunityActivity" (
  "id" TEXT NOT NULL, "seasonId" TEXT NOT NULL, "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL, "rules" JSONB NOT NULL, "status" TEXT NOT NULL DEFAULT 'OPEN',
  "startsAt" TIMESTAMP(3), "endsAt" TIMESTAMP(3) NOT NULL, "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "messageId" TEXT, "reminderAt" TIMESTAMP(3), "result" JSONB,
  CONSTRAINT "CommunityActivity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommunityActivity_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "CommunitySeason"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CommunityActivity_kind_check" CHECK ("kind" IN ('LOTTERY', 'EVENT', 'CHALLENGE', 'QUIZ', 'DICE')),
  CONSTRAINT "CommunityActivity_status_check" CHECK ("status" IN ('OPEN', 'CLOSED', 'CANCELLED'))
);
CREATE INDEX "CommunityActivity_status_endsAt_idx" ON "CommunityActivity"("status", "endsAt");
CREATE INDEX "CommunityActivity_seasonId_kind_idx" ON "CommunityActivity"("seasonId", "kind");
CREATE TABLE "CommunityEntry" (
  "id" TEXT NOT NULL, "activityId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "status" TEXT NOT NULL, "quantity" INTEGER NOT NULL DEFAULT 1,
  "evidence" TEXT, "reviewedBy" TEXT, "reviewNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommunityEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommunityEntry_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "CommunityActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CommunityEntry_quantity_check" CHECK ("quantity" BETWEEN 1 AND 1000)
);
CREATE UNIQUE INDEX "CommunityEntry_activityId_userId_key" ON "CommunityEntry"("activityId", "userId");
CREATE TABLE "CommunityPoint" (
  "id" TEXT NOT NULL, "seasonId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL, "kind" TEXT NOT NULL, "reference" TEXT NOT NULL,
  "reason" TEXT NOT NULL, "actorId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommunityPoint_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommunityPoint_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "CommunitySeason"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CommunityPoint_kind_check" CHECK ("kind" IN ('AWARD', 'REVERSAL', 'SPEND', 'REFUND'))
);
CREATE UNIQUE INDEX "CommunityPoint_seasonId_reference_key" ON "CommunityPoint"("seasonId", "reference");
CREATE INDEX "CommunityPoint_seasonId_userId_idx" ON "CommunityPoint"("seasonId", "userId");
