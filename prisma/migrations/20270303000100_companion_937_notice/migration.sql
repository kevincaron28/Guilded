-- (9.3.8) Which companion release last called with each credential / device key, and the one-DM-per-user notice marker.
ALTER TABLE "CompanionCredential" ADD COLUMN "companionVersion" TEXT;
ALTER TABLE "CompanionCredential" ADD COLUMN "companionVersionAt" TIMESTAMP(3);
ALTER TABLE "CompanionDevice" ADD COLUMN "companionVersion" TEXT;
ALTER TABLE "CompanionDevice" ADD COLUMN "companionVersionAt" TIMESTAMP(3);

CREATE TABLE "CompanionNotice" (
    "id" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "outcome" TEXT NOT NULL DEFAULT 'sending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanionNotice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanionNotice_discordUserId_kind_key" ON "CompanionNotice"("discordUserId", "kind");
