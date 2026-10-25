import { provisionalSeasonRules } from "./dungeon-bracket-season.js";
import { createBracketedDungeonRules, routeTargetAt, validBracketedRules, type BracketedRules } from "./dungeon-november-rules.js";
import { SCARLET_WINGS, bracketedVerdict, completionReason, penalized, presentEnough, timeRating, type RatingRun } from "./dungeon-rating.js";
import type { OfficialWindow } from "./official-seasons.js";
import { weekWindow } from "./dungeon-periods.js";
import { currentEdition } from "./edition-context.js";
import type { GameEdition } from "./game-edition.js";
import type { ChallengeEvidence } from "./challenge-evidence.js";

// Public dungeon score (website, 7.1). The same time rating as guild seasons, with the release
// season's provisional all-level rules: 200 x target / time per route (50-400), the over-level
// penalty, and each character's best N routes of a bracket summed. Public runs have no guild
// rules of their own, so the website uses this one rule set for everyone; 45-59 and 60 stay
// unrated until launch map IDs exist (dungeon-bracket-season.ts).
// Public seasons follow the bot owner's calendar (official-seasons.ts, /guilded-season): Season 1
// from 4 November 2026, then whenever the owner starts the next one; runs before Season 1 are "Beta".
// 7.4 (docs/RAIDER_IO_SCORING_ANALYSIS_2026-10-22.md):
// - runs uploaded from 7.4 keep their evidence (completion method, boss kills, start levels,
//   presence) and are ranked by the guild seasons' own check (dungeon-rating.ts bracketedVerdict):
//   automatic final-boss completion, route from boss kills, party levels, 80% presence each.
//   Older rows have no evidence; they keep the levels-and-route check and pages label them;
// - each official season freezes its rules when it starts (OfficialSeason.rules), so a later code
//   change cannot rewrite its scores. It only gains routes and brackets that did not exist yet.

export interface ScorePlayer { character: string; realm: string; className: string | null; role: string | null; level: number | null;
  minLevel?: number | null; presentSec?: number | null }
export interface RunEvidence { startedAt: Date; completedBy: string | null; encounters: unknown[] }
export interface ScoreRun {
  gameEdition?: string;
  challenge?: ChallengeEvidence;
  runId: string; instanceId: number; routeKey: string | null; difficultyId: number; dungeonName: string; durationSec: number;
  endedAt: Date; confirmations: number; players: ScorePlayer[];
  /** Null on runs uploaded before 7.4. */
  evidence?: RunEvidence | null;
}
export interface RunScore { key: string; bracket: string; points: number; penaltyPercent: number }
/** A run's score, or why it is unranked (still shown as activity, with its time). */
export interface RunVerdict { score: RunScore | null; reason?: string }

let cachedRules: BracketedRules | null = null;
const editionRules = new Map<GameEdition, BracketedRules>();
export const publicRules = (edition: GameEdition = currentEdition()): BracketedRules => {
  if (edition === "forever") return (cachedRules ??= provisionalSeasonRules().rules);
  if (!editionRules.has(edition)) editionRules.set(edition, createBracketedDungeonRules({ gameEdition: edition, routes: [], brackets: [] }));
  return editionRules.get(edition)!;
};

// A season's frozen public rules (OfficialSeason.rules).
export interface PublicRuleSnapshot { format: 1; frozenAt: string; rules: BracketedRules; additions: { at: string; routes: string[]; brackets: string[] }[] }
export const snapshotRules = (rules: BracketedRules, now: Date): PublicRuleSnapshot => ({ format: 1, frozenAt: now.toISOString(), rules, additions: [] });
export function readRuleSnapshot(value: unknown): PublicRuleSnapshot | null {
  const s = value as PublicRuleSnapshot | null;
  return s && typeof s === "object" && s.format === 1 && typeof s.frozenAt === "string" && Array.isArray(s.additions) && validBracketedRules(s.rules) ? s : null;
}
/**
 * The frozen rules plus what `current` adds that did not exist when they froze (a launch route,
 * a new bracket), or null when nothing is new. Existing routes, targets, levels, best-N and the
 * penalty always keep their frozen values.
 */
export function addedRules(frozen: BracketedRules, current: BracketedRules): { rules: BracketedRules; routes: string[]; brackets: string[] } | null {
  const routes = current.routes.filter(r => !frozen.routes.some(f => f.dungeonKey === r.dungeonKey));
  const brackets = current.brackets.filter(b => !frozen.brackets.some(f => f.key === b.key));
  if (!routes.length && !brackets.length) return null;
  try {
    const rules = createBracketedDungeonRules({ ...(frozen.gameEdition ? { gameEdition: frozen.gameEdition } : {}), routes: [...frozen.routes, ...routes], brackets: [...frozen.brackets, ...brackets], overlevelPenalty: frozen.overlevelPenalty,
      ...(frozen.provisional ? { provisional: { plan: frozen.provisional.plan, waiting: current.provisional?.waiting ?? frozen.provisional.waiting } } : {}),
      ...(frozen.recalibrations ? { recalibrations: frozen.recalibrations } : {}) });
    return { rules, routes: routes.map(r => r.dungeonKey), brackets: brackets.map(b => b.key) };
  } catch { return null; }
}

// The guild seasons' run shape, from a public run's evidence.
function ratingRun(run: ScoreRun, evidence: RunEvidence): RatingRun {
  return { instanceId: run.instanceId, difficultyId: run.difficultyId, durationSec: run.durationSec, startedAt: evidence.startedAt, endedAt: run.endedAt,
    completedBy: evidence.completedBy, competitionData: { players: run.players.map(p => ({ name: p.character, level: p.level, minLevel: p.minLevel ?? null })), encounters: evidence.encounters },
    players: run.players.map(p => ({ character: p.character, memberId: null, presentSec: p.presentSec ?? 0, member: null })) };
}

