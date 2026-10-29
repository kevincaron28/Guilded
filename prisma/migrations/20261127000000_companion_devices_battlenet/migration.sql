ALTER TABLE "CompanionCredential" ADD COLUMN "deviceName" TEXT NOT NULL DEFAULT 'Paired companion';
ALTER TABLE "WebCompanionCredential" ADD COLUMN "deviceName" TEXT NOT NULL DEFAULT 'Paired companion';

CREATE TABLE "BattleNetIdentity" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "accountId" TEXT NOT NULL UNIQUE REFERENCES "WebAccount"("id") ON DELETE CASCADE,
  "subject" TEXT NOT NULL UNIQUE,
  "battleTag" TEXT NOT NULL,
  "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "BattleNetCharacter" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "identityId" TEXT NOT NULL REFERENCES "BattleNetIdentity"("id") ON DELETE CASCADE,
  "region" TEXT NOT NULL,
  "gameEdition" TEXT NOT NULL,
  "realmId" INTEGER NOT NULL,
  "characterId" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "realm" TEXT NOT NULL,
  "isMain" BOOLEAN NOT NULL DEFAULT false,
  "verifiedAt" TIMESTAMP(3) NOT NULL,
  UNIQUE ("region", "gameEdition", "realmId", "characterId")
);
CREATE UNIQUE INDEX "BattleNetCharacter_one_main" ON "BattleNetCharacter" ("identityId") WHERE "isMain" = true;
CREATE INDEX "BattleNetCharacter_identityId_idx" ON "BattleNetCharacter"("identityId");
