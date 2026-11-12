-- Craft requests made in game: the addon's own id for a request (created once per requester, so one member's id can never
-- block another's) and, when a guildmate's companion carried it, that uploader (so abuse can be traced). Plain nullable
-- columns; old rows and clients are unaffected.
ALTER TABLE "CraftRequest" ADD COLUMN "gameRef" TEXT,
  ADD COLUMN "relayedById" TEXT;

CREATE UNIQUE INDEX "CraftRequest_guildId_requesterId_gameRef_key" ON "CraftRequest"("guildId", "requesterId", "gameRef");

ALTER TABLE "CraftRequest" ADD CONSTRAINT "CraftRequest_relayedById_fkey" FOREIGN KEY ("relayedById") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;
