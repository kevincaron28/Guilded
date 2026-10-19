-- Rated route of a public run (map id, or 189:<wing>); see src/services/public-score.ts.
ALTER TABLE "PublicRun" ADD COLUMN "routeKey" TEXT;
