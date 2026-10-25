ALTER TABLE "PlayerCard" ADD COLUMN "gameEdition" TEXT NOT NULL DEFAULT 'forever';
DROP INDEX "PlayerCard_accountId_key";
CREATE UNIQUE INDEX "PlayerCard_accountId_gameEdition_key" ON "PlayerCard"("accountId", "gameEdition");
