import type { PrismaClient } from "../generated/prisma/client.js";
import { characterReference, realmKey } from "../../companion/character-identity.mjs";
import { MemberAnswerError } from "./member-answer.js";

type Db = Pick<PrismaClient, "character">;
// Thrown from services that do not know the guild's language, so it carries both.
const REQUIRED_EN = "Pick one of your linked characters for this signup: add one with /character add or link one with /character pair.";
const REQUIRED_FR = "Choisis ton personnage pour cette inscription. Ajoute-le avec /character add ou associe-le avec /character pair.";
export const CHARACTER_REQUIRED = `${REQUIRED_EN} / ${REQUIRED_FR}`;
const CHARACTER_AMBIGUOUS = `${REQUIRED_EN} Name the character and its realm. / ${REQUIRED_FR} Précise le personnage et son royaume.`;

// Resolve an owned identity, not an account's global main or another core's roster choice.
export async function ownedSignupCharacter(database: Db, guildId: string, memberId: string, value?: string | null) {
  const characters = await database.character.findMany({ where: { memberId, member: { guildId } }, orderBy: [{ name: "asc" }, { realm: "asc" }] });
  const query = value?.trim().toLowerCase();
  const ref = characterReference(value ?? "", "", "retail");
  const matches = query ? characters.filter(character => character.id.toLowerCase() === query
    || character.name.toLowerCase() === query || character.displayName?.toLowerCase() === query
    || ref.realm && character.name.toLowerCase() === ref.character.toLowerCase() && realmKey(character.realm) === ref.realm) : characters;
  if (matches.length !== 1) throw new MemberAnswerError(matches.length > 1 ? CHARACTER_AMBIGUOUS : CHARACTER_REQUIRED);
  return matches[0]!;
}
