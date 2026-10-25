-- Native Mythic+ attempt evidence; historical runs have no native result.
ALTER TABLE "PublicRun" ADD COLUMN "challenge" JSONB;
