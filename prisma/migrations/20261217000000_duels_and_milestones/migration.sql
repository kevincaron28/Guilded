-- Guild duel results and member milestones reported by the companion. Additive only.
CREATE TABLE "DuelResult" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "gameEdition" TEXT NOT NULL DEFAULT 'forever',
    "winnerId" TEXT NOT NULL,
    "loserId" TEXT NOT NULL,
    "winnerCharacter" TEXT NOT NULL,
    "loserCharacter" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'knockout',
    "endedAt" TIMESTAMP(3) NOT NULL,
    "dayKey" TEXT NOT NULL,
    "pairKey" TEXT NOT NULL,
    "counted" BOOLEAN NOT NULL DEFAULT true,
    "reportKey" TEXT NOT NULL,
    "reporterId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DuelResult_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DuelResult_guildId_reportKey_key" ON "DuelResult"("guildId", "reportKey");
CREATE INDEX "DuelResult_guildId_gameEdition_counted_endedAt_idx" ON "DuelResult"("guildId", "gameEdition", "counted", "endedAt");
CREATE INDEX "DuelResult_guildId_pairKey_dayKey_idx" ON "DuelResult"("guildId", "pairKey", "dayKey");
CREATE INDEX "DuelResult_winnerId_idx" ON "DuelResult"("winnerId");
CREATE INDEX "DuelResult_loserId_idx" ON "DuelResult"("loserId");

ALTER TABLE "DuelResult" ADD CONSTRAINT "DuelResult_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DuelResult" ADD CONSTRAINT "DuelResult_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DuelResult" ADD CONSTRAINT "DuelResult_loserId_fkey" FOREIGN KEY ("loserId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MemberMilestone" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "gameEdition" TEXT NOT NULL DEFAULT 'forever',
    "kind" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "reachedAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberMilestone_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MemberMilestone_guildId_memberId_gameEdition_ref_key" ON "MemberMilestone"("guildId", "memberId", "gameEdition", "ref");
CREATE INDEX "MemberMilestone_guildId_memberId_kind_idx" ON "MemberMilestone"("guildId", "memberId", "kind");

ALTER TABLE "MemberMilestone" ADD CONSTRAINT "MemberMilestone_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemberMilestone" ADD CONSTRAINT "MemberMilestone_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
