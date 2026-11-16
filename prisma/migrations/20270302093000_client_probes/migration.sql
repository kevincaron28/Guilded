-- The latest client probe (/guilded probe ...) per kind, WoW client build and edition, uploaded by companions; read by the owner's /guilded-probes.
CREATE TABLE "ClientProbe" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "build" TEXT NOT NULL,
    "edition" TEXT NOT NULL DEFAULT 'forever',
    "data" JSONB NOT NULL,
    "probedAt" TIMESTAMP(3),
    "companionVersion" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientProbe_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientProbe_kind_build_edition_key" ON "ClientProbe"("kind", "build", "edition");
