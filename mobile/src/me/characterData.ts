import { getJsonBounded, ApiError } from "../api";
import type { Lang } from "../i18n";

// "My character" page (phone app 0.6.0): one of my characters' dungeon rank in each level bracket and recent rated runs
// (GET /leaderboards/boards.json?player=<name>), its duel record (GET /leaderboards/duels.json?player=<name>) and my badges
// (the album the Me tab already reads). Public numbers only: the same ones the website's leaderboards show.

export interface BracketRank { key: string; name: string; rank: number; points: number; of: number }
export interface CharacterRun { dungeon: string; bracket: string | null; points: number | null; durationSec: number; endedAt: string }
export interface DungeonStanding { season: string; brackets: BracketRank[]; runs: CharacterRun[] }
export interface DuelRecord { rank: number | null; rating: number; wins: number; losses: number; streak: number; bestStreak: number; ranked: boolean; lastDuelAt: string | null }

const obj = (v: unknown): Record<string, unknown> | null => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const arr = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const str = (v: unknown): string | null => typeof v === "string" && v ? v : null;
const num = (v: unknown): number => typeof v === "number" && Number.isFinite(v) ? v : 0;

/** The `player` part of boards.json; null when the server has none (an older bot, or no rated run this season). */
export function parseStanding(body: unknown): DungeonStanding | null {
  const data = obj(body);
  const player = obj(data?.player);
  if (!data || !player) return null;
  return {
    season: str(data.season) ?? "",
    brackets: arr(player.brackets).flatMap((raw) => { const b = obj(raw); return b && str(b.key) && num(b.rank) > 0 ? [{ key: str(b.key)!, name: str(b.name) ?? str(b.key)!, rank: num(b.rank), points: num(b.points), of: num(b.of) }] : []; }),
    runs: arr(player.runs).flatMap((raw) => { const r = obj(raw); return r && str(r.dungeon) && str(r.endedAt) ? [{ dungeon: str(r.dungeon)!, bracket: str(r.bracket), points: typeof r.points === "number" ? r.points : null, durationSec: num(r.durationSec), endedAt: str(r.endedAt)! }] : []; })
  };
}

export function parseDuelRecord(body: unknown): DuelRecord | null {
  const player = obj(obj(body)?.player);
  if (!player) return null;
  return { rank: typeof player.rank === "number" && player.rank > 0 ? player.rank : null, rating: num(player.rating), wins: num(player.wins), losses: num(player.losses),
    streak: num(player.streak), bestStreak: num(player.bestStreak), ranked: player.ranked === true, lastDuelAt: str(player.lastDuelAt) };
}

export async function fetchStanding(origin: string, name: string, lang: Lang): Promise<DungeonStanding | null> {
  return parseStanding(await getJsonBounded(`${origin}/leaderboards/boards.json?lang=${lang}&player=${encodeURIComponent(name)}`));
}
/** Null before the duel ladder opens (404) or when the character has no counted duel. */
export async function fetchDuelRecord(origin: string, name: string, lang: Lang): Promise<DuelRecord | null> {
  try { return parseDuelRecord(await getJsonBounded(`${origin}/leaderboards/duels.json?lang=${lang}&player=${encodeURIComponent(name)}`)); }
  catch (error) { if (error instanceof ApiError && error.status === 404) return null; throw error; }
}

/** 23:05 as the game writes a run time. */
export function runTime(seconds: number): string {
  const m = Math.floor(seconds / 60), s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
