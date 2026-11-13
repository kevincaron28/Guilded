-- World PvP deaths (9.3): open-world deaths to enemy players, shown beside kills as K/D; never ranked on.
ALTER TABLE "WorldPvpWeek" ADD COLUMN "deaths" INTEGER NOT NULL DEFAULT 0;
