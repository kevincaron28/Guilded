import { duelPoints } from "./duels.js";
import { placement, rateSeason, ratingStandings, seasonOf, type RatedDuel } from "./duel-rating.js";

// The public duel board of one guild (website, JSON for the app). Pure: rows in, standings out. The points come from
// `duelPoints`, whose numbers live in duel-rules.ts, so the board follows a rule change without edits here.
// A row is one COUNTED duel between two members of the guild, with names only: no Discord IDs, no Discord names.

export interface PublicDuel {
  /** Internal member ids, used only to group a player's characters; never printed or sent. */
  winnerKey: string; loserKey: string;
  winner: string; loser: string;
  winnerLevel: number | null; loserLevel: number | null;
  winnerClass: string | null; loserClass: string | null;
  /** False when the member has left the guild: their results still count for the others but they are not listed. */
  winnerShown: boolean; loserShown: boolean;
  endedAt: Date; reason: string;
}

export interface DuelFilters { since: Date | null; until: Date | null; className: string | null; levels: [number, number] | null }
export interface DuelRow {
  key: string; name: string; className: string | null; level: number | null;
  points: number; wins: number; losses: number; games: number; winRate: number; streak: number; bestStreak: number; lastAt: Date; rank: number;
  /** Only in a rating season: the shown (shrunk) score, whether the player is ranked, and the placement progress while not. `rank` is 0 until ranked. */
  rating?: { score: number; raw: number; rated: number; opponents: number; ranked: boolean; placement: ReturnType<typeof placement> | null };
}
/** A recent duel; in a rating season also what it moved for each side (shown-score points; `rated` false = it moved nothing). */
export type RecentDuel = PublicDuel & { change?: { winner: number; loser: number; rated: boolean } };
export interface DuelBoard { rows: DuelRow[]; duels: number; recent: RecentDuel[]; season?: { id: string; rated: boolean } }

/** The level ranges of the level filter. */
export const DUEL_LEVEL_BANDS: { key: string; from: number; to: number }[] = [
  { key: "1-19", from: 1, to: 19 }, { key: "20-39", from: 20, to: 39 }, { key: "40-59", from: 40, to: 59 }, { key: "60", from: 60, to: 60 }
];

const inBand = (level: number | null, band: [number, number]) => level !== null && level >= band[0] && level <= band[1];

export function buildDuelBoard(all: readonly PublicDuel[], filters: DuelFilters, recentLimit = 20): DuelBoard {
  const duels = all.filter(duel => (!filters.since || duel.endedAt >= filters.since) && (!filters.until || duel.endedAt < filters.until)
    && (!filters.levels || (inBand(duel.winnerLevel, filters.levels) && inBand(duel.loserLevel, filters.levels))))
    .sort((a, b) => a.endedAt.getTime() - b.endedAt.getTime());
  const by = new Map<string, DuelRow & { run: number; shown: boolean }>();
  const entry = (key: string, name: string, className: string | null, level: number | null, shown: boolean, at: Date) => {
    let row = by.get(key);
    if (!row) { row = { key, name, className, level, points: 0, wins: 0, losses: 0, games: 0, winRate: 0, streak: 0, bestStreak: 0, lastAt: at, rank: 0, run: 0, shown }; by.set(key, row); }
    row.name = name; row.lastAt = at; row.shown = shown;
    if (className) row.className = className;
    if (level !== null) row.level = level;
    return row;
  };
  for (const duel of duels) {
    const w = entry(duel.winnerKey, duel.winner, duel.winnerClass, duel.winnerLevel, duel.winnerShown, duel.endedAt);
    const l = entry(duel.loserKey, duel.loser, duel.loserClass, duel.loserLevel, duel.loserShown, duel.endedAt);
    w.wins++; w.games++; w.points += duelPoints(duel.winnerLevel, duel.loserLevel); w.run = w.run > 0 ? w.run + 1 : 1; w.bestStreak = Math.max(w.bestStreak, w.run);
    l.losses++; l.games++; l.run = l.run < 0 ? l.run - 1 : -1;
  }
  const wanted = filters.className?.toLowerCase() ?? null;
  const rows = [...by.values()].filter(row => row.shown && (!wanted || row.className?.toLowerCase() === wanted))
    .map((row): DuelRow => ({ key: row.key, name: row.name, className: row.className, level: row.level, points: row.points, wins: row.wins, losses: row.losses, games: row.games, bestStreak: row.bestStreak, lastAt: row.lastAt, rank: 0, streak: row.run, winRate: row.games ? row.wins / row.games : 0 }))
    .sort((a, b) => b.points - a.points || b.wins - a.wins || b.winRate - a.winRate || a.losses - b.losses || a.name.localeCompare(b.name));
  rows.forEach((row, index) => { row.rank = index + 1; });
  const recent = duels.filter(duel => duel.winnerShown && duel.loserShown && (!wanted || duel.winnerClass?.toLowerCase() === wanted || duel.loserClass?.toLowerCase() === wanted)).slice(-recentLimit).reverse();
  return { rows, duels: duels.length, recent };
}

