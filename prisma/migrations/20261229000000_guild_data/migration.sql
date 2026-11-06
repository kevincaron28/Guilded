-- 8.5 guild data (docs/GUILD_DATA_INVENTORY.md): the game's guild roster, event log and info text,
-- uploaded by any member's companion. Additive only.
CREATE TABLE "GuildRosterEntry" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "gameEdition" TEXT NOT NULL DEFAULT 'forever',
    "nameKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" INTEGER,
    "className" TEXT,
    "rankName" TEXT,
    "rankIndex" INTEGER,
    "lastOnlineAt" TIMESTAMP(3),
    "inGuild" BOOLEAN NOT NULL DEFAULT true,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "reportedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GuildRosterEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GuildRosterEntry_guildId_gameEdition_nameKey_key" ON "GuildRosterEntry"("guildId", "gameEdition", "nameKey");
CREATE INDEX "GuildRosterEntry_guildId_inGuild_idx" ON "GuildRosterEntry"("guildId", "inGuild");

CREATE TABLE "GuildEventEntry" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "gameEdition" TEXT NOT NULL DEFAULT 'forever',
    "kind" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "target" TEXT,
    "rank" TEXT,
    "at" TIMESTAMP(3) NOT NULL,
    "reportedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GuildEventEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GuildEventEntry_guildId_at_idx" ON "GuildEventEntry"("guildId", "at");
CREATE INDEX "GuildEventEntry_guildId_kind_actor_idx" ON "GuildEventEntry"("guildId", "kind", "actor");

CREATE TABLE "GuildText" (
    "guildId" TEXT NOT NULL,
    "motd" TEXT,
    "info" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "reportedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GuildText_pkey" PRIMARY KEY ("guildId")
);
