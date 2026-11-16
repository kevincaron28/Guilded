-- "Hide my profile": Discord users who left the public pages (directory, player pages, leaderboards, run and duel listings). Default is public.
CREATE TABLE "PublicProfileHidden" (
    "discordUserId" TEXT NOT NULL,
    "hiddenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicProfileHidden_pkey" PRIMARY KEY ("discordUserId")
);
