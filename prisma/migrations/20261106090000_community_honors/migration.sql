-- Community honors: a hall-of-fame channel, a weekly MVP role and three monthly podium roles.
-- Additive.
CREATE TABLE "CommunityHonors" (
  "guildId" TEXT NOT NULL,
  "channelId" TEXT,
  "weeklyRoleId" TEXT,
  "monthRoleIds" JSONB NOT NULL DEFAULT '[]',
  "week" TEXT,
  "weeklyHolderIds" JSONB NOT NULL DEFAULT '[]',
  "monthSeasonId" TEXT,
  "monthHolderIds" JSONB NOT NULL DEFAULT '[[],[],[]]',
  "rolesPending" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  PRIMARY KEY ("guildId"),
  FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
