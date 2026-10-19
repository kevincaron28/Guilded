import { provisionalSeasonRules } from "./dungeon-bracket-season.js";
import { routeTargetAt, type BracketedRules } from "./dungeon-november-rules.js";
import { SCARLET_WINGS, penalized, timeRating } from "./dungeon-rating.js";
import { DEFAULT_SCHEDULE, seasonWindow, seasonWindowAt, type SeasonSchedule } from "./dungeon-season-schedule.js";
import { weekWindow } from "./dungeon-periods.js";

// Public dungeon score (website, 7.1). The same time rating as guild seasons, with the release
// season's provisional all-level rules: 200 x target / time per route (50-400), the over-level
// penalty, and each character's best N routes of a bracket summed. Public runs have no guild
// rules of their own, so the website uses this one rule set for everyone; 45-59 and 60 stay
// unrated until launch map IDs exist (dungeon-bracket-season.ts).
// Public seasons follow the monthly schedule (dungeon-season-schedule.ts, default start 4 November
// 2026); runs before Season 1 are "Beta".

export interface ScorePlayer { character: string; realm: string; className: string | null; role: string | null; level: number | null }
export interface ScoreRun {
  runId: string; instanceId: number; routeKey: string | null; difficultyId: number; dungeonName: string; durationSec: number;
  endedAt: Date; confirmations: number; players: ScorePlayer[];
}
export interface RunScore { key: string; bracket: string; points: number; penaltyPercent: number }

let cachedRules: BracketedRules | null = null;
export const publicRules = (): BracketedRules => (cachedRules ??= provisionalSeasonRules().rules);

/** Scarlet Monastery wing from the boss kills' names; the map id for every other dungeon. */
export function publicRouteKey(instanceId: number, kills: { name?: string | undefined; success: boolean }[]): string | null {
  if (instanceId !== 189) return String(instanceId);
  const names = new Set(kills.filter(k => k.success && k.name).map(k => k.name!.toLowerCase()));
  const wings = SCARLET_WINGS.filter(([, bosses]) => bosses.some(b => names.has(b)));
  return wings.length === 1 ? `189:${wings[0]![0]}` : null;
}

/** A run's rated score, or null when it is unrated (unknown route, levels unknown or out of range). */
export function scoreRun(run: ScoreRun, rules: BracketedRules = publicRules()): RunScore | null {
  const key = run.routeKey ?? (run.instanceId === 189 ? null : String(run.instanceId));
  const band = key ? rules.levelBands[key] : undefined;
  const target = key ? routeTargetAt(rules, key, run.endedAt) : undefined;
  if (!key || !band || !target || run.difficultyId !== band.difficultyId || !run.players.length) return null;
  const levels = run.players.map(p => p.level);
  if (levels.some(l => l === null)) return null;
  const over = Math.max(0, ...(levels as number[]).map(l => l - band.max));
  if (Math.min(...(levels as number[])) < band.min || over > rules.overlevelPenalty.maxLevels) return null;
  const penaltyPercent = over * rules.overlevelPenalty.percentPerLevel;
  return { key, bracket: rules.routeBracket[key]!, points: penalized(timeRating(run.durationSec, target), penaltyPercent), penaltyPercent };
}

export interface ScoreRow { player: ScorePlayer; bracket: string; points: number; routes: { key: string; points: number; run: ScoreRun; counted: boolean }[] }
export const characterId = (p: { character: string; realm: string }) => `${p.character.toLowerCase()}\0${p.realm.toLowerCase()}`;

/** Each character's score per bracket: best run per route, best N routes summed. Highest first. */
export function characterScores(runs: ScoreRun[], rules: BracketedRules = publicRules(),
  keep: (player: ScorePlayer, run: ScoreRun) => boolean = () => true): ScoreRow[] {
  const rows = new Map<string, ScoreRow>();
  const seen = new Map<string, Date>();
  for (const run of runs) {
    const score = scoreRun(run, rules);
    if (!score) continue;
    for (const player of run.players) {
      if (!keep(player, run)) continue;
      const id = `${characterId(player)}\0${score.bracket}`;
      const row = rows.get(id) ?? { player, bracket: score.bracket, points: 0, routes: [] };
      const current = row.routes.find(r => r.key === score.key);
      if (!current) row.routes.push({ key: score.key, points: score.points, run, counted: false });
      else if (score.points > current.points || score.points === current.points && run.durationSec < current.run.durationSec) Object.assign(current, { points: score.points, run });
      // The newest run names the character's class and role.
      if (!seen.has(id) || run.endedAt > seen.get(id)!) { row.player = player; seen.set(id, run.endedAt); }
      rows.set(id, row);
    }
  }
  for (const row of rows.values()) {
    const best = rules.brackets.find(b => b.key === row.bracket)?.bestCount ?? 0;
    const counted = [...row.routes].sort((a, b) => b.points - a.points || a.key.localeCompare(b.key)).slice(0, best);
    for (const route of row.routes) route.counted = counted.includes(route);
    row.points = counted.reduce((sum, r) => sum + r.points, 0);
  }
  return [...rows.values()].sort((a, b) => b.points - a.points || a.player.character.localeCompare(b.player.character));
}

// Public seasons: "beta" (before Season 1), "s1", "s2", ...; a week is the current one only.
export interface PublicPeriod { id: string; label: string; labelFr: string; from: Date | null; to: Date | null }
const FR_MONTHS: Record<string, string> = { January: "janvier", February: "février", March: "mars", April: "avril", May: "mai", June: "juin", July: "juillet",
  August: "août", September: "septembre", October: "octobre", November: "novembre", December: "décembre" };

export function publicSeasons(now: Date, schedule: SeasonSchedule = DEFAULT_SCHEDULE): PublicPeriod[] {
  const first = seasonWindow(schedule, 1);
  const current = seasonWindowAt(schedule, now)?.index ?? 0;
  const list: PublicPeriod[] = [];
  for (let i = current; i >= 1; i--) {
    const w = seasonWindow(schedule, i);
    const [, month = "", year = ""] = /· (\w+) (\d+)$/.exec(w.name) ?? [];
    list.push({ id: `s${i}`, label: w.name, labelFr: `Saison ${i} · ${FR_MONTHS[month] ?? month} ${year}`, from: w.start, to: w.end });
  }
  list.push({ id: "beta", label: "Beta (before Season 1)", labelFr: "Bêta (avant la saison 1)", from: null, to: first.start });
  return list;
}

export function publicWeek(now: Date): PublicPeriod {
  const w = weekWindow(now);
  return { id: "week", label: "This week", labelFr: "Cette semaine", from: w.start, to: w.end };
}
