-- WoW guild rank to Discord role links (officer-configured). The feature is on by default
-- but does nothing for a guild until a rank is mapped.
ALTER TABLE "GuildSettings" ADD COLUMN "rankRolesEnabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "GuildRankRole" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "rankIndex" INTEGER NOT NULL,
    "discordRoleId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuildRankRole_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GuildRankRole_guildId_rankIndex_key" ON "GuildRankRole"("guildId", "rankIndex");

ALTER TABLE "GuildRankRole" ADD CONSTRAINT "GuildRankRole_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
