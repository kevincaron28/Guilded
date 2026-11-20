-- A main the member or an officer explicitly chose (isMain alone is often just the first linked character).
ALTER TABLE "Character" ADD COLUMN "mainChosenAt" TIMESTAMP(3);
