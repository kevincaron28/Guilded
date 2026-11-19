-- Promotion rule: ready also needs a linked character and voice time over the last 7 days (default 3 h, solo time counts).
ALTER TABLE "GuildSettings" ADD COLUMN "promotionRequireLink" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "GuildSettings" ADD COLUMN "promotionMinVoiceMinutes" INTEGER NOT NULL DEFAULT 180;

-- Raw voice time per member and hour (solo time counts, the AFK channel does not).
CREATE TABLE "MemberVoiceHour" (
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hour" TIMESTAMP(3) NOT NULL,
    "seconds" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MemberVoiceHour_pkey" PRIMARY KEY ("guildId","userId","hour")
);
CREATE INDEX "MemberVoiceHour_hour_idx" ON "MemberVoiceHour"("hour");
ALTER TABLE "MemberVoiceHour" ADD CONSTRAINT "MemberVoiceHour_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
