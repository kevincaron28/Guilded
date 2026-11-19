-- 9.4 T10: the do-not-invite list gets a kind, an expiry, evidence, a status and an alias group.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DNI_ADDED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DNI_CLEARED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DNI_APPEAL';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DNI_ALIAS';

CREATE TYPE "DniKind" AS ENUM ('KICKED', 'LEFT_BADLY', 'SCAMMER', 'OTHER');
CREATE TYPE "DniStatus" AS ENUM ('ACTIVE', 'APPEALED', 'CLEARED');

ALTER TABLE "DoNotInvite"
  ADD COLUMN "kind" "DniKind" NOT NULL DEFAULT 'KICKED',
  ADD COLUMN "expiresAt" TIMESTAMP(3),
  ADD COLUMN "evidence" TEXT,
  ADD COLUMN "status" "DniStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "aliasGroup" TEXT,
  ADD COLUMN "clearedBy" TEXT,
  ADD COLUMN "clearedAt" TIMESTAMP(3),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "DoNotInvite_guildId_status_idx" ON "DoNotInvite"("guildId", "status");
CREATE INDEX "DoNotInvite_discordUserId_idx" ON "DoNotInvite"("discordUserId");
