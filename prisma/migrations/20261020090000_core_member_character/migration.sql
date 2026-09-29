-- A core spot can name the character the member brings to that core (the same member can be in
-- several cores, with the same character or a different one in each). Nothing removed.

-- AlterTable
ALTER TABLE "RaidCoreMember" ADD COLUMN "characterId" TEXT;

-- AddForeignKey
ALTER TABLE "RaidCoreMember" ADD CONSTRAINT "RaidCoreMember_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: backup characters a member can bring to the same core, each with its own role.
CREATE TABLE "RaidCoreBackup" (
    "id" TEXT NOT NULL,
    "spotId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "role" "RaidRole" NOT NULL DEFAULT 'DPS',
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RaidCoreBackup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RaidCoreBackup_spotId_characterId_key" ON "RaidCoreBackup"("spotId", "characterId");

-- AddForeignKey
ALTER TABLE "RaidCoreBackup" ADD CONSTRAINT "RaidCoreBackup_spotId_fkey" FOREIGN KEY ("spotId") REFERENCES "RaidCoreMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaidCoreBackup" ADD CONSTRAINT "RaidCoreBackup_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
