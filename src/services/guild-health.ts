import type { PrismaClient } from "@prisma/client";

// Officer-facing picture of the guild: who plays what, whether newcomers
// stay, and a few things that need attention. Counts only.

type Db = Pick<PrismaClient, "member" | "character" | "application">;

export interface Composition {
  characters: number;
  byClass: [string, number][];
  byRace: [string, number][];
  levels: { label: string; count: number }[];
  withoutCharacter: number;
}

export interface RetentionRow {
  days: number;
  joined: number;
  stillHere: number;
}

export interface GuildHealth {
  members: number;
  composition: Composition;
  retention: RetentionRow[];
  attention: string[];
}

const LEVEL_BANDS: [string, number, number][] = [["1-19", 1, 19], ["20-39", 20, 39], ["40-59", 40, 59], ["60+", 60, 999]];

const tally = (values: (string | null)[]): [string, number][] => {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};

export function buildComposition(characters: { className: string; race: string | null; level: number | null }[], membersWithoutCharacter: number): Composition {
  return {
    characters: characters.length,
    byClass: tally(characters.map((c) => c.className)),
    byRace: tally(characters.map((c) => c.race)),
    levels: LEVEL_BANDS.map(([label, low, high]) => ({ label, count: characters.filter((c) => c.level !== null && c.level >= low && c.level <= high).length })),
    withoutCharacter: membersWithoutCharacter
  };
}

// Of the members who joined at least `days` ago, how many are still active.
// Cohorts with nobody old enough are skipped, so a young guild isn't judged.
export function buildRetention(members: { createdAt: Date; status: string }[], now: Date, cohorts = [30, 60, 90]): RetentionRow[] {
  const rows: RetentionRow[] = [];
  for (const days of cohorts) {
    const cutoff = now.getTime() - days * 86_400_000;
    const old = members.filter((member) => member.createdAt.getTime() <= cutoff);
    if (old.length === 0) continue;
    rows.push({ days, joined: old.length, stillHere: old.filter((member) => member.status !== "LEFT").length });
  }
  return rows;
}

export async function guildHealth(database: Db, guildId: string, now = new Date()): Promise<GuildHealth> {
  const [members, characters, openApplications] = await Promise.all([
    database.member.findMany({ where: { guildId, isTest: false }, select: { createdAt: true, status: true, _count: { select: { characters: true } } } }),
    database.character.findMany({ where: { member: { guildId, isTest: false, status: { not: "LEFT" } } }, select: { className: true, race: true, level: true } }),
    database.application.count({ where: { guildId, status: { in: ["PENDING", "TRIAL"] } } })
  ]);
  const active = members.filter((member) => member.status !== "LEFT");
  const withoutCharacter = active.filter((member) => member._count.characters === 0).length;
  const composition = buildComposition(characters, withoutCharacter);
  const retention = buildRetention(members, now);
  const attention: string[] = [];
  if (withoutCharacter > 0) attention.push(`${withoutCharacter} member(s) have no linked character (they can use /character pair or /character import).`);
  if (openApplications > 0) attention.push(`${openApplications} open application(s) waiting for a decision.`);
  for (const row of retention) {
    const rate = Math.round((row.stillHere / row.joined) * 100);
    if (row.joined >= 5 && rate < 60) attention.push(`Only ${rate}% of members who joined ${row.days}+ days ago are still here.`);
  }
  const healers = composition.byClass.filter(([name]) => ["Priest", "Druid", "Paladin", "Shaman"].includes(name)).reduce((sum, [, count]) => sum + count, 0);
  if (characters.length >= 10 && healers / characters.length < 0.15) attention.push("Few healer-capable classes (Priest, Druid, Paladin, Shaman) among the characters.");
  return { members: active.length, composition, retention, attention };
}

export function formatHealth(health: GuildHealth): string {
  const top = (rows: [string, number][], n: number) => rows.slice(0, n).map(([name, count]) => `${name} ${count}`).join(", ") || "-";
  const lines = [
    `**${health.members} active members, ${health.composition.characters} characters**`,
    `Classes: ${top(health.composition.byClass, 12)}`,
    `Races: ${top(health.composition.byRace, 8)}`,
    `Levels: ${health.composition.levels.map((band) => `${band.label}: ${band.count}`).join(" · ")}`,
    health.retention.length
      ? `Retention: ${health.retention.map((row) => `${row.days}d ${Math.round((row.stillHere / row.joined) * 100)}% (${row.stillHere}/${row.joined})`).join(" · ")}`
      : "Retention: not enough history yet.",
    health.attention.length ? `\n**Needs attention**\n${health.attention.map((item) => `• ${item}`).join("\n")}` : "\nNothing needs attention. ✅"
  ];
  return lines.join("\n");
}
