-- Officer member-trend graph. Additive only.
ALTER TABLE "GuildStatSnapshot" ADD COLUMN "inGuildMembers" INTEGER;
ALTER TABLE "GuildStatSnapshot" ADD COLUMN "joins" INTEGER;
ALTER TABLE "GuildStatSnapshot" ADD COLUMN "leaves" INTEGER;
ALTER TABLE "GuildSettings" ADD COLUMN "memberTrendPostEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "GuildSettings" ADD COLUMN "memberTrendLastPostAt" TIMESTAMP(3);
