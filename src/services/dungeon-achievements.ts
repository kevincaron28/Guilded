import type { Prisma } from "@prisma/client";
import type { Lang } from "../i18n.js";

// Dungeon achievements (roadmap D8). Permanent, one per member per key,
// and worth no points (they can't be farmed into the leaderboard). The
// run that earned one is kept, so invalidating the run takes it back.

export const ACHIEVEMENTS = {
  firstBlood: { en: "First Blood", fr: "Premier sang", icon: "🩸", en_desc: "Complete a first dungeon", fr_desc: "Terminer un premier donjon" },
  noOneDies: { en: "No One Dies", fr: "Personne ne meurt", icon: "🛡️", en_desc: "Complete a run where every player was tracked and nobody died", fr_desc: "Terminer un donjon où tout le monde était suivi et personne n'est mort" },
  speedDemon: { en: "Speed Demon", fr: "Démon de vitesse", icon: "⚡", en_desc: "Beat a dungeon's target time", fr_desc: "Battre le temps cible d'un donjon" },
  recordBreaker: { en: "Record Breaker", fr: "Briseur de record", icon: "🏆", en_desc: "Set a new guild record", fr_desc: "Établir un nouveau record de guilde" },
  dungeonMaster: { en: "Dungeon Master", fr: "Maître des donjons", icon: "🗝️", en_desc: "Complete {count} different dungeons", fr_desc: "Terminer {count} donjons différents" },
  guildSquad: { en: "Guild Squad", fr: "Escouade de guilde", icon: "⚜️", en_desc: "Complete a run with a full group of guild members", fr_desc: "Terminer un donjon avec un groupe complet de la guilde" },
  seasonChampion: { en: "Season Champion", fr: "Champion de saison", icon: "👑", en_desc: "Most points at the end of a season", fr_desc: "Le plus de points à la fin d'une saison" }
} as const;
export type AchievementKey = keyof typeof ACHIEVEMENTS;

// "seasonChampion:<id>" -> "seasonChampion".
export function achievementBase(key: string): AchievementKey | null {
  const base = key.split(":")[0] as AchievementKey;
  return base in ACHIEVEMENTS ? base : null;
}

export function achievementName(key: string, lang: Lang, seasonName?: string | null): string {
  const base = achievementBase(key);
  if (!base) return key;
  const def = ACHIEVEMENTS[base];
  return `${def.icon} ${def[lang]}${base === "seasonChampion" && seasonName ? ` (${seasonName})` : ""}`;
}

export interface RunFacts {
  guildRecord: boolean;
  fullGuildGroup: boolean;
  underTarget: boolean;
  // Every player's deaths were tracked and all are 0.
  deathless: boolean;
}

// Which achievements a player qualifies for with this run (before checking
// what they already have). distinctDungeons includes this run.
export function qualifiedAchievements(facts: RunFacts, distinctDungeons: number, dungeonMasterCount: number): AchievementKey[] {
  const keys: AchievementKey[] = ["firstBlood"];
  if (facts.deathless) keys.push("noOneDies");
  if (facts.underTarget) keys.push("speedDemon");
  if (facts.guildRecord) keys.push("recordBreaker");
  if (facts.fullGuildGroup) keys.push("guildSquad");
  if (distinctDungeons >= dungeonMasterCount) keys.push("dungeonMaster");
  return keys;
}

type Tx = Pick<Prisma.TransactionClient, "dungeonAchievement" | "dungeonRun">;

// Grants what each linked player newly earned with a stored run.
export async function grantRunAchievements(
  tx: Tx, guildId: string, run: { id: string; seasonId: string | null },
  players: { memberId: string; character: string }[], facts: RunFacts, dungeonMasterCount: number
): Promise<{ character: string; key: AchievementKey }[]> {
  if (players.length === 0) return [];
  const existing = await tx.dungeonAchievement.findMany({
    where: { guildId, memberId: { in: players.map((player) => player.memberId) } }, select: { memberId: true, key: true }
  });
  const has = new Set(existing.map((row) => `${row.memberId}|${row.key}`));
  const granted: { character: string; key: AchievementKey }[] = [];
  for (const player of players) {
    const dungeons = await tx.dungeonRun.findMany({
      where: { guildId, valid: true, state: "COMPLETED", players: { some: { memberId: player.memberId } } },
      distinct: ["instanceId"], select: { instanceId: true }
    });
    const distinct = new Set(dungeons.map((row) => row.instanceId)).size;
    for (const key of qualifiedAchievements(facts, distinct, dungeonMasterCount)) {
      if (has.has(`${player.memberId}|${key}`)) continue;
      has.add(`${player.memberId}|${key}`);
      await tx.dungeonAchievement.create({ data: { guildId, memberId: player.memberId, key, runId: run.id, seasonId: run.seasonId } });
      granted.push({ character: player.character, key });
    }
  }
  return granted;
}
