-- A core spot can name the character the member brings to that core (the same member can be in
-- several cores, with the same character or a different one in each). Nothing removed.

-- AlterTable
ALTER TABLE "RaidCoreMember" ADD COLUMN "characterId" TEXT;

-- AddForeignKey
ALTER TABLE "RaidCoreMember" ADD CONSTRAINT "RaidCoreMember_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;
