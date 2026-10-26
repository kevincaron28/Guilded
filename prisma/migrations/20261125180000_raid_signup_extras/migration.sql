-- Optional signup deadline per raid; existing raids keep open signups.
ALTER TABLE "Raid" ADD COLUMN "signupsCloseAt" TIMESTAMP(3);
-- A member's own "I'll be late" on their signup.
ALTER TABLE "RaidSignup" ADD COLUMN "late" BOOLEAN NOT NULL DEFAULT false;
-- Member-announced world-buff drops (Classic Era / Forever).
CREATE TABLE "WorldBuffDrop" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "buff" TEXT NOT NULL,
    "dropsAt" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorldBuffDrop_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WorldBuffDrop_guildId_dropsAt_idx" ON "WorldBuffDrop"("guildId", "dropsAt");
ALTER TABLE "WorldBuffDrop" ADD CONSTRAINT "WorldBuffDrop_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
