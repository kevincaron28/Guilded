import type { PrismaClient } from "../generated/prisma/client.js";
import { lastSeenOf } from "./last-seen.js";
import { normalizeProfessionName, professionSlug, professionSpellings } from "./profession-names.js";

export interface ProfessionHolder {
  character: string;
  member: string;
  isMain: boolean;
  profession: string;
  skillLevel: number;
  /** Character.lastSeenAt, or the newest recipe scan of the character when the roster has none (8.5 track D3). */
  lastSeen: Date | null;
}

export interface ProfessionCoverage {
  profession: string;
  characters: number;
  topSkill: number;
  topCharacter: string;
}

type Db = Pick<PrismaClient, "professionSkill"> & Partial<Pick<PrismaClient, "recipeKnown">>;

// Guild professions are few enough (a few hundred rows at most) to load and
// group in memory, which also merges "mining" / "Mining" typed differently.
export async function loadGuildSkills(database: Db, guildId: string): Promise<ProfessionHolder[]> {
  const rows = await database.professionSkill.findMany({
    where: { character: { member: { guildId, status: "ACTIVE" } } },
    include: { character: { include: { member: true } } }
  });
  // The fallback date: the newest recipe scan per character name, only for characters the roster never saw.
  const unseen = rows.filter((row) => !row.character.lastSeenAt).map((row) => row.character.name);
  const scans = new Map<string, Date>();
  if (unseen.length && database.recipeKnown) {
    const grouped = await database.recipeKnown.groupBy({ by: ["character"], where: { guildId, character: { in: [...new Set(unseen)] } }, _max: { scannedAt: true } });
    for (const row of grouped) if (row._max.scannedAt) scans.set(row.character.toLowerCase(), row._max.scannedAt);
  }
  return rows.map((row) => ({
    character: row.character.name,
    member: row.character.member.displayName,
    isMain: row.character.isMain,
    profession: row.profession,
    skillLevel: row.skillLevel,
    lastSeen: lastSeenOf(row.character.lastSeenAt, scans.get(row.character.name.toLowerCase()))
  }));
}

// Everyone with a profession matching `query` (case-insensitive, partial:
// "alch" finds Alchemy), highest skill first. A French "cuis" finds rows stored as "Cooking" and the reverse: the query is
// compared with the stored name, the canonical name and every client spelling of the profession.
export async function findProfessionHolders(database: Db, guildId: string, query: string): Promise<ProfessionHolder[]> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const skills = await loadGuildSkills(database, guildId);
  return skills
    .filter((skill) => {
      const spellings = professionSpellings(normalizeProfessionName(skill.profession));
      return skill.profession.toLowerCase().includes(needle) || spellings.some((spelling) => spelling.toLowerCase().includes(needle));
    })
    .sort((a, b) => b.skillLevel - a.skillLevel || a.character.localeCompare(b.character));
}

// One row per profession: how many characters have it and who is highest.
export async function professionCoverage(database: Db, guildId: string): Promise<ProfessionCoverage[]> {
  const byProfession = new Map<string, ProfessionCoverage>();
  for (const skill of await loadGuildSkills(database, guildId)) {
    const key = professionSlug(skill.profession);
    const entry = byProfession.get(key);
    if (!entry) {
      byProfession.set(key, { profession: normalizeProfessionName(skill.profession), characters: 1, topSkill: skill.skillLevel, topCharacter: skill.character });
    } else {
      entry.characters++;
      if (skill.skillLevel > entry.topSkill) {
        entry.topSkill = skill.skillLevel;
        entry.topCharacter = skill.character;
      }
    }
  }
  return [...byProfession.values()].sort((a, b) => a.profession.localeCompare(b.profession));
}
