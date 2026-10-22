ALTER TABLE "Guild" ADD COLUMN "officerSyncAt" TIMESTAMP(3);

CREATE TABLE "CharacterVerifyCode" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CharacterVerifyCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CharacterVerifyCode_code_key" ON "CharacterVerifyCode"("code");
CREATE UNIQUE INDEX "CharacterVerifyCode_guildId_memberId_key" ON "CharacterVerifyCode"("guildId", "memberId");
ALTER TABLE "CharacterVerifyCode" ADD CONSTRAINT "CharacterVerifyCode_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CharacterVerifyCode" ADD CONSTRAINT "CharacterVerifyCode_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CharacterVerifyClaim" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CharacterVerifyClaim_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CharacterVerifyClaim_guildId_memberId_nameKey_key" ON "CharacterVerifyClaim"("guildId", "memberId", "nameKey");
ALTER TABLE "CharacterVerifyClaim" ADD CONSTRAINT "CharacterVerifyClaim_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CharacterVerifyClaim" ADD CONSTRAINT "CharacterVerifyClaim_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
