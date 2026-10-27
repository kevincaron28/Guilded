ALTER TABLE "PublicRun" ADD COLUMN "integrity" JSONB;
ALTER TABLE "PublicRun" ADD COLUMN "evidenceReceivedAt" TIMESTAMP(3);
ALTER TABLE "PublicRunUpload" ADD COLUMN "evidence" JSONB;
ALTER TABLE "PublicRunUpload" ADD COLUMN "historyOnly" BOOLEAN NOT NULL DEFAULT false;
