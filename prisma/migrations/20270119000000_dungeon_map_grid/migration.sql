-- Traced dungeon maps: one anonymous occupancy grid per dungeon floor (uiMapID), merged from walked grid cells on import.
CREATE TABLE "DungeonMapGrid" (
    "mapId" INTEGER NOT NULL,
    "dungeonName" TEXT NOT NULL,
    "cells" JSONB NOT NULL,
    "runs" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DungeonMapGrid_pkey" PRIMARY KEY ("mapId")
);
