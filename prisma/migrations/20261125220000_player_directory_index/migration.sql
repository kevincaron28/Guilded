-- /players/ and public profiles look members up by Discord account across guilds.
CREATE INDEX "Member_discordUserId_idx" ON "Member"("discordUserId");
