ALTER TABLE "ErrorReport" ADD COLUMN "version" TEXT;
ALTER TABLE "ErrorReport" ADD COLUMN "resolvedAt" TIMESTAMP(3);
ALTER TABLE "ErrorReport" ADD COLUMN "resolution" TEXT;
