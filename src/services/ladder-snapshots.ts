import type { PrismaClient } from "../generated/prisma/client.js";
import type { LadderColumn } from "./score-card.js";

/**
 * "Since yesterday" movement for the ladder cards. Each refresh of a leaderboard writes today's ranks (UTC day) for that board
 * and compares them with the latest earlier day: up (positive), down (negative), the same (0) or "new" (not on yesterday's board).
 * One row per board per day, rewritten through the day, so "yesterday" is how the board stood at its last refresh that day.
 * Rows older than KEEP_DAYS are pruned on write. No previous day yet means no arrows at all (null), never a page of "new".
 */
export const KEEP_DAYS = 14;
export type Ranks = Record<string, number>;
export type Movement = number | "new";
export type Movements = ReadonlyMap<string, Movement>;

export const utcDay = (date: Date) => date.toISOString().slice(0, 10);
const dayBefore = (day: string, days: number) => utcDay(new Date(Date.parse(`${day}T00:00:00Z`) - days * 86_400_000));

/** Pure: ranks keyed by id, from rows already in rank order (the first occurrence of an id wins). */
export function ranksOf(keys: readonly string[]): Ranks {
  const ranks: Ranks = {};
  keys.forEach((key, index) => { if (key && ranks[key] === undefined) ranks[key] = index + 1; });
  return ranks;
}

/** Pure: each current id's movement against the previous ranks. */
export function movementsFrom(previous: Ranks, current: Ranks): Map<string, Movement> {
  const moves = new Map<string, Movement>();
  for (const [key, rank] of Object.entries(current)) {
    const before = previous[key];
    moves.set(key, typeof before === "number" ? before - rank : "new");
  }
  return moves;
}

/** Pure: the arrow label for a movement (the renderer draws the arrow; the number is the places gained or lost). */
export const moveLabel = (move: Movement, lang: "en" | "fr") => move === "new" ? (lang === "fr" ? "nouv." : "new") : String(Math.abs(move));

/** The ladder column that shows the arrows ("24h"), added only when there is a previous day to compare with. */
export const moveColumn = (lang: "en" | "fr"): LadderColumn => ({ label: lang === "fr" ? "24 h" : "24h", width: 46, kind: "move" });
/** Pure: the `move` fields of one ladder row (nothing when there are no movements or the id is unknown). */
export function moveFields(moves: Movements | null | undefined, key: string, lang: "en" | "fr"): { move?: Movement; moveLabel?: string } {
  const move = moves?.get(key);
  return move === undefined ? {} : { move, moveLabel: moveLabel(move, lang) };
}

type Db = Pick<PrismaClient, "ladderSnapshot">;

/**
 * Stores today's ranks for `board` and returns the movements since the latest earlier day, or null when there is no earlier
 * day yet. Never throws: a failed snapshot just means no arrows on this refresh.
 */
export async function trackRanks(db: Db, guildId: string, board: string, keys: readonly string[], now = new Date()): Promise<Movements | null> {
  try {
    const day = utcDay(now), current = ranksOf(keys);
    const previous = await db.ladderSnapshot.findFirst({ where: { guildId, board, day: { lt: day } }, orderBy: { day: "desc" }, select: { ranks: true } });
    await db.ladderSnapshot.upsert({ where: { guildId_board_day: { guildId, board, day } }, create: { guildId, board, day, ranks: current }, update: { ranks: current } });
    await db.ladderSnapshot.deleteMany({ where: { guildId, day: { lt: dayBefore(day, KEEP_DAYS) } } });
    const before = previous?.ranks;
    return before && typeof before === "object" && !Array.isArray(before) ? movementsFrom(before as Ranks, current) : null;
  } catch (error) {
    console.error("Ladder snapshot failed", error);
    return null;
  }
}
