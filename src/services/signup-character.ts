import type { PrismaClient } from "@prisma/client";

type Db = Pick<PrismaClient, "character">;
export const CHARACTER_REQUIRED = "Choisis ton personnage pour cette inscription. Ajoute-le avec /character add ou associe-le avec /character pair.";

// Resolve an owned identity, not an account's global main or another core's roster choice.
export async function ownedSignupCharacter(database: Db, guildId: string, memberId: string, value?: string | null) {
  const characters = await database.character.findMany({ where: { memberId, member: { guildId } }, orderBy: [{ name: "asc" }, { realm: "asc" }] });
  const query = value?.trim().toLowerCase();
  const matches = query ? characters.filter(character => character.id.toLowerCase() === query
    || character.name.toLowerCase() === query || `${character.name}-${character.realm}`.toLowerCase() === query) : characters;
  if (matches.length !== 1) throw new Error(CHARACTER_REQUIRED + (matches.length > 1 ? " Précise le personnage et son royaume." : ""));
  return matches[0]!;
}
