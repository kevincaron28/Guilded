CREATE TABLE "RaidPlanRevision" (
  "id" TEXT NOT NULL, "raidId" TEXT NOT NULL, "kind" TEXT NOT NULL,
  "revision" INTEGER NOT NULL, "active" BOOLEAN NOT NULL DEFAULT true,
  "payload" JSONB NOT NULL, "approvedBy" TEXT NOT NULL,
  "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RaidPlanRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RaidPlanRevision_raidId_fkey" FOREIGN KEY ("raidId") REFERENCES "Raid"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "RaidPlanRevision_raidId_kind_revision_key" ON "RaidPlanRevision"("raidId", "kind", "revision");
CREATE TABLE "RaidSupplyPledge" (
  "revisionId" TEXT NOT NULL, "memberId" TEXT NOT NULL, "itemIndex" INTEGER NOT NULL,
  "quantity" INTEGER NOT NULL, "delivered" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RaidSupplyPledge_pkey" PRIMARY KEY ("revisionId", "memberId", "itemIndex"),
  CONSTRAINT "RaidSupplyPledge_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "RaidPlanRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RaidSupplyPledge_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "RaidSupplyPledge_quantities_check" CHECK ("quantity" >= 0 AND "quantity" <= 9999 AND "delivered" >= 0 AND "delivered" <= "quantity" AND "itemIndex" >= 0 AND "itemIndex" < 30)
);
