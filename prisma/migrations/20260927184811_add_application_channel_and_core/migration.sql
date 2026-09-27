-- DropIndex
DROP INDEX "EpgpTransaction_coreId_idx";

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "coreId" TEXT;

-- AlterTable
ALTER TABLE "GuildSettings" ADD COLUMN     "applicationChannelId" TEXT;

-- CreateIndex
CREATE INDEX "Application_coreId_idx" ON "Application"("coreId");

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_coreId_fkey" FOREIGN KEY ("coreId") REFERENCES "RaidCore"("id") ON DELETE SET NULL ON UPDATE CASCADE;
