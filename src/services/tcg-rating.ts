// Guilded Clash ranked ladder maths (docs/plans/APP_TCG_GAME.md section 4.2). Pure rules; tcg-duel.ts applies them.
//
// Two numbers per member per season:
// - a hidden Glicko-2 rating (rating, rd, vol) that only drives matchmaking, and
// - visible stars: win +1, loss -1, a win streak of 3 or more pays +2 a win. Stars make the rank: Initiate, Adept, Veteran, Elite
//   (four divisions each, 3 / 3 / 4 / 5 stars a division) and Legend, a numbered leaderboard ordered by the hidden rating.
// Seasons are calendar months in UTC. A new season starts from a partial reset of the last one the member played.

export const START_RATING = 1500;
export const START_RD = 350;
export const START_VOL = 0.06;
const TAU = 0.5;
const SCALE = 173.7178;
const EPSILON = 0.000001;

export interface Glicko { rating: number; rd: number; vol: number }
export interface GlickoGame { rating: number; rd: number; score: 0 | 0.5 | 1 }

const g = (phi: number) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const expected = (mu: number, muJ: number, phiJ: number) => 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));

/** One Glicko-2 rating period (Glickman, 2013): the new rating, deviation and volatility after the given games. With no games only the deviation grows. */
export function glicko2(player: Glicko, games: readonly GlickoGame[]): Glicko {
  const mu = (player.rating - START_RATING) / SCALE;
  const phi = player.rd / SCALE;
  if (games.length === 0) return { rating: player.rating, rd: Math.min(START_RD, Math.sqrt(phi * phi + player.vol * player.vol) * SCALE), vol: player.vol };
  let vInv = 0, scoreSum = 0;
  for (const game of games) {
    const muJ = (game.rating - START_RATING) / SCALE, phiJ = game.rd / SCALE;
    const gj = g(phiJ), e = expected(mu, muJ, phiJ);
    vInv += gj * gj * e * (1 - e);
    scoreSum += gj * (game.score - e);
  }
  const v = 1 / vInv;
  const delta = v * scoreSum;
  const a = Math.log(player.vol * player.vol);
  const f = (x: number) => {
    const ex = Math.exp(x);
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * (phi * phi + v + ex) ** 2) - (x - a) / (TAU * TAU);
  };
  let A = a, B: number;
  if (delta * delta > phi * phi + v) B = Math.log(delta * delta - phi * phi - v);
  else { let k = 1; while (f(a - k * TAU) < 0) k++; B = a - k * TAU; }
  let fA = f(A), fB = f(B);
  while (Math.abs(B - A) > EPSILON) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) { A = B; fA = fB; } else fA /= 2;
    B = C; fB = fC;
  }
  const vol = Math.exp(A / 2);
  const phiStar = Math.sqrt(phi * phi + vol * vol);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = mu + phiNew * phiNew * scoreSum;
  return { rating: muNew * SCALE + START_RATING, rd: phiNew * SCALE, vol };
}

// ---- stars and ranks ----

export const RANKS = [
  { name: "Initiate", divisions: 4, perDivision: 3 },
  { name: "Adept", divisions: 4, perDivision: 3 },
  { name: "Veteran", divisions: 4, perDivision: 4 },
  { name: "Elite", divisions: 4, perDivision: 5 }
] as const;
export type RankName = typeof RANKS[number]["name"] | "Legend";

/** Stars needed to reach Legend (12 + 12 + 16 + 20). */
export const LEGEND_STARS = RANKS.reduce((sum, r) => sum + r.divisions * r.perDivision, 0);
const ROMAN = ["", "I", "II", "III", "IV"];

export interface RankInfo { rank: RankName; /** 4 is the lowest division and 1 the highest; 0 for Legend. */ division: number; label: string; starsInDivision: number; starsToNext: number; legend: boolean; /** Stars where this rank begins (the floor a loss cannot go below). */ rankFloor: number }

export function rankOf(stars: number): RankInfo {
  const total = Math.max(0, Math.floor(stars));
  if (total >= LEGEND_STARS) return { rank: "Legend", division: 0, label: "Legend", starsInDivision: 0, starsToNext: 0, legend: true, rankFloor: LEGEND_STARS };
  let floor = 0;
  for (const rank of RANKS) {
    const span = rank.divisions * rank.perDivision;
    if (total < floor + span) {
      const into = total - floor;
      const index = Math.floor(into / rank.perDivision); // 0 is the lowest division
      const division = rank.divisions - index;
      const starsInDivision = into - index * rank.perDivision;
      return { rank: rank.name, division, label: `${rank.name} ${ROMAN[division]}`, starsInDivision, starsToNext: rank.perDivision - starsInDivision, legend: false, rankFloor: floor };
    }
    floor += span;
  }
  return { rank: "Legend", division: 0, label: "Legend", starsInDivision: 0, starsToNext: 0, legend: true, rankFloor: LEGEND_STARS };
}

/** A win is +1 star (+2 from the third win in a row); a loss is -1 star, none at Initiate and Adept, and never below the start of the current rank. */
export function applyStars(stars: number, streak: number, won: boolean): { stars: number; streak: number; delta: number } {
  const before = rankOf(stars);
  if (won) {
    const nextStreak = Math.max(0, streak) + 1;
    const gain = nextStreak >= 3 ? 2 : 1;
    const next = Math.min(LEGEND_STARS, stars + gain);
    return { stars: next, streak: nextStreak, delta: next - stars };
  }
  const protectedRank = before.rank === "Initiate" || before.rank === "Adept";
  const next = protectedRank ? stars : Math.max(before.rankFloor, stars - 1);
  return { stars: next, streak: 0, delta: next - stars };
}

// ---- seasons ----

/** The ranked season of an instant: its UTC month, as YYYY-MM. */
export const seasonKey = (now: Date): string => now.toISOString().slice(0, 7);
export function seasonEndsAt(season: string): Date {
  const [y, m] = season.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 1));
}
/** The Monday 00:00 UTC that starts the week of an instant (the friendly leaderboard window). */
export function weekStart(now: Date): Date {
  const day = (now.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day));
}

export interface SeasonRow extends Glicko { stars: number }

/** Stars a rating starts a season with: one per 20 points above the start rating, at most the top of Adept. */
export const startStars = (rating: number): number => Math.max(0, Math.min(23, Math.floor((rating - START_RATING) / 20)));

/** The partial reset at a season change: the rating moves 40% back to the start rating, certainty is partly lost, stars come from the new rating. */
export function rolloverRating(previous: SeasonRow): SeasonRow & { streak: 0 } {
  const rating = START_RATING + (previous.rating - START_RATING) * 0.6;
  const rd = Math.min(START_RD, Math.sqrt(previous.rd * previous.rd + 120 * 120));
  return { rating, rd, vol: previous.vol, stars: startStars(rating), streak: 0 };
}

// ---- matchmaking ----

/** How far apart two ratings may be: it starts at 75 and widens by 25 every 10 seconds waited, up to 600. */
export const queueWindow = (waitedMs: number): number => Math.min(600, 75 + Math.floor(Math.max(0, waitedMs) / 10_000) * 25);

/** After this many ranked results between the same two members in 24 hours, further games between them change no rating. */
export const PAIR_CAP = 3;
