import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { foreverNameMatches } from "../../companion/character-identity.mjs";
import { DUEL_RULES } from "./duel-rules.js";
import { RATING_START, placement, rateSeason, ratingApplies, ratingStandings, seasonOf, type RatedDuel, type SeasonInfo } from "./duel-rating.js";

// Guild duels (8.4.5; level-difference score 9.1). The addon records "X has defeated Y in a duel" when both players are in the guild and each
// paired participant's companion uploads it. Nothing here posts anything or awards points.
//
// Trust: the upload is authenticated as ONE paired member, who must be the winner or the loser (a bystander's
// upload cannot create a result). Both players' companions report the same duel, so a result matches an existing
// one by pair and time (within DEDUPE_SECONDS) before it is stored. Two friends cannot farm the board: each
// pair counts at most PAIR_DAILY_CAP duels per UTC day and each reporter at most REPORTER_DAILY_CAP, the rest are
// stored as not counted (so a replay cannot count them later either).

export const PAIR_DAILY_CAP = DUEL_RULES.pairDailyCap;
export const REPORTER_DAILY_CAP = DUEL_RULES.reporterDailyCap;
export const DEDUPE_SECONDS = DUEL_RULES.dedupeSeconds;
const MAX_AGE_DAYS = 30;

export const duelResultSchema = z.object({
  winner: z.string().trim().min(1).max(80),
  loser: z.string().trim().min(1).max(80),
  at: z.number().int().positive().max(4102444800),
  reason: z.enum(["knockout", "retreat"])
}).strict();
export type DuelResultInput = z.infer<typeof duelResultSchema>;

export const milestoneSchema = z.object({
  character: z.string().trim().min(1).max(80),
  realm: z.string().trim().max(100).default(""),
  kind: z.enum(["level", "dungeon", "hk", "duel", "prof", "ach"]),
  ref: z.string().regex(/^[a-z]{2,10}:[A-Za-z0-9_-]{1,30}$/),
  value: z.number().int().min(0).max(1_000_000),
  at: z.number().int().positive().max(4102444800),
  // Only on kind "ach" (a WoW Forever in-game achievement): the name and text the client showed, for the generated badge catalogue.
  label: z.string().max(120).optional(),
  desc: z.string().max(300).optional(),
  category: z.string().max(80).optional(),
  points: z.number().int().min(0).max(1000).optional()
}).strict();
export type MilestoneInput = z.infer<typeof milestoneSchema>;

type Tx = Prisma.TransactionClient;
type Row = { id: string; name: string; realm: string; memberId: string; level?: number | null };

const dayKey = (at: Date) => at.toISOString().slice(0, 10);
/** Order-free key of two members. */
export const pairKey = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);
const reportKey = (winnerId: string, loserId: string, at: number) =>
  createHash("sha256").update(`${winnerId}|${loserId}|${at}`).digest("hex").slice(0, 32);

/** A character name to the single member that owns it, or null when unknown or ambiguous. */
function memberOf(characters: readonly Row[], name: string): { memberId: string; name: string; level: number | null } | null {
  // Exact name, or (WoW Forever, 8.5) the single row still stored under the first name.
  const matches: Row[] = foreverNameMatches(characters, name);
  const owners = new Set(matches.map(character => character.memberId));
  return owners.size === 1 ? { memberId: matches[0]!.memberId, name: matches[0]!.name, level: matches[0]!.level ?? null } : null;
}

/** A newly stored COUNTED duel, for the Discord duel card (9.3). */
export interface FreshDuel { reportKey: string; winnerId: string; loserId: string; winnerCharacter: string; loserCharacter: string; winnerLevel: number | null; loserLevel: number | null; reason: string; endedAt: Date }
export interface DuelImportResult { recorded: number; counted: number; capped: number; duplicates: number; rejected: number; fresh: FreshDuel[] }

/**
 * Stores the duels a paired member's companion reported. `characters` are the guild's characters with their
 * member ids (the import already loaded them). Runs inside the import transaction.
 */
