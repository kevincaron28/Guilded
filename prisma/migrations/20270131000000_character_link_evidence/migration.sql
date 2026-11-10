-- Linking audit T3 (10 November 2026): proof order, history-safe moves and unlink that detaches.
-- linkEvidence: what proved the link (named < companion < heard < officer); null on existing rows,
-- derived from confirmedAt and the verify claim until the next link writes it.
-- detachedAt / detachedFromMemberId: /character unlink keeps the row (and its history) under the
-- server's hidden holding member instead of deleting it.
ALTER TABLE "Character" ADD COLUMN "linkEvidence" TEXT;
ALTER TABLE "Character" ADD COLUMN "detachedAt" TIMESTAMP(3);
ALTER TABLE "Character" ADD COLUMN "detachedFromMemberId" TEXT;

-- Two members and one character: a stronger-proof move (with its undo), or the officer queue.
CREATE TABLE "CharacterLinkConflict" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "ownerMemberId" TEXT NOT NULL,
    "claimantMemberId" TEXT NOT NULL,
    "ownerEvidence" TEXT NOT NULL,
    "claimantEvidence" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharacterLinkConflict_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CharacterLinkConflict_characterId_claimantMemberId_key" ON "CharacterLinkConflict"("characterId", "claimantMemberId");
CREATE INDEX "CharacterLinkConflict_guildId_status_idx" ON "CharacterLinkConflict"("guildId", "status");
ALTER TABLE "CharacterLinkConflict" ADD CONSTRAINT "CharacterLinkConflict_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CharacterLinkConflict" ADD CONSTRAINT "CharacterLinkConflict_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
