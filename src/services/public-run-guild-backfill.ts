import { Prisma, type PrismaClient } from "../generated/prisma/client.js";

// One-off, idempotent fill of PublicRunPlayer.guild for public runs stored before the column existed (docs/plans/PUBLIC_GUILD_DIRECTORY.md).
// Only rows with no guild are touched. Each run is looked at once: after a batch its runs get PublicRun.guildBackfillAt (covered or not),
// so runs no source covers are not rescanned on every start. Sources, in order:
//   1. The guild text the recording client saw for the same character in the same run (DungeonRunPlayer.guild, matched by the addon run
//      id and the character name, case-insensitive).
//   2. The in-game guild of the Discord server that holds this very run (DungeonRun.guildId), for a character on that server's roster
//      (GuildRosterEntry, inGuild; the key is the NFC lower-case full name). A scoped Guild (one per registered in-game guild) and a default
//      server with exactly one unscoped WowGuild use that WowGuild; with several, a guild is taken only when a recording client of this run
//      named it. A server with no WowGuild row (most) uses the in-game guild its own companions reported (CompanionDevice.wowGuildName,
//      non-revoked devices linked to that server): only when at least 2 devices report it and no other name appears. The Discord server's
//      name (Guild.name, often decorated: "Quebec Gold" with emojis) is never used: it is not the in-game guild. Otherwise the row is
//      skipped. With a WowGuild and a realm on the player row the realms must be equal. Never a roster from another server.
// Public runs are read in pages of BATCH ids; a failed batch is reported and left unmarked (retried next start), never thrown.
const BATCH = 500;

export interface BackfillResult { runs: number; fromRuns: number; fromRosters: number }

export async function backfillPublicRunGuilds(database: Pick<PrismaClient, "publicRun" | "$executeRaw">, onError: (error: unknown) => void = () => {}): Promise<BackfillResult> {
  const result: BackfillResult = { runs: 0, fromRuns: 0, fromRosters: 0 };
  for (let cursor: string | null = null; ;) {
    const page: { id: string }[] = await database.publicRun.findMany({ where: { guildBackfillAt: null, players: { some: { guild: null } } }, select: { id: true }, orderBy: { id: "asc" }, take: BATCH, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    if (!page.length) return result;
    const ids = page.map((row) => row.id);
    result.runs += ids.length;
    try {
      result.fromRuns += Number(await database.$executeRaw(Prisma.sql`
        UPDATE "PublicRunPlayer" AS p SET "guild" = s."guild"
        FROM (
          SELECT DISTINCT ON (pr."id", lower(dp."character")) pr."id" AS "runId", lower(dp."character") AS "chr", dp."guild" AS "guild"
          FROM "PublicRun" pr
          JOIN "DungeonRun" r ON r."runRef" = pr."runRef"
          JOIN "DungeonRunPlayer" dp ON dp."runId" = r."id"
          WHERE pr."id" = ANY(${ids}::text[]) AND dp."guild" IS NOT NULL AND dp."guild" <> ''
          ORDER BY pr."id", lower(dp."character"), r."createdAt" DESC
        ) s
        WHERE p."runId" = s."runId" AND p."guild" IS NULL AND lower(p."character") = s."chr"`));
      result.fromRosters += Number(await database.$executeRaw(Prisma.sql`
        UPDATE "PublicRunPlayer" AS p SET "guild" = m."guildName"
        FROM (
          SELECT DISTINCT ON (p2."id") p2."id" AS "playerId", COALESCE(w."name", dn."name") AS "guildName"
          FROM "PublicRunPlayer" p2
          JOIN "PublicRun" pr ON pr."id" = p2."runId"
          JOIN "DungeonRun" r ON r."runRef" = pr."runRef"
          JOIN "Guild" g ON g."id" = r."guildId"
          JOIN "GuildRosterEntry" e ON e."guildId" = r."guildId" AND e."gameEdition" = pr."gameEdition" AND e."inGuild" = true AND e."nameKey" = lower(normalize(p2."character", NFC))
          LEFT JOIN "WowGuild" w ON w."gameEdition" = pr."gameEdition"
            AND (CASE WHEN g."scopeKey" <> 'default' THEN w."scopeGuildId" = g."id" ELSE (w."guildId" = g."id" AND w."scopeGuildId" IS NULL) END)
          LEFT JOIN LATERAL (
            SELECT min(d."wowGuildName") AS "name" FROM "CompanionDevice" d
            WHERE d."guildId" = g."id" AND d."revokedAt" IS NULL AND d."wowGuildName" IS NOT NULL AND d."wowGuildName" <> ''
            HAVING count(*) >= 2 AND count(DISTINCT lower(d."wowGuildName")) = 1
          ) dn ON true
          WHERE p2."runId" = ANY(${ids}::text[]) AND p2."guild" IS NULL AND (w."id" IS NOT NULL OR dn."name" IS NOT NULL)
            AND (w."id" IS NULL OR p2."realm" = '' OR lower(p2."realm") = lower(w."realm"))
            AND (
              w."id" IS NULL OR g."scopeKey" <> 'default'
              OR (SELECT count(*) FROM "WowGuild" w2 WHERE w2."guildId" = g."id" AND w2."scopeGuildId" IS NULL AND w2."gameEdition" = pr."gameEdition") = 1
              OR EXISTS (SELECT 1 FROM "DungeonRunPlayer" dq WHERE dq."runId" = r."id" AND lower(dq."guild") = lower(w."name"))
            )
          ORDER BY p2."id", e."observedAt" DESC, w."createdAt" NULLS LAST
        ) m
        WHERE p."id" = m."playerId" AND p."guild" IS NULL`));
      // Covered or not, these runs have been looked at.
      await database.$executeRaw(Prisma.sql`UPDATE "PublicRun" SET "guildBackfillAt" = now() WHERE "id" = ANY(${ids}::text[])`);
    } catch (error) { onError(error); }
    cursor = page[page.length - 1]!.id;
    if (page.length < BATCH) return result;
  }
}
