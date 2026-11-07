-- 9.1 character pictures: one re-encoded picture per character, and the server switch (on by default).
ALTER TABLE "GuildSettings" ADD COLUMN "characterPicturesEnabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "CharacterPicture" (
    "id" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "large" BYTEA NOT NULL,
    "thumb" BYTEA NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL DEFAULT 'upload',
    "visibility" TEXT NOT NULL DEFAULT 'guild',
    "status" TEXT NOT NULL DEFAULT 'ok',
    "removedById" TEXT,
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CharacterPicture_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CharacterPicture_characterId_key" ON "CharacterPicture"("characterId");
CREATE INDEX "CharacterPicture_guildId_idx" ON "CharacterPicture"("guildId");

ALTER TABLE "CharacterPicture" ADD CONSTRAINT "CharacterPicture_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
