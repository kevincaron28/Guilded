-- Zero-setup companion (docs/ZERO_SETUP_COMPANION.md): a key per install, made without Discord
-- sign-in. Its uploads stay "reported" (DeviceCharacter) until a sign-in claims the device.
CREATE TABLE "CompanionDevice" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "guildId" TEXT,
    "wowGuildKey" TEXT,
    "wowGuildName" TEXT,
    "wowGuildRealm" TEXT,
    "chosenGuildId" TEXT,
    "claimedMemberId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "uploads" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CompanionDevice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DeviceCharacter" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "gameEdition" TEXT NOT NULL DEFAULT 'forever',
    "nameKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "realm" TEXT NOT NULL DEFAULT '',
    "displayName" TEXT,
    "className" TEXT,
    "race" TEXT,
    "level" INTEGER,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceCharacter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanionDevice_tokenHash_key" ON "CompanionDevice"("tokenHash");
CREATE INDEX "CompanionDevice_guildId_idx" ON "CompanionDevice"("guildId");
CREATE INDEX "CompanionDevice_claimedMemberId_idx" ON "CompanionDevice"("claimedMemberId");
CREATE UNIQUE INDEX "DeviceCharacter_deviceId_nameKey_key" ON "DeviceCharacter"("deviceId", "nameKey");
CREATE INDEX "DeviceCharacter_nameKey_idx" ON "DeviceCharacter"("nameKey");

ALTER TABLE "CompanionDevice" ADD CONSTRAINT "CompanionDevice_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CompanionDevice" ADD CONSTRAINT "CompanionDevice_claimedMemberId_fkey" FOREIGN KEY ("claimedMemberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DeviceCharacter" ADD CONSTRAINT "DeviceCharacter_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "CompanionDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
