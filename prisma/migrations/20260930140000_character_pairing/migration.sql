ALTER TABLE "AddonImport" ADD COLUMN "pairedMemberId" TEXT;
CREATE INDEX "AddonImport_pairedMemberId_idx" ON "AddonImport"("pairedMemberId");
ALTER TABLE "AddonImport" ADD CONSTRAINT "AddonImport_pairedMemberId_fkey"
  FOREIGN KEY ("pairedMemberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CharacterPairing" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CharacterPairing_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CharacterPairing_codeHash_key" ON "CharacterPairing"("codeHash");
CREATE UNIQUE INDEX "CharacterPairing_guildId_memberId_key" ON "CharacterPairing"("guildId", "memberId");
CREATE INDEX "CharacterPairing_expiresAt_idx" ON "CharacterPairing"("expiresAt");
ALTER TABLE "CharacterPairing" ADD CONSTRAINT "CharacterPairing_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CharacterPairing" ADD CONSTRAINT "CharacterPairing_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CompanionCredential" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "CompanionCredential_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CompanionCredential_tokenHash_key" ON "CompanionCredential"("tokenHash");
CREATE INDEX "CompanionCredential_memberId_revokedAt_idx" ON "CompanionCredential"("memberId", "revokedAt");
ALTER TABLE "CompanionCredential" ADD CONSTRAINT "CompanionCredential_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
