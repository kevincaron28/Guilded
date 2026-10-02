-- The realm a raid core plays on; characters from another realm are refused at signup.
ALTER TABLE "RaidCore" ADD COLUMN "realm" TEXT;
