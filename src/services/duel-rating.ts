import { weekStart } from "./dungeon-rules.js";
import { getSeasonCalendar, laterSeasonAt, nextSeasonAfter, officialSeasonName } from "./season-calendar.js";

// Duel rating (rule set C of docs/DUEL_SCORING_RESEARCH.md; owner decision 13 November 2026, "rating with caution").
// An Elo-style rating that starts at 1000 each season, shown shrunk toward 1000 while a record is short. Pure functions over
// the stored COUNTED duels (the 5-per-pair-per-day and 25-per-reporter-per-day caps are applied when a duel is imported):
// a season's ratings are always recomputed from those duels in date order, never accumulated blindly, so a duel reported late
// is simply placed where it belongs. The in-game addon must follow docs/DUEL_RATING_ADDON_SPEC.md and the shared test
// vectors in tests/fixtures/duel-rating-vectors.json.
//
// Time: every boundary is UTC (like the weekly reset in dungeon-rules.ts and the per-day duel cap). Seasons follow the owner's
// official season calendar (season-calendar.ts, owner decision 16 November 2026): the season that began on 13 November is "Season 1"
// and runs until the official Season 2 starts (9 December 2026, 15:00 Pacific); from then on a duel season IS the official season
// (id "S2", "S3"...). With no later season scheduled the current one simply continues. Old "YYYY-MM" ids stay readable: the id
// of the first season is still the "YYYY-MM" of its start ("2026-11"), and any other old month id is shown as a month. The pair
// weight window is the existing weekly reset (Tuesday 15:00 UTC).

export const RATING = {
  id: "rating-v1",
  /** The ladders start here (13 November 2026 00:00 UTC, owner decision). Duels that ended before it are archived test data and appear nowhere. */
  startsAt: "2026-11-13T00:00:00.000Z",
  start: 1000,
  /** K by the number of RATED duels the player already has: below `upTo` use `k`. */
  kBands: [{ upTo: 10, k: 40 }, { upTo: 30, k: 24 }, { upTo: 1_000_000, k: 16 }],
  /** Rating points added to the loser's side per level the loser is above the winner (negative below), up to this many levels. */
  handicapPerLevel: 20,
  handicapMaxLevels: 5,
  /** A duel between players more than this many levels apart (both levels known) counts for nothing. */
  maxLevelGap: 10,
  /** The shown score is start + (rating - start) * rated / (rated + shrinkGames). */
  shrinkGames: 10,
  /** Ranked once the player has this many rated duels against this many distinct opponents. */
  rankedDuels: 1,
  rankedOpponents: 1
} as const;

/**
 * The one switch: set the environment variable DUEL_RATING=off and every board goes back to the points ladder (counting only duels since the
 * start) without a deploy of code. Unset (the default) = the rating is on.
 */
export const RATING_SWITCHED_ON = process.env["DUEL_RATING"] !== "off";
export const RATING_START = RATING_SWITCHED_ON ? new Date(RATING.startsAt) : new Date("2100-01-01T00:00:00.000Z");

export interface RatedDuel {
  /** Member ids (any stable string; never printed). */
  winnerKey: string; loserKey: string;
  winnerName: string; loserName: string;
  winnerLevel: number | null; loserLevel: number | null;
  endedAt: Date;
}

export interface RatedPlayer {
  key: string; name: string; level: number | null;
  /** The raw rating. */
  rating: number;
  /** The shown score: the rating shrunk toward the start while the record is short. */
  score: number;
  /** Every counted duel of the season, and the ones that moved ratings. */
  games: number; rated: number; wins: number; losses: number; opponents: number;
  ranked: boolean;
  streak: number; bestStreak: number; lastAt: Date;
}

export interface RatingChange {
  /** What each side's shown score moved by in this duel (winner up, loser down; zero when the duel was not rated). */
  winnerDelta: number; loserDelta: number;
  winnerScore: number; loserScore: number;
  /** False when the duel moved nothing: the same pair already used its weekly allowance, or the levels were too far apart. */
  rated: boolean;
}

export interface SeasonInfo { id: string; from: Date; to: Date | null; rated: boolean; /** The official season number (1 for the first season). Absent before the start. */ number?: number }

/** The id of an official season from number 2 on: "S2", "S3"... (the first season keeps its old "YYYY-MM" id). */
export const officialSeasonId = (number: number) => `S${number}`;
const monthId = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;

/**
 * The rating season a time falls in: "s0" before the start (archived: no board shows it); the first season (from the start until the
 * official Season 2 begins, id "YYYY-MM" of the start month, "2026-11"); then one season per official season ("S2", "S3"...).
 */
