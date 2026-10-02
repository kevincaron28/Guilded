-- Welcome onboarding: a rules channel, optional rules gating, an optional one-time reminder,
-- and each Discord user's progress (rules accepted, reminder sent). Additive.
ALTER TABLE "GuildSettings" ADD COLUMN "rulesChannelId" TEXT;
ALTER TABLE "GuildSettings" ADD COLUMN "rulesGate" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GuildSettings" ADD COLUMN "onboardingNudge" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "MemberOnboarding" (
  "guildId" TEXT NOT NULL,
  "discordUserId" TEXT NOT NULL,
  "rulesAcceptedAt" TIMESTAMP(3),
  "nudgedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("guildId", "discordUserId"),
  FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
