-- 5.0: group alerts, group level ranges, the answer channel and its FAQ.

-- AlterTable
ALTER TABLE "DungeonGroup" ADD COLUMN "minLevel" INTEGER;
ALTER TABLE "DungeonGroup" ADD COLUMN "maxLevel" INTEGER;

-- AlterTable
ALTER TABLE "GuildSettings" ADD COLUMN "answerChannelId" TEXT;
ALTER TABLE "GuildSettings" ADD COLUMN "aiAnswers" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "GroupAlert" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "kinds" TEXT[],
    "roles" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaqEntry" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "triggers" TEXT[],
    "answer" TEXT NOT NULL,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FaqEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GroupAlert_memberId_key" ON "GroupAlert"("memberId");

-- CreateIndex
CREATE INDEX "GroupAlert_guildId_idx" ON "GroupAlert"("guildId");

-- CreateIndex
CREATE INDEX "FaqEntry_guildId_idx" ON "FaqEntry"("guildId");

-- AddForeignKey
ALTER TABLE "GroupAlert" ADD CONSTRAINT "GroupAlert_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupAlert" ADD CONSTRAINT "GroupAlert_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FaqEntry" ADD CONSTRAINT "FaqEntry_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
