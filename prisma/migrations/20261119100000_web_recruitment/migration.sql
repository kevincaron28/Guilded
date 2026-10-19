-- 7.0: website sign-in with Discord and recruitment listings (docs/ROADMAP_REQUESTS_PLAN_2026-10-18.md, item 5).
CREATE TABLE "WebAccount" (
    "id" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WebAccount_discordUserId_key" ON "WebAccount"("discordUserId");

CREATE TABLE "WebSession" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WebSession_tokenHash_key" ON "WebSession"("tokenHash");
CREATE INDEX "WebSession_accountId_idx" ON "WebSession"("accountId");
CREATE INDEX "WebSession_expiresAt_idx" ON "WebSession"("expiresAt");
ALTER TABLE "WebSession" ADD CONSTRAINT "WebSession_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "WebAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RecruitmentListing" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "coreId" TEXT,
    "scopeKey" TEXT NOT NULL,
    "open" BOOLEAN NOT NULL DEFAULT false,
    "classes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "raidDays" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "raidTimes" TEXT,
    "language" TEXT,
    "faction" TEXT,
    "realm" TEXT,
    "note" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RecruitmentListing_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RecruitmentListing_coreId_key" ON "RecruitmentListing"("coreId");
CREATE UNIQUE INDEX "RecruitmentListing_scopeKey_key" ON "RecruitmentListing"("scopeKey");
CREATE INDEX "RecruitmentListing_open_idx" ON "RecruitmentListing"("open");
CREATE INDEX "RecruitmentListing_guildId_idx" ON "RecruitmentListing"("guildId");
ALTER TABLE "RecruitmentListing" ADD CONSTRAINT "RecruitmentListing_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecruitmentListing" ADD CONSTRAINT "RecruitmentListing_coreId_fkey" FOREIGN KEY ("coreId") REFERENCES "RaidCore"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RecruitmentApplication" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "character" TEXT NOT NULL,
    "className" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "channelId" TEXT,
    "messageId" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecruitmentApplication_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RecruitmentApplication_accountId_createdAt_idx" ON "RecruitmentApplication"("accountId", "createdAt");
CREATE INDEX "RecruitmentApplication_listingId_status_idx" ON "RecruitmentApplication"("listingId", "status");
ALTER TABLE "RecruitmentApplication" ADD CONSTRAINT "RecruitmentApplication_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "RecruitmentListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecruitmentApplication" ADD CONSTRAINT "RecruitmentApplication_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "WebAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PlayerCard" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "character" TEXT NOT NULL,
    "className" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "level" INTEGER,
    "realm" TEXT,
    "faction" TEXT,
    "language" TEXT,
    "raidDays" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "note" TEXT,
    "showDiscord" BOOLEAN NOT NULL DEFAULT false,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlayerCard_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlayerCard_accountId_key" ON "PlayerCard"("accountId");
CREATE INDEX "PlayerCard_hidden_expiresAt_idx" ON "PlayerCard"("hidden", "expiresAt");
ALTER TABLE "PlayerCard" ADD CONSTRAINT "PlayerCard_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "WebAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RecruitmentReport" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecruitmentReport_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RecruitmentReport_accountId_targetType_targetId_key" ON "RecruitmentReport"("accountId", "targetType", "targetId");
CREATE INDEX "RecruitmentReport_targetType_targetId_idx" ON "RecruitmentReport"("targetType", "targetId");
ALTER TABLE "RecruitmentReport" ADD CONSTRAINT "RecruitmentReport_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "WebAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