export async function importDuelResults(tx: Pick<Tx, "duelResult">, guildId: string, edition: string, reporterId: string | null | undefined,
  characters: readonly Row[], rows: unknown[], now = new Date()): Promise<DuelImportResult> {
  const result: DuelImportResult = { recorded: 0, counted: 0, capped: 0, duplicates: 0, rejected: 0, fresh: [] };
  if (!rows.length) return result;
  if (!reporterId) return { ...result, rejected: rows.length };
  const parsed = rows.slice(0, 200).flatMap(row => { const p = duelResultSchema.safeParse(row); return p.success ? [p.data] : []; });
  result.rejected += rows.length - parsed.length;
  // Oldest first, so the daily allowance goes to the earliest duels.
  parsed.sort((a, b) => a.at - b.at);
  for (const duel of parsed) {
    const endedAt = new Date(duel.at * 1000);
    const age = now.getTime() - endedAt.getTime();
    const winner = memberOf(characters, duel.winner), loser = memberOf(characters, duel.loser);
    // Both must be known guild members and different people; the reporter must be one of them.
    if (!winner || !loser || winner.memberId === loser.memberId || (reporterId !== winner.memberId && reporterId !== loser.memberId)
      || age < -300_000 || age > MAX_AGE_DAYS * 86_400_000) { result.rejected++; continue; }
    // The other participant's companion reports the same duel a few seconds apart.
    const near = await tx.duelResult.findFirst({ where: { guildId, gameEdition: edition, winnerId: winner.memberId, loserId: loser.memberId,
      endedAt: { gte: new Date(endedAt.getTime() - DEDUPE_SECONDS * 1000), lte: new Date(endedAt.getTime() + DEDUPE_SECONDS * 1000) } }, select: { id: true } });
    if (near) { result.duplicates++; continue; }
    const day = dayKey(endedAt), pair = pairKey(winner.memberId, loser.memberId);
    const [pairCount, reporterCount] = await Promise.all([
      tx.duelResult.count({ where: { guildId, gameEdition: edition, pairKey: pair, dayKey: day, counted: true } }),
      tx.duelResult.count({ where: { guildId, gameEdition: edition, reporterId, dayKey: day, counted: true } })
    ]);
    const counted = pairCount < PAIR_DAILY_CAP && reporterCount < REPORTER_DAILY_CAP;
    const key = reportKey(winner.memberId, loser.memberId, duel.at);
    const created = await tx.duelResult.createMany({ skipDuplicates: true, data: [{
      guildId, gameEdition: edition, winnerId: winner.memberId, loserId: loser.memberId, winnerCharacter: winner.name, loserCharacter: loser.name, winnerLevel: winner.level, loserLevel: loser.level,
      reason: duel.reason, endedAt, dayKey: day, pairKey: pair, counted, reportKey: key, reporterId
    }] });
    if (!created.count) { result.duplicates++; continue; }
    result.recorded++;
    if (counted) {
      result.counted++;
      result.fresh.push({ reportKey: key, winnerId: winner.memberId, loserId: loser.memberId, winnerCharacter: winner.name, loserCharacter: loser.name, winnerLevel: winner.level, loserLevel: loser.level, reason: duel.reason, endedAt });
    } else result.capped++;
  }
  return result;
}

