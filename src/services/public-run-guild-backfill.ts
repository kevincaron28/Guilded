import { Prisma, type PrismaClient } from "../generated/prisma/client.js";

// One-off, idempotent fill of PublicRunPlayer.guild for public runs stored before the column existed (docs/plans/PUBLIC_GUILD_DIRECTORY.md).
// Only rows with no guild are touched. Each run is looked at once: after a batch its runs get PublicRun.guildBackfillAt (covered or not),
// so runs no source covers are not rescanned on every start. Sources, in order:
//   1. The guild text the recording client saw for the same character in the same run (DungeonRunPlayer.guild, matched by the addon run
//      id and the character name, case-insensitive).
//   2. The in-game guild named by a WowGuild row of the Discord server that holds this very run (DungeonRun.guildId), for a character on
//      that server's roster (GuildRosterEntry, inGuild). Never a roster from another server; a run without a server of ours gets nothing here.
//      When the player row has a realm it must equal the WowGuild's. A server with several WowGuilds is ambiguous: a guild is taken only
//      when it is the server's only one for that edition, or when a recording client of this run named it; otherwise the row is skipped.
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
          SELECT DISTINCT ON (p2."id") p2."id" AS "playerId", w."name" AS "guildName"
          FROM "PublicRunPlayer" p2
          JOIN "PublicRun" pr ON pr."id" = p2."runId"
          JOIN "DungeonRun" r ON r."runRef" = pr."runRef"
          JOIN "GuildRosterEntry" e ON e."guildId" = r."guildId" AND e."gameEdition" = pr."gameEdition" AND e."inGuild" = true AND e."nameKey" = lower(p2."character")
          JOIN "WowGuild" w ON w."guildId" = r."guildId" AND w."gameEdition" = pr."gameEdition"
          WHERE p2."runId" = ANY(${ids}::text[]) AND p2."guild" IS NULL AND (p2."realm" = '' OR lower(p2."realm") = lower(w."realm"))
            AND (
              (SELECT count(*) FROM "WowGuild" w2 WHERE w2."guildId" = r."guildId" AND w2."gameEdition" = pr."gameEdition") = 1
              OR EXISTS (SELECT 1 FROM "DungeonRunPlayer" dq WHERE dq."runId" = r."id" AND lower(dq."guild") = lower(w."name"))
            )
          ORDER BY p2."id", e."observedAt" DESC, w."createdAt"
        ) m
        WHERE p."id" = m."playerId" AND p."guild" IS NULL`));
      // Covered or not, these runs have been looked at.
      await database.$executeRaw(Prisma.sql`UPDATE "PublicRun" SET "guildBackfillAt" = now() WHERE "id" = ANY(${ids}::text[])`);
    } catch (error) { onError(error); }
    cursor = page[page.length - 1]!.id;
    if (page.length < BATCH) return result;
  }
}
