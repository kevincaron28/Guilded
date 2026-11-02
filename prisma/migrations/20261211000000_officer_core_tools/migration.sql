-- Officer buttons on raid and core posts, and a per-core applications channel.
-- Additive only: every new column is nullable, so existing cores keep the common applications channel.

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'RAID_OFFICER';
ALTER TYPE "AuditAction" ADD VALUE 'CORE_OFFICER';

-- AlterTable
ALTER TABLE "RaidCore" ADD COLUMN "applicationChannelId" TEXT,
ADD COLUMN "officerRoleId" TEXT,
ADD COLUMN "lootRulesNote" TEXT,
ADD COLUMN "archivedAt" TIMESTAMP(3);