/** Rows one upload may carry (the addon sends its log; in-game achievements make it longer than the 300 of 8.4.5). */
export const MAX_MILESTONE_ROWS = 600;
/** Text from a client: control characters out, whitespace collapsed, cut to `max`. */
const cleanText = (text: string | undefined, max: number) => (text ?? "").replace(/\p{Cc}/gu, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** Stores the milestones a paired member's addon recorded for their own characters. Idempotent. */
export async function importMilestones(tx: Pick<Tx, "memberMilestone"> & Partial<Pick<Tx, "gameAchievement">>, guildId: string, edition: string, memberId: string | null | undefined,
  ownCharacters: readonly { name: string }[], rows: unknown[], now = new Date()): Promise<{ recorded: number; rejected: number }> {
  const result = { recorded: 0, rejected: 0 };
  if (!rows.length) return result;
  if (!memberId) return { ...result, rejected: rows.length };
  const own = new Set(ownCharacters.map(character => character.name.toLowerCase()));
  const data: Prisma.MemberMilestoneCreateManyInput[] = [];
  const catalogue = new Map<number, Prisma.GameAchievementCreateManyInput>();
  for (const raw of rows.slice(0, MAX_MILESTONE_ROWS)) {
    const parsed = milestoneSchema.safeParse(raw);
    if (!parsed.success || !(own.has(parsed.data.character.split("-")[0]!.trim().toLowerCase()) || foreverNameMatches(ownCharacters, parsed.data.character).length === 1) || parsed.data.at * 1000 > now.getTime() + 300_000) { result.rejected++; continue; }
    const m = parsed.data;
    if (m.kind === "ach") {
      // An in-game achievement needs its numeric id and the name the client showed; anything else would show as a blank badge.
      const id = /^ach:(\d{1,9})$/.exec(m.ref)?.[1], name = cleanText(m.label, 80);
      if (!id || !name) { result.rejected++; continue; }
      if (!catalogue.has(Number(id))) catalogue.set(Number(id), { gameEdition: edition, achievementId: Number(id), name, description: cleanText(m.desc, 200), categoryName: cleanText(m.category, 60), points: m.points ?? 0 });
    }
    data.push({ guildId, memberId, gameEdition: edition, kind: m.kind, ref: m.ref, value: m.value, reachedAt: new Date(m.at * 1000) });
  }
  // The generated catalogue: first report of an id wins, a later one never renames it (skipDuplicates).
  if (catalogue.size && tx.gameAchievement) await tx.gameAchievement.createMany({ data: [...catalogue.values()], skipDuplicates: true });
  if (data.length) result.recorded = (await tx.memberMilestone.createMany({ data, skipDuplicates: true })).count;
  return result;
}

export interface DuelStanding { memberId: string; name: string; score: number; wins: number; losses: number; games: number; winRate: number; streak: number; bestStreak: number }

/** Points for one win. */
export const DUEL_BASE_POINTS = DUEL_RULES.basePoints, DUEL_POINTS_PER_LEVEL = DUEL_RULES.pointsPerLevel, DUEL_MAX_POINTS = DUEL_RULES.maxPoints;

/**
 * Pure: what a win is worth, by level difference (opponent level minus winner level). Base 10; each level the loser was above the
 * winner adds 2 (up to 20 at +5 or more); each level below takes 2 off (nothing at -5 or more). Losses cost nothing. When either
 * level was not known (older duels, characters without a level) the win is worth the base 10, so history is not rewritten.
 */
export function duelPoints(winnerLevel: number | null | undefined, loserLevel: number | null | undefined): number {
  if (!winnerLevel || !loserLevel) return DUEL_BASE_POINTS;
  return Math.max(0, Math.min(DUEL_MAX_POINTS, DUEL_BASE_POINTS + DUEL_POINTS_PER_LEVEL * (loserLevel - winnerLevel)));
}

/** Pure: standings from counted duels, oldest first. `streak` is the current run (negative = losses in a row). */
export function standingsFromDuels(rows: readonly { winnerId: string; loserId: string; winnerCharacter: string; loserCharacter: string; winnerLevel?: number | null; loserLevel?: number | null }[], limit = 50): DuelStanding[] {
  const by = new Map<string, DuelStanding & { run: number }>();
  const entry = (id: string, name: string) => {
    let row = by.get(id);
    if (!row) { row = { memberId: id, name, score: 0, wins: 0, losses: 0, games: 0, winRate: 0, streak: 0, bestStreak: 0, run: 0 }; by.set(id, row); }
    row.name = name;
    return row;
  };
  for (const duel of rows) {
    const w = entry(duel.winnerId, duel.winnerCharacter), l = entry(duel.loserId, duel.loserCharacter);
    w.wins++; w.games++; w.score += duelPoints(duel.winnerLevel, duel.loserLevel); w.run = w.run > 0 ? w.run + 1 : 1; w.bestStreak = Math.max(w.bestStreak, w.run);
    l.losses++; l.games++; l.run = l.run < 0 ? l.run - 1 : -1;
  }
  return [...by.values()].map(({ run, ...row }) => ({ ...row, streak: run, winRate: row.games ? row.wins / row.games : 0 }))
    .sort((a, b) => b.score - a.score || b.wins - a.wins || b.winRate - a.winRate || a.losses - b.losses || a.name.localeCompare(b.name)).slice(0, limit);
}

/** The guild's duel board for one edition (Forever unless told otherwise). Counted duels only. */
export async function duelLeaderboard(db: Pick<PrismaClient, "duelResult">, guildId: string, edition = "forever", opts: { since?: Date; limit?: number } = {}): Promise<{ standings: DuelStanding[]; duels: number }> {
  const rows = await db.duelResult.findMany({ where: { guildId, gameEdition: edition, counted: true, ...(opts.since ? { endedAt: { gte: opts.since } } : {}) },
    orderBy: { endedAt: "asc" }, take: 20_000, select: { winnerId: true, loserId: true, winnerCharacter: true, loserCharacter: true, winnerLevel: true, loserLevel: true } });
  return { standings: standingsFromDuels(rows, opts.limit ?? 50), duels: rows.length };
}

/** One ladder row, in either mode. In rating mode `score` is the shown (shrunk) rating and `rank` is null until the player is ranked. */
export interface LadderStanding extends DuelStanding { rank: number | null; ranked: boolean; rated: number; opponents: number; placement: { duels: number; needDuels: number; opponents: number; needOpponents: number } | null }
export interface DuelLadder { mode: "points" | "rating"; season: SeasonInfo | null; startsAt: Date; standings: LadderStanding[]; duels: number }

/** When this server's duels start to be scored by rating: its own marker, else the built-in date. Never throws. */
export async function ratingStartOf(db: { guildSettings?: Pick<PrismaClient["guildSettings"], "findUnique"> }, guildId: string): Promise<Date> {
  try { return (await db.guildSettings?.findUnique({ where: { guildId }, select: { duelRatingStartsAt: true } }))?.duelRatingStartsAt ?? RATING_START; } catch { return RATING_START; }
}

/**
 * The guild's duel ladder under the rules that apply at `now`: the old points before the start date (exactly `duelLeaderboard`), and
 * from the start date the rating of the current monthly season, recomputed from the stored counted duels in date order.
 */
export async function duelLadder(db: Pick<PrismaClient, "duelResult"> & { guildSettings?: Pick<PrismaClient["guildSettings"], "findUnique"> }, guildId: string, edition = "forever",
  opts: { limit?: number; now?: Date; startsAt?: Date } = {}): Promise<DuelLadder> {
  const startsAt = opts.startsAt ?? await ratingStartOf(db, guildId), now = opts.now ?? new Date(), limit = opts.limit ?? 50;
  if (!ratingApplies(now, startsAt)) {
    // Before the start nothing changes: the old board, to the point.
    const old = await duelLeaderboard(db, guildId, edition, { limit });
    return { mode: "points", season: null, startsAt, duels: old.duels, standings: old.standings.map((row, index) => ({ ...row, rank: index + 1, ranked: true, rated: row.games, opponents: 0, placement: null })) };
  }
  const season = seasonOf(now, startsAt);
  const rows = await db.duelResult.findMany({ where: { guildId, gameEdition: edition, counted: true, endedAt: { gte: season.from, ...(season.to ? { lt: season.to } : {}) } },
    orderBy: { endedAt: "asc" }, take: 20_000, select: { winnerId: true, loserId: true, winnerCharacter: true, loserCharacter: true, winnerLevel: true, loserLevel: true, endedAt: true } });
  const duels: RatedDuel[] = rows.map(row => ({ winnerKey: row.winnerId, loserKey: row.loserId, winnerName: row.winnerCharacter, loserName: row.loserCharacter, winnerLevel: row.winnerLevel, loserLevel: row.loserLevel, endedAt: row.endedAt }));
  const rated = rateSeason(duels);
  const standings = ratingStandings(rated.players).slice(0, limit).map((row): LadderStanding => ({
    memberId: row.key, name: row.name, score: row.score, wins: row.wins, losses: row.losses, games: row.games, winRate: row.games ? row.wins / row.games : 0, streak: row.streak, bestStreak: row.bestStreak,
    rank: row.rank, ranked: row.ranked, rated: row.rated, opponents: row.opponents, placement: row.ranked ? null : placement(row.rated, row.opponents) }));
  return { mode: "rating", season, startsAt, standings, duels: rows.length };
}

export const percent = (rate: number) => `${Math.round(rate * 100)}%`;
export const streakText = (streak: number) => streak > 1 ? `W${streak}` : streak < -1 ? `L${-streak}` : "·";