export interface HeadToHead { a: string; b: string; aWins: number; bWins: number; last: PublicDuel[] }

/** Record between two listed players, matched by name (case-insensitive); null when either name is not on the board. */
export function headToHead(all: readonly PublicDuel[], a: string, b: string, last = 10): HeadToHead | null {
  const same = (x: string, y: string) => x.toLowerCase() === y.toLowerCase();
  const meetings = all.filter(duel => duel.winnerShown && duel.loserShown && ((same(duel.winner, a) && same(duel.loser, b)) || (same(duel.winner, b) && same(duel.loser, a))))
    .sort((x, y) => y.endedAt.getTime() - x.endedAt.getTime());
  const listed = all.filter(duel => duel.winnerShown && duel.loserShown);
  const known = listed.some(duel => [duel.winner, duel.loser].some(name => same(name, a))) && listed.some(duel => [duel.winner, duel.loser].some(name => same(name, b)));
  if (!known || same(a, b)) return null;
  return { a, b, aWins: meetings.filter(duel => same(duel.winner, a)).length, bWins: meetings.filter(duel => same(duel.winner, b)).length, last: meetings.slice(0, last) };
}

/**
 * The board of one RATING season (rating-v1): the duels of that month, rated in date order. Ranked players first, then the ones
 * still in placement. Class and level filters narrow the duels or the rows exactly as in `buildDuelBoard`.
 */
export function buildRatingBoard(all: readonly PublicDuel[], seasonId: string, startsAt: Date, filters: Pick<DuelFilters, "className" | "levels">, recentLimit = 20): DuelBoard {
  const wanted = filters.className?.toLowerCase() ?? null;
  const inSeason = all.filter(duel => seasonOf(duel.endedAt, startsAt).id === seasonId
    && (!filters.levels || (inBand(duel.winnerLevel, filters.levels) && inBand(duel.loserLevel, filters.levels))));
  const source = new Map<RatedDuel, PublicDuel>();
  const shown = new Map<string, boolean>(), classes = new Map<string, string | null>();
  const rated: RatedDuel[] = inSeason.map(duel => {
    const row: RatedDuel = { winnerKey: duel.winnerKey, loserKey: duel.loserKey, winnerName: duel.winner, loserName: duel.loser, winnerLevel: duel.winnerLevel, loserLevel: duel.loserLevel, endedAt: duel.endedAt };
    source.set(row, duel); shown.set(duel.winnerKey, duel.winnerShown); shown.set(duel.loserKey, duel.loserShown);
    if (duel.winnerClass) classes.set(duel.winnerKey, duel.winnerClass); if (duel.loserClass) classes.set(duel.loserKey, duel.loserClass);
    return row;
  });
  const result = rateSeason(rated);
  const standings = ratingStandings(result.players).filter(row => shown.get(row.key) !== false && (!wanted || classes.get(row.key)?.toLowerCase() === wanted));
  let next = 0;
  const rows = standings.map((row): DuelRow => ({
    key: row.key, name: row.name, className: classes.get(row.key) ?? null, level: row.level, points: Math.round(row.score), wins: row.wins, losses: row.losses, games: row.games,
    winRate: row.games ? row.wins / row.games : 0, streak: row.streak, bestStreak: row.bestStreak, lastAt: row.lastAt, rank: row.ranked ? ++next : 0,
    rating: { score: row.score, raw: row.rating, rated: row.rated, opponents: row.opponents, ranked: row.ranked, placement: row.ranked ? null : placement(row.rated, row.opponents) }
  }));
  const recent: RecentDuel[] = [];
  for (let i = result.ordered.length - 1; i >= 0 && recent.length < recentLimit; i--) {
    const duel = source.get(result.ordered[i]!)!, change = result.changes[i]!;
    if (!duel.winnerShown || !duel.loserShown || (wanted && duel.winnerClass?.toLowerCase() !== wanted && duel.loserClass?.toLowerCase() !== wanted)) continue;
    recent.push({ ...duel, change: { winner: change.winnerDelta, loser: change.loserDelta, rated: change.rated } });
  }
  return { rows, duels: inSeason.length, recent, season: { id: seasonId, rated: true } };
}
