import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { foreverNameMatches } from "../../companion/character-identity.mjs";

// Guild duels (8.4.5). The addon records "X has defeated Y in a duel" when both players are in the guild and each
// paired participant's companion uploads it. Nothing here posts anything or awards points.
//
// Trust: the upload is authenticated as ONE paired member, who must be the winner or the loser (a bystander's
// upload cannot create a result). Both players' companions report the same duel, so a result matches an existing
// one by pair and time (within DEDUPE_SECONDS) before it is stored. Two friends cannot farm the board: each
// pair counts at most PAIR_DAILY_CAP duels per UTC day and each reporter at most REPORTER_DAILY_CAP, the rest are
// stored as not counted (so a replay cannot count them later either).

export const PAIR_DAILY_CAP = 5;
export const REPORTER_DAILY_CAP = 25;
export const DEDUPE_SECONDS = 120;
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
  kind: z.enum(["level", "dungeon", "hk", "duel", "prof"]),
  ref: z.string().regex(/^[a-z]{2,10}:[A-Za-z0-9_-]{1,30}$/),
  value: z.number().int().min(0).max(1_000_000),
  at: z.number().int().positive().max(4102444800)
}).strict();
export type MilestoneInput = z.infer<typeof milestoneSchema>;

type Tx = Prisma.TransactionClient;
type Row = { id: string; name: string; realm: string; memberId: string };

const dayKey = (at: Date) => at.toISOString().slice(0, 10);
/** Order-free key of two members. */
export const pairKey = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);
const reportKey = (winnerId: string, loserId: string, at: number) =>
  createHash("sha256").update(`${winnerId}|${loserId}|${at}`).digest("hex").slice(0, 32);

/** A character name to the single member that owns it, or null when unknown or ambiguous. */
function memberOf(characters: readonly Row[], name: string): { memberId: string; name: string } | null {
  // Exact name, or (WoW Forever, 8.5) the single row still stored under the first name.
  const matches: Row[] = foreverNameMatches(characters, name);
  const owners = new Set(matches.map(character => character.memberId));
  return owners.size === 1 ? { memberId: matches[0]!.memberId, name: matches[0]!.name } : null;
}

export interface DuelImportResult { recorded: number; counted: number; capped: number; duplicates: number; rejected: number }

/**
 * Stores the duels a paired member's companion reported. `characters` are the guild's characters with their
 * member ids (the import already loaded them). Runs inside the import transaction.
 */
export async function importDuelResults(tx: Pick<Tx, "duelResult">, guildId: string, edition: string, reporterId: string | null | undefined,
  characters: readonly Row[], rows: unknown[], now = new Date()): Promise<DuelImportResult> {
  const result: DuelImportResult = { recorded: 0, counted: 0, capped: 0, duplicates: 0, rejected: 0 };
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
    const created = await tx.duelResult.createMany({ skipDuplicates: true, data: [{
      guildId, gameEdition: edition, winnerId: winner.memberId, loserId: loser.memberId, winnerCharacter: winner.name, loserCharacter: loser.name,
      reason: duel.reason, endedAt, dayKey: day, pairKey: pair, counted, reportKey: reportKey(winner.memberId, loser.memberId, duel.at), reporterId
    }] });
    if (!created.count) { result.duplicates++; continue; }
    result.recorded++;
    if (counted) result.counted++; else result.capped++;
  }
  return result;
}

/** Stores the milestones a paired member's addon recorded for their own characters. Idempotent. */
export async function importMilestones(tx: Pick<Tx, "memberMilestone">, guildId: string, edition: string, memberId: string | null | undefined,
  ownCharacters: readonly { name: string }[], rows: unknown[], now = new Date()): Promise<{ recorded: number; rejected: number }> {
  const result = { recorded: 0, rejected: 0 };
  if (!rows.length) return result;
  if (!memberId) return { ...result, rejected: rows.length };
  const own = new Set(ownCharacters.map(character => character.name.toLowerCase()));
  const data: Prisma.MemberMilestoneCreateManyInput[] = [];
  for (const raw of rows.slice(0, 300)) {
    const parsed = milestoneSchema.safeParse(raw);
    if (!parsed.success || !(own.has(parsed.data.character.split("-")[0]!.trim().toLowerCase()) || foreverNameMatches(ownCharacters, parsed.data.character).length === 1) || parsed.data.at * 1000 > now.getTime() + 300_000) { result.rejected++; continue; }
    const m = parsed.data;
    data.push({ guildId, memberId, gameEdition: edition, kind: m.kind, ref: m.ref, value: m.value, reachedAt: new Date(m.at * 1000) });
  }
  if (data.length) result.recorded = (await tx.memberMilestone.createMany({ data, skipDuplicates: true })).count;
  return result;
}

export interface DuelStanding { memberId: string; name: string; wins: number; losses: number; games: number; winRate: number; streak: number; bestStreak: number }

/** Pure: standings from counted duels, oldest first. `streak` is the current run (negative = losses in a row). */
export function standingsFromDuels(rows: readonly { winnerId: string; loserId: string; winnerCharacter: string; loserCharacter: string }[], limit = 50): DuelStanding[] {
  const by = new Map<string, DuelStanding & { run: number }>();
  const entry = (id: string, name: string) => {
    let row = by.get(id);
    if (!row) { row = { memberId: id, name, wins: 0, losses: 0, games: 0, winRate: 0, streak: 0, bestStreak: 0, run: 0 }; by.set(id, row); }
    row.name = name;
    return row;
  };
  for (const duel of rows) {
    const w = entry(duel.winnerId, duel.winnerCharacter), l = entry(duel.loserId, duel.loserCharacter);
    w.wins++; w.games++; w.run = w.run > 0 ? w.run + 1 : 1; w.bestStreak = Math.max(w.bestStreak, w.run);
    l.losses++; l.games++; l.run = l.run < 0 ? l.run - 1 : -1;
  }
  return [...by.values()].map(({ run, ...row }) => ({ ...row, streak: run, winRate: row.games ? row.wins / row.games : 0 }))
    .sort((a, b) => b.wins - a.wins || b.winRate - a.winRate || a.losses - b.losses || a.name.localeCompare(b.name)).slice(0, limit);
}

/** The guild's duel board for one edition (Forever unless told otherwise). Counted duels only. */
export async function duelLeaderboard(db: Pick<PrismaClient, "duelResult">, guildId: string, edition = "forever", opts: { since?: Date; limit?: number } = {}): Promise<{ standings: DuelStanding[]; duels: number }> {
  const rows = await db.duelResult.findMany({ where: { guildId, gameEdition: edition, counted: true, ...(opts.since ? { endedAt: { gte: opts.since } } : {}) },
    orderBy: { endedAt: "asc" }, take: 20_000, select: { winnerId: true, loserId: true, winnerCharacter: true, loserCharacter: true } });
  return { standings: standingsFromDuels(rows, opts.limit ?? 50), duels: rows.length };
}

export const percent = (rate: number) => `${Math.round(rate * 100)}%`;
export const streakText = (streak: number) => streak > 1 ? `W${streak}` : streak < -1 ? `L${-streak}` : "·";
