ALTER TABLE "GuildSettings" ADD COLUMN "characterSignups" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "RaidSignup" ADD COLUMN "characterId" TEXT,
  ADD COLUMN "characterName" TEXT, ADD COLUMN "characterRealm" TEXT;
ALTER TABLE "RaidSignup" ADD CONSTRAINT "RaidSignup_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "RaidSignup_raidId_characterId_key" ON "RaidSignup"("raidId", "characterId");
ALTER TABLE "Application" ADD COLUMN "characterId" TEXT;
ALTER TABLE "Application" ADD CONSTRAINT "Application_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;