export function seasonOf(at: Date, startsAt: Date = RATING_START, calendar = getSeasonCalendar()): SeasonInfo {
  if (at < startsAt) return { id: "s0", from: new Date(0), to: startsAt, rated: false };
  const later = laterSeasonAt(at, calendar);
  if (later && later.start > startsAt) {
    return { id: officialSeasonId(later.number), from: later.start, to: nextSeasonAfter(at, calendar)?.start ?? null, rated: true, number: later.number };
  }
  return { id: monthId(startsAt), from: startsAt, to: nextSeasonAfter(at, calendar)?.start ?? null, rated: true, number: 1 };
}

/** Which rules apply to a duel that ended at `at`. */
export const ratingApplies = (at: Date, startsAt: Date = RATING_START) => at >= startsAt;

export const kFor = (ratedDuels: number) => RATING.kBands.find(band => ratedDuels < band.upTo)!.k;
/**
 * Repeat duels between the same pair inside one weekly-reset window move ratings by a fraction that depends on how many came before.
 * The fractions are server configuration (environment DUEL_PAIR_WEIGHTS, a JSON array: the n-th duel uses entry n, later ones count for nothing),
 * not part of the published rules. Unset or invalid: no reduction.
 */
export function loadPairWeights(env: Record<string, string | undefined> = process.env): readonly number[] | null {
  const raw = env["DUEL_PAIR_WEIGHTS"];
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) && value.every(item => typeof item === "number" && item >= 0 && item <= 1) ? value : null;
  } catch { return null; }
}
export const PAIR_WEIGHTS = loadPairWeights();
export const pairWeight = (nth: number, weights: readonly number[] | null = PAIR_WEIGHTS) => weights ? weights[nth] ?? 0 : 1;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** Rating points added to the loser's side for the level difference; 0 when either level is unknown. */
export function levelHandicap(winnerLevel: number | null, loserLevel: number | null): number {
  if (!winnerLevel || !loserLevel) return 0;
  return RATING.handicapPerLevel * clamp(loserLevel - winnerLevel, -RATING.handicapMaxLevels, RATING.handicapMaxLevels);
}

/** The winner's expected score against the loser, from their ratings and the level handicap. */
export function expectedScore(winnerRating: number, loserRating: number, handicap: number): number {
  return 1 / (1 + 10 ** ((loserRating + handicap - winnerRating) / 400));
}

/** The shown score of a rating after `rated` rated duels. */
export const shrunk = (rating: number, rated: number) => RATING.start + (rating - RATING.start) * rated / (rated + RATING.shrinkGames);

export const isRanked = (rated: number, opponents: number) => rated >= RATING.rankedDuels && opponents >= RATING.rankedOpponents;

/** Placement progress for an unranked player: duels and distinct opponents still needed. */
export const placement = (rated: number, opponents: number) => ({ duels: Math.min(rated, RATING.rankedDuels), needDuels: RATING.rankedDuels, opponents: Math.min(opponents, RATING.rankedOpponents), needOpponents: RATING.rankedOpponents });

const byOrder = (a: RatedDuel, b: RatedDuel) => a.endedAt.getTime() - b.endedAt.getTime()
  || a.winnerName.toLowerCase().localeCompare(b.winnerName.toLowerCase()) || a.loserName.toLowerCase().localeCompare(b.loserName.toLowerCase());

/**
 * Rates ONE season's counted duels. The caller passes the duels of that season only (every player starts at `RATING.start`).
 * Order: ended-at, then winner name, then loser name (lower case), so the result does not depend on the order of arrival.
 * `changes` is parallel to `ordered`.
 */
