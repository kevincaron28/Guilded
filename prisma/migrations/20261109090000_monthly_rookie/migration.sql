ALTER TABLE "CommunityHonors" ADD COLUMN "rookieRoleId" TEXT, ADD COLUMN "rookieHolderId" TEXT;
CREATE TABLE "CommunityRookieMembership" (
  "guildId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "joinedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommunityRookieMembership_pkey" PRIMARY KEY ("guildId", "userId"),
  CONSTRAINT "CommunityRookieMembership_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
