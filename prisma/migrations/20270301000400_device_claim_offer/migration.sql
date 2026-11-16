-- "Link these characters to you?" prompts for characters a zero-setup install reported (snooze 7 days, DM throttle, done).
CREATE TABLE "DeviceClaimOffer" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "snoozedUntil" TIMESTAMP(3),
    "dmAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceClaimOffer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeviceClaimOffer_memberId_deviceId_key" ON "DeviceClaimOffer"("memberId", "deviceId");
CREATE INDEX "DeviceClaimOffer_deviceId_idx" ON "DeviceClaimOffer"("deviceId");

ALTER TABLE "DeviceClaimOffer" ADD CONSTRAINT "DeviceClaimOffer_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeviceClaimOffer" ADD CONSTRAINT "DeviceClaimOffer_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "CompanionDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Member" ADD COLUMN "claimDmOff" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GuildSettings" ADD COLUMN "claimDmEnabled" BOOLEAN NOT NULL DEFAULT true;
