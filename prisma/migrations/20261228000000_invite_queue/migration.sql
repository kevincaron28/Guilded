-- 8.5 batch 3 (#13/#14): guild-invite channel, queue, and WoW-role DM settings.
ALTER TABLE "GuildSettings" ADD COLUMN "inviteChannelId" TEXT;
ALTER TABLE "GuildSettings" ADD COLUMN "inviteQueueEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "GuildSettings" ADD COLUMN "inviteDmEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "GuildSettings" ADD COLUMN "inviteWowRoleId" TEXT;

CREATE TABLE "InviteRequest" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "invitedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invitedAt" TIMESTAMP(3),

    CONSTRAINT "InviteRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InviteRequest_guildId_messageId_key" ON "InviteRequest"("guildId", "messageId");
CREATE INDEX "InviteRequest_guildId_status_idx" ON "InviteRequest"("guildId", "status");
ALTER TABLE "InviteRequest" ADD CONSTRAINT "InviteRequest_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One DM per member asking for their full character name (never repeated if the role is removed and given again).
CREATE TABLE "InviteDm" (
    "guildId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InviteDm_pkey" PRIMARY KEY ("guildId","discordUserId")
);
