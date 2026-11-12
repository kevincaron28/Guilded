-- Craft requests made in game: the addon's own id for a request (created once per server) and, when a guildmate's
-- companion carried it, that uploader (so abuse can be traced). Plain nullable columns; old rows and clients are unaffected.
ALTER TABLE "CraftRequest" ADD COLUMN "gameRef" TEXT,
  ADD COLUMN "relayedById" TEXT;

CREATE UNIQUE INDEX "CraftRequest_guildId_gameRef_key" ON "CraftRequest"("guildId", "gameRef");
