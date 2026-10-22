-- Public dungeon score integrity (docs/RAIDER_IO_SCORING_ANALYSIS_2026-10-22.md, item 1).
-- Public runs keep the evidence guild seasons rank on; existing rows stay evidenceVersion 0.
ALTER TABLE "PublicRun" ADD COLUMN "evidenceVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PublicRun" ADD COLUMN "completedBy" TEXT;
ALTER TABLE "PublicRun" ADD COLUMN "encounters" JSONB;
ALTER TABLE "PublicRunPlayer" ADD COLUMN "minLevel" INTEGER;
ALTER TABLE "PublicRunPlayer" ADD COLUMN "presentSec" INTEGER;
ALTER TABLE "PublicRunUpload" ADD COLUMN "reporters" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "DungeonRun" ADD COLUMN "reporterNames" TEXT[] DEFAULT ARRAY[]::TEXT[];
-- Each official season's public rules, frozen when it starts.
ALTER TABLE "OfficialSeason" ADD COLUMN "rules" JSONB;