export function rateSeason(duels: readonly RatedDuel[], pairWeights: readonly number[] | null = PAIR_WEIGHTS): { players: Map<string, RatedPlayer>; ordered: RatedDuel[]; changes: RatingChange[] } {
  const ordered = [...duels].sort(byOrder);
  const players = new Map<string, RatedPlayer & { run: number; seen: Set<string> }>();
  const entry = (key: string, name: string, level: number | null, at: Date) => {
    let row = players.get(key);
    if (!row) { row = { key, name, level, rating: RATING.start, score: RATING.start, games: 0, rated: 0, wins: 0, losses: 0, opponents: 0, ranked: false, streak: 0, bestStreak: 0, lastAt: at, run: 0, seen: new Set() }; players.set(key, row); }
    row.name = name; row.lastAt = at; if (level !== null) row.level = level;
    return row;
  };
  const pairs = new Map<string, number>();
  const changes: RatingChange[] = [];
  for (const duel of ordered) {
    const w = entry(duel.winnerKey, duel.winnerName, duel.winnerLevel, duel.endedAt), l = entry(duel.loserKey, duel.loserName, duel.loserLevel, duel.endedAt);
    w.games++; l.games++; w.wins++; l.losses++;
    w.run = w.run > 0 ? w.run + 1 : 1; w.bestStreak = Math.max(w.bestStreak, w.run); l.run = l.run < 0 ? l.run - 1 : -1;
    const pair = `${[duel.winnerKey, duel.loserKey].sort().join("|")}|${weekStart(duel.endedAt).getTime()}`;
    const nth = pairs.get(pair) ?? 0; pairs.set(pair, nth + 1);
    const tooFar = !!duel.winnerLevel && !!duel.loserLevel && Math.abs(duel.winnerLevel - duel.loserLevel) > RATING.maxLevelGap;
    const weight = tooFar ? 0 : pairWeight(nth, pairWeights);
    if (weight === 0) { changes.push({ winnerDelta: 0, loserDelta: 0, winnerScore: w.score, loserScore: l.score, rated: false }); continue; }
    const before = { w: w.score, l: l.score };
    const gain = 1 - expectedScore(w.rating, l.rating, levelHandicap(duel.winnerLevel, duel.loserLevel));
    const kw = kFor(w.rated), kl = kFor(l.rated);
    w.rating += kw * weight * gain; l.rating -= kl * weight * gain;
    w.rated++; l.rated++; w.seen.add(duel.loserKey); l.seen.add(duel.winnerKey);
    w.opponents = w.seen.size; l.opponents = l.seen.size;
    w.score = shrunk(w.rating, w.rated); l.score = shrunk(l.rating, l.rated);
    changes.push({ winnerDelta: w.score - before.w, loserDelta: l.score - before.l, winnerScore: w.score, loserScore: l.score, rated: true });
  }
  for (const row of players.values()) { row.ranked = row.games > 0 || isRanked(row.rated, row.opponents); row.streak = row.run; }
  const out = new Map<string, RatedPlayer>();
  for (const [key, row] of players) out.set(key, { key, name: row.name, level: row.level, rating: row.rating, score: row.score, games: row.games, rated: row.rated, wins: row.wins, losses: row.losses,
    opponents: row.opponents, ranked: row.ranked, streak: row.streak, bestStreak: row.bestStreak, lastAt: row.lastAt });
  return { players: out, ordered, changes };
}

/** Pure: everyone with a counted duel is ranked, by shown score, then wins. */
export function ratingStandings(players: ReadonlyMap<string, RatedPlayer>): (RatedPlayer & { rank: number | null })[] {
  const all = [...players.values()];
  const ranked = all.filter(row => row.ranked).sort((a, b) => b.score - a.score || b.wins - a.wins || a.name.localeCompare(b.name));
  const rest = all.filter(row => !row.ranked).sort((a, b) => b.rated - a.rated || b.score - a.score || a.name.localeCompare(b.name));
  return [...ranked.map((row, index) => ({ ...row, rank: index + 1 })), ...rest.map(row => ({ ...row, rank: null }))];
}

/** A rating for display: whole number. */
export const showRating = (value: number) => String(Math.round(value));
/** A change for display: "+12" / "-12" (a "+0" or "-0" is "0"). */
export function showChange(value: number): string {
  const rounded = Math.round(value);
  return rounded > 0 ? `+${rounded}` : rounded < 0 ? `${rounded}` : "0";
}

/** Season ids from the one `now` is in back to the first, newest first. */
export function ratingSeasonIds(now: Date, startsAt: Date = RATING_START): string[] {
  const out: string[] = [];
  let at = now;
  for (let i = 0; i < 60 && at >= startsAt; i++) {
    const season = seasonOf(at, startsAt);
    out.push(season.id);
    at = new Date(season.from.getTime() - 1);
  }
  return out;
}

/** The official number behind a season id: "S3" is 3, the first season's old "YYYY-MM" id is 1; any other old month id has none. */
export function ratingSeasonNumber(id: string): number | null {
  const later = /^S(\d+)$/.exec(id);
  if (later) return Number(later[1]);
  return id === monthId(RATING_START) ? 1 : null;
}

/** A season's name for a board: "Season 2" / "Saison 2" (the first season is "Season 1"); an old month id that is not the first season stays a month ("January 2027"). */
export function ratingSeasonName(id: string, lang: "en" | "fr"): string {
  const number = ratingSeasonNumber(id);
  if (number !== null) return officialSeasonName(number, lang);
  return new Date(`${id}-01T00:00:00Z`).toLocaleDateString(lang === "fr" ? "fr-CA" : "en-CA", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** The dates of a season as a subtitle: "November 13 – December 9" ("From November 13" while it runs), or "" when unknown. */
export function ratingSeasonRange(id: string, lang: "en" | "fr", calendar = getSeasonCalendar()): string {
  const number = ratingSeasonNumber(id);
  if (number === null) return "";
  const from = number === 1 ? RATING_START : calendar.find(row => row.number === number)?.start;
  if (!from) return "";
  const to = nextSeasonAfter(from, calendar)?.start;
  const day = (d: Date) => d.toLocaleDateString(lang === "fr" ? "fr-CA" : "en-CA", { day: "numeric", month: "long", timeZone: "UTC" });
  return to ? `${day(from)} – ${day(new Date(to.getTime() - 1))}` : lang === "fr" ? `Dès le ${day(from)}` : `From ${day(from)}`;
}
