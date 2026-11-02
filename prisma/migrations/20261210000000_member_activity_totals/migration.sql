-- Discord activity totals (numbers only) for the message, voice and reaction achievements, and the catalogue
-- version at which a guild's announcements were last baselined quietly (0 = not yet, so new rows never flood).
ALTER TABLE "GuildSettings" ADD COLUMN "achievementBaselineVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "MemberActivityTotal" (
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messages" INTEGER NOT NULL DEFAULT 0,
    "reactionsGiven" INTEGER NOT NULL DEFAULT 0,
    "reactionsReceived" INTEGER NOT NULL DEFAULT 0,
    "voiceSeconds" INTEGER NOT NULL DEFAULT 0,
    "since" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberActivityTotal_pkey" PRIMARY KEY ("guildId","userId")
);

ALTER TABLE "MemberActivityTotal" ADD CONSTRAINT "MemberActivityTotal_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
