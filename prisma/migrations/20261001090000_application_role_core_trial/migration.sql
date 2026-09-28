ALTER TABLE "Application" ADD COLUMN "role" "RaidRole";
ALTER TABLE "RaidCoreMember" ADD COLUMN "trial" BOOLEAN NOT NULL DEFAULT false;
