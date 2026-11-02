-- Cross-guild PUG board: opt-in membership, block list, requests, per-guild posts and guest sign-ups.
CREATE TABLE "PugBoardGuild" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "joinedBy" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PugBoardGuild_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PugBlock" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "blockedGuildId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PugBlock_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PugRequest" (
    "id" TEXT NOT NULL,
    "raidId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "edition" TEXT NOT NULL,
    "raidTitle" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "wantTank" INTEGER NOT NULL DEFAULT 0,
    "wantHealer" INTEGER NOT NULL DEFAULT 0,
    "wantDps" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closeReason" TEXT,
    "createdBy" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "noticeChannelId" TEXT,
    "noticeMessageId" TEXT,
    CONSTRAINT "PugRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PugPost" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PugPost_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PugSignup" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "sourceGuild" TEXT,
    "characterName" TEXT NOT NULL,
    "characterClass" TEXT,
    "role" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    CONSTRAINT "PugSignup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PugBoardGuild_guildId_key" ON "PugBoardGuild"("guildId");
CREATE UNIQUE INDEX "PugBlock_guildId_blockedGuildId_key" ON "PugBlock"("guildId", "blockedGuildId");
CREATE INDEX "PugRequest_status_expiresAt_idx" ON "PugRequest"("status", "expiresAt");
CREATE INDEX "PugRequest_guildId_createdAt_idx" ON "PugRequest"("guildId", "createdAt");
CREATE INDEX "PugRequest_raidId_status_idx" ON "PugRequest"("raidId", "status");
-- One active request per raid, whatever the application does under a race.
CREATE UNIQUE INDEX "PugRequest_raidId_open_key" ON "PugRequest"("raidId") WHERE "status" = 'OPEN';
CREATE UNIQUE INDEX "PugPost_requestId_guildId_key" ON "PugPost"("requestId", "guildId");
CREATE INDEX "PugPost_removedAt_idx" ON "PugPost"("removedAt");
CREATE UNIQUE INDEX "PugSignup_requestId_discordUserId_key" ON "PugSignup"("requestId", "discordUserId");
CREATE INDEX "PugSignup_requestId_status_idx" ON "PugSignup"("requestId", "status");

ALTER TABLE "PugBoardGuild" ADD CONSTRAINT "PugBoardGuild_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PugBlock" ADD CONSTRAINT "PugBlock_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PugRequest" ADD CONSTRAINT "PugRequest_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PugPost" ADD CONSTRAINT "PugPost_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PugRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PugSignup" ADD CONSTRAINT "PugSignup_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "PugRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
