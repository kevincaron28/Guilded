import type { PrismaClient } from "@prisma/client";

export interface ProfessionHolder {
  character: string;
  member: string;
  isMain: boolean;
  profession: string;
  skillLevel: number;
}

export interface ProfessionCoverage {
  profession: string;
  characters: number;
  topSkill: number;
  topCharacter: string;
}

type Db = Pick<PrismaClient, "professionSkill">;

// Guild professions are few enough (a few hundred rows at most) to load and
// group in memory, which also merges "mining" / "Mining" typed differently.
async function loadGuildSkills(database: Db, guildId: string): Promise<ProfessionHolder[]> {
  const rows = await database.professionSkill.findMany({
    where: { character: { member: { guildId, status: "ACTIVE" } } },
    include: { character: { include: { member: true } } }
  });
  return rows.map((row) => ({
    character: row.character.name,
    member: row.character.member.displayName,
    isMain: row.character.isMain,
    profession: row.profession,
    skillLevel: row.skillLevel
  }));
}

// Everyone with a profession matching `query` (case-insensitive, partial:
// "alch" finds Alchemy), highest skill first.
export async function findProfessionHolders(database: Db, guildId: string, query: string): Promise<ProfessionHolder[]> {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const skills = await loadGuildSkills(database, guildId);
  return skills
    .filter((skill) => skill.profession.toLowerCase().includes(needle))
    .sort((a, b) => b.skillLevel - a.skillLevel || a.character.localeCompare(b.character));
}

// One row per profession: how many characters have it and who is highest.
export async function professionCoverage(database: Db, guildId: string): Promise<ProfessionCoverage[]> {
  const byProfession = new Map<string, ProfessionCoverage>();
  for (const skill of await loadGuildSkills(database, guildId)) {
    const key = skill.profession.trim().toLowerCase();
    const entry = byProfession.get(key);
    if (!entry) {
      byProfession.set(key, { profession: skill.profession.trim(), characters: 1, topSkill: skill.skillLevel, topCharacter: skill.character });
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
