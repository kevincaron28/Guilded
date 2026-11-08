-- WoW Forever in-game achievements reported by members' addons: the generated badge catalogue (docs/plans/FOREVER_ACHIEVEMENTS.md).
CREATE TABLE "GameAchievement" (
    "id" TEXT NOT NULL,
    "gameEdition" TEXT NOT NULL DEFAULT 'forever',
    "achievementId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "categoryName" TEXT NOT NULL DEFAULT '',
    "points" INTEGER NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameAchievement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GameAchievement_gameEdition_achievementId_key" ON "GameAchievement"("gameEdition", "achievementId");
