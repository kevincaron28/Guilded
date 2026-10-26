CREATE TABLE "WebAvailability" (
    "memberId" TEXT NOT NULL PRIMARY KEY,
    "characterId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "gameEdition" TEXT NOT NULL,
    "role" TEXT NOT NULL CHECK ("role" IN ('TANK', 'HEALER', 'DPS', 'ANY')),
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WebAvailability_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WebAvailability_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "WebAvailability_guildId_gameEdition_expiresAt_idx" ON "WebAvailability"("guildId", "gameEdition", "expiresAt");
CREATE INDEX "WebAvailability_expiresAt_idx" ON "WebAvailability"("expiresAt");
