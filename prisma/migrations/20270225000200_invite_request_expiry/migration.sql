-- Invite request expiry (9.3.5): what the game answered per request, invites sent, the confirmation question and why a request closed.
-- Additive: no existing row changes (old waiting requests get the confirmation flow once, from the bot's sweep).
ALTER TABLE "InviteRequest" ADD COLUMN "invitesSent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastInviteAt" TIMESTAMP(3),
ADD COLUMN "gameState" TEXT,
ADD COLUMN "gameStateAt" TIMESTAMP(3),
ADD COLUMN "expiryBaseAt" TIMESTAMP(3),
ADD COLUMN "expiryBaseSent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "confirmAskedAt" TIMESTAMP(3),
ADD COLUMN "closedAt" TIMESTAMP(3),
ADD COLUMN "closeReason" TEXT;

ALTER TABLE "GuildSettings" ADD COLUMN "inviteExpiryEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "inviteExpiryDmEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "inviteSweptAt" TIMESTAMP(3);
