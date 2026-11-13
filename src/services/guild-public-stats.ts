// Stats for one guild's public page (/leaderboards/guild/<slug>), computed from the same public runs and the same
// scores as every other leaderboard (characterScores): no second scoring. Dungeons are grouped by instance id, never
// by name: a French client uploads "Profondeurs de Brassenoire" and an English one "Blackfathom Deeps" for instance 48.

import { slugFromName } from "./guild-page.js";
import { characterScores } from "./public-score.js";
import type { LeaderPlayer, LeaderRun, PublicGuild } from "./public-leaderboard.js";
import type { BracketedRules } from "./dungeon-november-rules.js";
import { characterKey } from "../../companion/character-identity.mjs";

const SLUG_MAX = 36;

/** Readable address of every guild: the slug of its name, "-2", "-3"... for later guilds with the same slug (stable: input order is by name, then id). */
export function guildSlugs(guilds: PublicGuild[]): Map<string, string> {
  const sorted = [...guilds].sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const taken = new Set<string>();
  const out = new Map<string, string>();
  for (const guild of sorted) {
    const base = slugFromName(guild.name).slice(0, SLUG_MAX).replace(/-+$/, "") || "guild";
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
    taken.add(slug);
    out.set(guild.id, slug);
  }
  return out;
}

const rosterHas = (roster: ReadonlySet<string>, player: LeaderPlayer, edition: string) =>
  [player.character, ...(player.aliases ?? [])].some((name) => roster.has(characterKey(name, player.realm, edition)));

export interface GuildDungeonRow { instanceId: number; name: string; runs: number; bestSec: number; bestRunId: string; bestAt: Date; record: boolean }
export interface GuildTopPlayer { player: LeaderPlayer; bracket: string; points: number }
export interface GuildPageStats {
  /** Members of the guild with a ranked score in the period. */
  ranked: number;
  /** Public runs of the period with at least one member. */
  runs: number;
  dungeons: GuildDungeonRow[];
  /** Best ranked member per role. */
  topByRole: { role: string; row: GuildTopPlayer }[];
  /** Runs per week (week starting Monday, UTC, ISO date), oldest first. */
  activity: { week: string; runs: number }[];
  records: number;
}

/** Why a guild has no rank in a period, or null when it has one. */
export type UnrankedReason = "no-runs" | "no-member-in-runs" | "no-ranked-member";

export const weekStart = (date: Date): string => {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
};

export function guildPageStats(runs: LeaderRun[], roster: string[], rules: BracketedRules, allRuns: LeaderRun[], edition = "forever"): GuildPageStats {
  const members = new Set(roster.map((name) => name.toLowerCase()));
  const own = runs.filter((run) => !run.challenge && run.players.some((p) => rosterHas(members, p, edition)));
  const scores = characterScores(own, rules).filter((row) => rosterHas(members, row.player as LeaderPlayer, edition));

  const fastest = new Map<number, LeaderRun>();
  for (const run of allRuns) {
    if (run.challenge) continue;
    const best = fastest.get(run.instanceId);
    if (!best || run.durationSec < best.durationSec || (run.durationSec === best.durationSec && run.endedAt < best.endedAt)) fastest.set(run.instanceId, run);
  }
  const byInstance = new Map<number, LeaderRun[]>();
  for (const run of own) byInstance.set(run.instanceId, [...(byInstance.get(run.instanceId) ?? []), run]);
  const dungeons: GuildDungeonRow[] = [...byInstance.entries()].map(([instanceId, list]) => {
    const best = list.reduce((a, b) => b.durationSec < a.durationSec || (b.durationSec === a.durationSec && b.endedAt < a.endedAt) ? b : a);
    const names = new Map<string, { n: number; at: number }>();
    for (const run of list) { const row = names.get(run.dungeonName) ?? { n: 0, at: 0 }; row.n++; row.at = Math.max(row.at, run.endedAt.getTime()); names.set(run.dungeonName, row); }
    const name = [...names.entries()].sort((a, b) => b[1].n - a[1].n || b[1].at - a[1].at || a[0].localeCompare(b[0]))[0]![0];
    const top = fastest.get(instanceId);
    return { instanceId, name, runs: list.length, bestSec: best.durationSec, bestRunId: best.runId, bestAt: best.endedAt, record: !!top && top.players.some((p) => rosterHas(members, p, edition)) };
  }).sort((a, b) => a.instanceId - b.instanceId);

  const topByRole: GuildPageStats["topByRole"] = [];
  for (const role of ["TANK", "HEALER", "DPS"]) {
    const row = scores.filter((r) => r.player.role === role).sort((a, b) => b.points - a.points || a.player.character.localeCompare(b.player.character))[0];
    if (row) topByRole.push({ role, row: { player: row.player as LeaderPlayer, bracket: row.bracket, points: row.points } });
  }

  const weeks = new Map<string, number>();
  for (const run of own) { const key = weekStart(run.endedAt); weeks.set(key, (weeks.get(key) ?? 0) + 1); }
  // Fill empty weeks inside the observed span so a gap shows as a gap.
  const keys = [...weeks.keys()].sort();
  const activity: GuildPageStats["activity"] = [];
  if (keys.length) {
    for (let at = new Date(`${keys[0]}T00:00:00Z`); at <= new Date(`${keys[keys.length - 1]}T00:00:00Z`); at = new Date(at.getTime() + 7 * 86_400_000)) {
      const key = at.toISOString().slice(0, 10);
      activity.push({ week: key, runs: weeks.get(key) ?? 0 });
    }
  }
  return { ranked: new Set(scores.map((row) => `${row.player.character}|${row.player.realm}`.toLowerCase())).size, runs: own.length, dungeons, topByRole, activity, records: dungeons.filter((d) => d.record).length };
}

export function unrankedReason(runs: LeaderRun[], stats: GuildPageStats): UnrankedReason | null {
  if (stats.ranked) return null;
  if (!runs.filter((run) => !run.challenge).length) return "no-runs";
  return stats.runs ? "no-ranked-member" : "no-member-in-runs";
}
