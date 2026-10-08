-- Community honors: officer settings and the award history. Additive.
ALTER TABLE "CommunityHonors" ADD COLUMN "weeklyEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "CommunityHonors" ADD COLUMN "weekStart" TEXT NOT NULL DEFAULT 'MONDAY';
ALTER TABLE "CommunityHonors" ADD COLUMN "pingMvp" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "CommunityHonorAward" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "period" TEXT NOT NULL,
  "place" INTEGER NOT NULL DEFAULT 1,
  "userId" TEXT NOT NULL,
  "points" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("id"),
  FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CommunityHonorAward_guildId_kind_period_userId_key" ON "CommunityHonorAward"("guildId", "kind", "period", "userId");
CREATE INDEX "CommunityHonorAward_guildId_kind_createdAt_idx" ON "CommunityHonorAward"("guildId", "kind", "createdAt");

-- The weekly MVPs already announced become the first history rows (their points were not kept).
INSERT INTO "CommunityHonorAward" ("id", "guildId", "kind", "period", "place", "userId")
SELECT 'backfill-' || md5(h."guildId" || h."week" || u.id), h."guildId", 'WEEK', h."week", 1, u.id
FROM "CommunityHonors" h CROSS JOIN LATERAL jsonb_array_elements_text(h."weeklyHolderIds") AS u(id)
WHERE h."week" IS NOT NULL;
