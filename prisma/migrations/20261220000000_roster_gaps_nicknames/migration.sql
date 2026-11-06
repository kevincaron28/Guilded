-- 8.5 track C: roster gaps (ignored roles), opt-in nickname sync and the Who's who board. Additive only, all off by default.
ALTER TABLE "GuildSettings" ADD COLUMN "rosterIgnoredRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "GuildSettings" ADD COLUMN "nicknameSyncEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GuildSettings" ADD COLUMN "nicknameFormat" TEXT;
ALTER TABLE "GuildSettings" ADD COLUMN "whosWhoEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GuildSettings" ADD COLUMN "whosWhoChannelId" TEXT;
ALTER TABLE "GuildSettings" ADD COLUMN "whosWhoMessageId" TEXT;

CREATE TABLE "MemberNickname" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "originalNickname" TEXT,
    "appliedNickname" TEXT,
    "optedOut" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MemberNickname_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MemberNickname_guildId_discordUserId_key" ON "MemberNickname"("guildId", "discordUserId");
ALTER TABLE "MemberNickname" ADD CONSTRAINT "MemberNickname_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
