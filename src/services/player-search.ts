import type { PrismaClient } from "@prisma/client";

type Db = Pick<PrismaClient, "character">;

// Finds the guild member behind a character name (exact match first, then
// partial, case-insensitive) and returns all of that member's characters.
export async function findPlayer(database: Db, guildId: string, query: string) {
  const name = query.trim();
  if (!name) return null;
  const where = { member: { guildId } };
  const hit = await database.character.findFirst({ where: { ...where, name: { equals: name, mode: "insensitive" } } })
    ?? await database.character.findFirst({ where: { ...where, name: { contains: name, mode: "insensitive" } }, orderBy: { isMain: "desc" } });
  if (!hit) return null;
  const characters = await database.character.findMany({
    where: { memberId: hit.memberId },
    include: { professions: true, member: true },
    orderBy: [{ isMain: "desc" }, { name: "asc" }]
  });
  const member = characters[0]?.member;
  if (!member) return null;
  return { member, characters, matched: hit.name };
}
