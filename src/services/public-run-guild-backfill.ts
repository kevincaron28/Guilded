import { Prisma, type PrismaClient } from "../generated/prisma/client.js";

// One-off, idempotent fill of PublicRunPlayer.guild for public runs stored before the column existed (docs/plans/PUBLIC_GUILD_DIRECTORY.md).
// Only rows with no guild are touched, so it can run on every start and stops changing anything once everything reachable is filled.
//   1. The guild text the recorder's client saw for the same character in the same run (DungeonRunPlayer.guild, matched by the addon run id
//      and the character name, case-insensitive).
//   2. The in-game guild a Guilded server's roster puts the character in (GuildRosterEntry, inGuild) named by that server's WowGuild row;
//      when the player row has a realm it must equal the WowGuild's.
// Public runs are read in pages of BATCH ids; a failed batch is skipped and reported, never thrown.
const BATCH = 500;

export interface BackfillResult { runs: number; fromRuns: number; fromRosters: number }

export async function backfillPublicRunGuilds(database: Pick<PrismaClient, "publicRun" | "$executeRaw">, onError: (error: unknown) => void = () => {}): Promise<BackfillResult> {
  const result: BackfillResult = { runs: 0, fromRuns: 0, fromRosters: 0 };
  for (let cursor: string | null = null; ;) {
    const page: { id: string }[] = await database.publicRun.findMany({ where: { players: { some: { guild: null } } }, select: { id: true }, orderBy: { id: "asc" }, take: BATCH, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
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
          SELECT DISTINCT ON (pr."id", e."nameKey") pr."id" AS "runId", e."nameKey" AS "chr", w."name" AS "guildName", w."realm" AS "realm"
          FROM "PublicRun" pr
          JOIN "GuildRosterEntry" e ON e."gameEdition" = pr."gameEdition" AND e."inGuild" = true
          JOIN "WowGuild" w ON w."guildId" = e."guildId" AND w."gameEdition" = e."gameEdition"
          WHERE pr."id" = ANY(${ids}::text[])
          ORDER BY pr."id", e."nameKey", e."observedAt" DESC
        ) m
        WHERE p."runId" = m."runId" AND p."guild" IS NULL AND lower(p."character") = m."chr" AND (p."realm" = '' OR lower(p."realm") = lower(m."realm"))`));
    } catch (error) { onError(error); }
    cursor = page[page.length - 1]!.id;
    if (page.length < BATCH) return result;
  }
}