/** A run's score under `rules`; with `player`, whether that character earned it (80% presence). */
export function rateRun(run: ScoreRun, rules: BracketedRules = publicRules(), player?: ScorePlayer): RunVerdict {
  if ((run.gameEdition ?? "forever") !== (rules.gameEdition ?? "forever")) return { score: null, reason: "Different WoW edition" };
  if (run.challenge || run.gameEdition === "retail" && run.difficultyId === 8) return { score: null, reason: "Mythic+ uses the keystone leaderboard" };
  if (!rules.routes.some(r => r.instanceId === run.instanceId)) return { score: null, reason: "Route not rated yet" };
  if (run.evidence) {
    const reason = completionReason(run.evidence.completedBy);
    if (reason) return { score: null, reason };
    const verdict = bracketedVerdict(ratingRun(run, run.evidence), rules);
    if (verdict.reason || !verdict.targetSec) return { score: null, reason: verdict.reason ?? "Target not calibrated" };
    if (player && !presentEnough(player.presentSec ?? 0, run.durationSec)) return { score: null, reason: "Presence under 80%" };
    return { score: { key: verdict.key, bracket: rules.routeBracket[verdict.key]!, points: penalized(timeRating(run.durationSec, verdict.targetSec), verdict.penaltyPercent), penaltyPercent: verdict.penaltyPercent } };
  }
  // Uploaded before 7.4: route, difficulty and party levels only.
  const key = run.routeKey ?? (run.instanceId === 189 ? null : String(run.instanceId));
  const band = key ? rules.levelBands[key] : undefined;
  const target = key ? routeTargetAt(rules, key, run.endedAt) : undefined;
  if (!key) return { score: null, reason: "Dungeon route unknown" };
  if (!band || !target) return { score: null, reason: "Route not rated yet" };
  if (run.difficultyId !== band.difficultyId) return { score: null, reason: "Different difficulty" };
  const levels = run.players.map(p => p.level);
  if (!levels.length || levels.some(l => l === null)) return { score: null, reason: "Party levels unknown" };
  const over = Math.max(0, ...(levels as number[]).map(l => l - band.max));
  if (over > rules.overlevelPenalty.maxLevels) return { score: null, reason: "Overlevel carry" };
  if (Math.min(...(levels as number[])) < band.min) return { score: null, reason: "Below level range" };
  const penaltyPercent = over * rules.overlevelPenalty.percentPerLevel;
  return { score: { key, bracket: rules.routeBracket[key]!, points: penalized(timeRating(run.durationSec, target), penaltyPercent), penaltyPercent } };
}

/** Scarlet Monastery wing from the boss kills' names; the map id for every other dungeon. */
export function publicRouteKey(instanceId: number, kills: { name?: string | undefined; success: boolean }[]): string | null {
  if (instanceId !== 189) return String(instanceId);
  const names = new Set(kills.filter(k => k.success && k.name).map(k => k.name!.toLowerCase()));
  const wings = SCARLET_WINGS.filter(([, bosses]) => bosses.some(b => names.has(b)));
  return wings.length === 1 ? `189:${wings[0]![0]}` : null;
}

/** A run's rated score, or null when it is unrated (rateRun says why). */
export function scoreRun(run: ScoreRun, rules: BracketedRules = publicRules()): RunScore | null {
  return rateRun(run, rules).score;
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
      if (!keep(player, run) || run.evidence && !presentEnough(player.presentSec ?? 0, run.durationSec)) continue;
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
// A season that froze its rules carries them; every other period uses today's (publicRules).
export interface PublicPeriod { id: string; label: string; labelFr: string; from: Date | null; to: Date | null; rules?: BracketedRules; frozenAt?: Date }
export const periodRules = (period: PublicPeriod): BracketedRules => period.rules ?? publicRules();
/** The rules a run ending at `date` is scored with: its season's frozen ones, else today's. */
export function rulesAt(periods: PublicPeriod[], date: Date): BracketedRules {
  return periods.find((p) => p.id !== "beta" && p.from && p.from <= date && (!p.to || date < p.to))?.rules ?? publicRules();
}
/** The calendar as the migration seeds it, for callers without a database (tests, previews). */
export const DEFAULT_OFFICIAL: OfficialWindow[] = [{ number: 1, name: "Season 1", start: new Date("2026-11-04T23:00:00Z"), end: null }];
const frenchName = (name: string) => name.replace(/^Season (\d+)/, "Saison $1");

/** Started seasons, newest first, then the beta (everything before the first season). */
export function publicSeasons(now: Date, windows: OfficialWindow[] = DEFAULT_OFFICIAL): PublicPeriod[] {
  const sorted = [...windows].sort((a, b) => a.start.getTime() - b.start.getTime());
  const list: PublicPeriod[] = sorted.filter((w) => w.start <= now).reverse()
    .map((w) => ({ id: `s${w.number}`, label: w.name, labelFr: frenchName(w.name), from: w.start, to: w.end,
      ...(w.rules ? { rules: w.rules.rules, frozenAt: new Date(w.rules.frozenAt) } : {}) }));
  list.push({ id: "beta", label: "Beta (before Season 1)", labelFr: "Bêta (avant la saison 1)", from: null, to: sorted[0]?.start ?? null });
  return list;
}

export function publicWeek(now: Date): PublicPeriod {
  const w = weekWindow(now);
  return { id: "week", label: "This week", labelFr: "Cette semaine", from: w.start, to: w.end };
}
