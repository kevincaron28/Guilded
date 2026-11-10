import { randomInt } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client.js";
import { starterDeck } from "./tcg-cards-set1.js";
import { actor, apply, applyMut, cloneState, createMatch, IllegalAction, MAX_TIMEOUTS, replay, round, stateHash } from "./tcg-engine.js";
import type { Action, DeckList, MatchEvent, MatchState } from "./tcg-engine-types.js";
import { Conflict, countPlay, isClassKey, planReward, playerView, type MatchRewards, type PlayerView, type Settlement } from "./tcg-match.js";
import { onlineInApp, onlineInGame } from "./tcg-presence.js";
import { MIN_TURNS_COUNTED } from "./tcg-quests.js";
import { applyStars, glicko2, PAIR_CAP, queueWindow, rankOf, rolloverRating, seasonEndsAt, seasonKey, START_RATING, START_RD, START_VOL, weekStart, type RankInfo } from "./tcg-rating.js";
import { TcgError } from "./tcg-store.js";
import { sharedGuild } from "./tcg-trade.js";

// Guilded Clash stage E (docs/plans/APP_TCG_GAME.md section 4): player-vs-player.
//
// Two kinds of duel, both server-authoritative and built on the same engine as the matches against the AI (tcg-match.ts):
// - a friendly challenge between two guildmates (same server only), live (60 second turns) or asynchronous (24 hours a turn),
//   no rewards beyond the daily quest credit;
// - a ranked match from the waiting room, across every server that hosts the bot (the global ladder), monthly seasons, a hidden
//   Glicko-2 rating for matchmaking and visible stars for the rank. Ranked is live since 10 November 2026.
// Seat 0 is userA (the challenger, or whoever queued first) and seat 1 is userB. Each player only ever receives their own
// projection (`playerView(state, seat)`): never the opponent's hand, either deck order or the random state. A match is stored as
// seed + decks + the ordered action log and replays to the same state hash. Clocks (owner, 10 November 2026): a missed turn clock
// plays the safe default for that player and the third miss in a row forfeits; a live match also has a 2:30 match clock per
// player, and when one runs out the match ends on Health lost. Overdue clocks are settled the next time the match, or a list
// of matches, is read. Leaving a match is a forfeit, never a free exit.

export const TURN_SECONDS = 86_400;
export const LIVE_TURN_SECONDS = 60;
/** A live match's clock (owner, 10 November 2026): each seat has 2:30 for the whole match, running only while it must act.
 *  When either clock runs out the match ends on Health lost, so a live match never lasts more than 5 minutes of play. */
export const MATCH_CLOCK_MS = 150_000;
export const CHALLENGE_TTL_MS = 24 * 3_600_000;
export const LIVE_CHALLENGE_TTL_MS = 2 * 60_000;
export const QUEUE_TTL_MS = 15 * 60_000;
export const MAX_ACTIVE_DUELS = 5;
export const MAX_OPEN_CHALLENGES = 5;
/** Ranked pack credit needs a collection this old and this many played matches (the alt-account rule of section 4.4). */
export const REWARD_MIN_AGE_MS = 7 * 86_400_000;
export const REWARD_MIN_PLAYED = 5;
/** The friendly leaderboard counts at most this many wins a week against the same opponent. */
export const FRIENDLY_PAIR_WEEKLY_CAP = 3;
export const LADDER_SIZE = 50;
const DAY_MS = 86_400_000;

type Tx = Pick<PrismaClient, "tcgAccount" | "tcgCard" | "tcgLog" | "tcgMatch" | "tcgPlayer" | "tcgDaily" | "tcgDuel" | "tcgRating" | "tcgQueue" | "member" | "character" | "guildSettings" | "guildRosterEntry">;
export type DuelDb = Tx & { $transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> };

// ---- stored shape ----

interface DuelRow {
  id: string; kind: string; guildId: string | null; userA: string; userB: string; clsA: string; clsB: string | null; live: boolean; status: string; season: string;
  seed: number; deckA: unknown; deckB: unknown; actions: unknown; state: unknown; stateHash: string; winner: number | null; reason: string | null;
  spellsA: number; zonesA: number; spellsB: number; zonesB: number; counted: boolean; rated: boolean; flags: unknown; result: unknown;
  turnSeconds: number; turnDeadlineAt: Date | null; clockA: number | null; clockB: number | null; expiresAt: Date | null; lastActionAt: Date; version: number; createdAt: Date; startedAt: Date | null; finishedAt: Date | null;
}
interface RatingRow { discordUserId: string; season: string; rating: number; rd: number; vol: number; stars: number; wins: number; losses: number; streak: number; games: number; version: number }

const stateOf = (row: DuelRow) => row.state as MatchState;
const actionsOf = (row: DuelRow) => (row.actions ?? []) as Action[];
const seatOf = (row: Pick<DuelRow, "userA" | "userB">, userId: string): 0 | 1 | null => row.userA === userId ? 0 : row.userB === userId ? 1 : null;

export type DuelStatus = "pending" | "active" | "won" | "lost" | "draw" | "declined" | "cancelled" | "expired";
export interface RankedChange { rated: boolean; season: string; stars: number; starsDelta: number; streak: number; rank: RankInfo }
interface SeatOutcome { rewards: MatchRewards; ranked: RankedChange | null }
export interface DuelInfo {
  id: string; kind: "friendly" | "ranked"; status: DuelStatus; reason: string | null; live: boolean;
  /** "incoming" and "outgoing" for a pending challenge; "match" once it is being played. */
  direction: "incoming" | "outgoing" | "match";
  seat: 0 | 1; yourTurn: boolean;
  you: { id: string; cls: string };
  opponent: { id: string; name: string; cls: string | null; onlineInApp: boolean; onlineInGame?: boolean };
  season: string | null; round: number; version: number; turnSeconds: number; turnDeadlineAt: string | null; expiresAt: string | null;
  /** Live matches: milliseconds left on each match clock when the match last changed; null for asynchronous matches. */
  clocks: { you: number; opponent: number } | null;
  createdAt: string; finishedAt: string | null; rated: boolean;
}
export interface DuelResponse { duel: DuelInfo; view: PlayerView | null; events: MatchEvent[]; rewards: MatchRewards | null; ranked: RankedChange | null }

type Names = ReadonlyMap<string, string>;

function infoOf(row: DuelRow, userId: string, names: Names): DuelInfo {
  const seat = seatOf(row, userId);
  if (seat === null) throw new TcgError("That match does not exist.", 404);
  const mine = seat === 0 ? row.clsA : row.clsB ?? "";
  const otherId = seat === 0 ? row.userB : row.userA;
  const otherCls = seat === 0 ? row.clsB : row.clsA;
  const state = row.state ? stateOf(row) : null;
  let status: DuelStatus;
  if (row.status === "done") status = row.winner === 2 ? "draw" : row.winner === seat ? "won" : "lost";
  else status = row.status as DuelStatus;
  return {
    id: row.id, kind: row.kind as "friendly" | "ranked", status, reason: row.reason, live: row.live,
    direction: row.status === "pending" ? (seat === 0 ? "outgoing" : "incoming") : "match",
    seat, yourTurn: row.status === "active" && state !== null && state.phase !== "over" && actor(state) === seat,
    you: { id: userId, cls: mine }, opponent: { id: otherId, name: names.get(otherId) ?? "A guildmate", cls: otherCls, onlineInApp: onlineInApp(otherId) },
    season: row.kind === "ranked" ? row.season : null, round: state ? round(state) : 0, version: row.version, turnSeconds: row.turnSeconds,
    turnDeadlineAt: row.turnDeadlineAt?.toISOString() ?? null, expiresAt: row.expiresAt?.toISOString() ?? null,
    clocks: row.clockA !== null && row.clockA !== undefined && row.clockB !== null && row.clockB !== undefined ? { you: seat === 0 ? row.clockA : row.clockB, opponent: seat === 0 ? row.clockB : row.clockA } : null,
    createdAt: row.createdAt.toISOString(), finishedAt: row.finishedAt?.toISOString() ?? null, rated: row.rated
  };
}

function responseOf(row: DuelRow, userId: string, names: Names, events: MatchEvent[] = []): DuelResponse {
  const seat = seatOf(row, userId)!;
  const outcome = Array.isArray(row.result) ? (row.result as (SeatOutcome | null)[])[seat] ?? null : null;
  return { duel: infoOf(row, userId, names), view: row.state ? playerView(stateOf(row), seat) : null, events, rewards: outcome?.rewards ?? null, ranked: outcome?.ranked ?? null };
}

async function namesOf(tx: Pick<Tx, "member">, ids: string[]): Promise<Names> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const rows = await tx.member.findMany({ where: { discordUserId: { in: [...new Set(ids)] }, status: "ACTIVE", isTest: false }, select: { discordUserId: true, displayName: true }, take: 200 });
  for (const row of rows) if (!out.has(row.discordUserId)) out.set(row.discordUserId, row.displayName);
  return out;
}
const reply = async (tx: Pick<Tx, "member">, row: DuelRow, userId: string, events: MatchEvent[] = []): Promise<DuelResponse> => responseOf(row, userId, await namesOf(tx, [row.userA, row.userB]), events);

const random31 = () => randomInt(1, 2 ** 31 - 1);
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); } catch (error) {
      if (error instanceof Conflict && attempt < 2) continue;
      throw error;
    }
  }
}

async function loadDuel(tx: Pick<Tx, "tcgDuel">, id: string, userId: string): Promise<DuelRow> {
  const row = await tx.tcgDuel.findFirst({ where: { id, OR: [{ userA: userId }, { userB: userId }] } }) as DuelRow | null;
  if (!row) throw new TcgError("That match does not exist.", 404);
  return row;
}

const activeCount = (tx: Pick<Tx, "tcgDuel">, userId: string) => tx.tcgDuel.count({ where: { status: "active", OR: [{ userA: userId }, { userB: userId }] } });

// ---- ratings ----

/** The member's row for a season. A new season starts from the partial reset of the last season they played. */
async function ensureRating(tx: Pick<Tx, "tcgRating">, userId: string, season: string): Promise<RatingRow> {
  const found = await tx.tcgRating.findUnique({ where: { discordUserId_season: { discordUserId: userId, season } } }) as RatingRow | null;
  if (found) return found;
  const previous = await tx.tcgRating.findFirst({ where: { discordUserId: userId, season: { lt: season } }, orderBy: { season: "desc" } }) as RatingRow | null;
  const start = previous ? rolloverRating(previous) : { rating: START_RATING, rd: START_RD, vol: START_VOL, stars: 0, streak: 0 };
  return await tx.tcgRating.upsert({
    where: { discordUserId_season: { discordUserId: userId, season } },
    create: { discordUserId: userId, season, rating: start.rating, rd: start.rd, vol: start.vol, stars: start.stars, streak: 0 }, update: {}
  }) as RatingRow;
}

/** What a member's season row would be, without writing it (reads for the status screen). */
async function standingOf(tx: Pick<Tx, "tcgRating">, userId: string, season: string): Promise<RatingRow> {
  const found = await tx.tcgRating.findUnique({ where: { discordUserId_season: { discordUserId: userId, season } } }) as RatingRow | null;
  if (found) return found;
  const previous = await tx.tcgRating.findFirst({ where: { discordUserId: userId, season: { lt: season } }, orderBy: { season: "desc" } }) as RatingRow | null;
  const start = previous ? rolloverRating(previous) : { rating: START_RATING, rd: START_RD, vol: START_VOL, stars: 0, streak: 0 };
  return { discordUserId: userId, season, ...start, wins: 0, losses: 0, games: 0, version: 0 };
}

async function rewardEligible(tx: Pick<Tx, "tcgAccount" | "tcgPlayer">, userId: string, now: Date): Promise<boolean> {
  const [account, player] = await Promise.all([tx.tcgAccount.findUnique({ where: { discordUserId: userId } }), tx.tcgPlayer.findUnique({ where: { discordUserId: userId } })]);
  return !!account && account.createdAt.getTime() + REWARD_MIN_AGE_MS <= now.getTime() && (player?.playedCounted ?? 0) >= REWARD_MIN_PLAYED;
}

// ---- finishing a duel ----

interface DuelEnd { flags: string[]; rated: boolean; counted: boolean; outcomes: [SeatOutcome, SeatOutcome]; apply: () => Promise<void> }

/** Works out everything a finished duel changes: both members' rewards, the ranked ratings and stars, and the officer flags. Writes nothing; the caller applies it only after it wins the compare-and-set on the duel row, so a duel settles at most once. */
async function planEnd(tx: Tx, row: DuelRow, state: MatchState, spells: [number, number], zones: [number, number], endReason: string | undefined, now: Date): Promise<DuelEnd> {
  const winner: 0 | 1 | 2 = state.winner === "draw" || state.winner === null ? 2 : state.winner;
  const ranked = row.kind === "ranked";
  const users = [row.userA, row.userB] as const;
  const turns = [state.players[0].turns, state.players[1].turns] as const;
  const countedSeat = [turns[0] >= MIN_TURNS_COUNTED, turns[1] >= MIN_TURNS_COUNTED] as const;
  const flags: string[] = [];
  let rated = false;
  if (ranked) {
    const recent = await tx.tcgDuel.count({ where: { kind: "ranked", status: "done", finishedAt: { gte: new Date(now.getTime() - DAY_MS) }, OR: [{ userA: row.userA, userB: row.userB }, { userA: row.userB, userB: row.userA }] } });
    rated = recent < PAIR_CAP;
    if (!rated) flags.push("repeat-pair");
  }
  const quit = state.reason === "concede" || endReason === "timeout";
  if (winner !== 2 && quit && turns[winner === 0 ? 1 : 0] < MIN_TURNS_COUNTED) flags.push("early-concede");

  const plans: Settlement[] = [];
  for (const seat of [0, 1] as const) {
    const won = winner === seat;
    const winCounts = ranked && rated && won && await rewardEligible(tx, users[seat], now);
    plans.push(await planReward(tx, { userId: users[seat], matchId: row.id, won, lost: winner !== 2 && !won, counted: countedSeat[seat], winCounts, spells: spells[seat], zones: zones[seat], boss: null }, now));
  }

  let rankedChanges: [RankedChange, RankedChange] | null = null;
  const writes: (() => Promise<void>)[] = [];
  if (ranked) {
    const rows = [await ensureRating(tx, row.userA, row.season), await ensureRating(tx, row.userB, row.season)] as const;
    const changes: RankedChange[] = [];
    for (const seat of [0, 1] as const) {
      const me = rows[seat], other = rows[seat === 0 ? 1 : 0];
      if (!rated) { changes.push({ rated: false, season: row.season, stars: me.stars, starsDelta: 0, streak: me.streak, rank: rankOf(me.stars) }); continue; }
      const score = winner === 2 ? 0.5 : winner === seat ? 1 : 0;
      const next = glicko2(me, [{ rating: other.rating, rd: other.rd, score }]);
      const stars = winner === 2 ? { stars: me.stars, streak: me.streak, delta: 0 } : applyStars(me.stars, me.streak, score === 1);
      changes.push({ rated: true, season: row.season, stars: stars.stars, starsDelta: stars.delta, streak: stars.streak, rank: rankOf(stars.stars) });
      writes.push(async () => {
        const saved = await tx.tcgRating.updateMany({
          where: { discordUserId: me.discordUserId, season: me.season, version: me.version },
          data: { rating: next.rating, rd: next.rd, vol: next.vol, stars: stars.stars, streak: stars.streak, wins: me.wins + (score === 1 ? 1 : 0), losses: me.losses + (score === 0 ? 1 : 0), games: me.games + 1, version: me.version + 1 }
        });
        if (saved.count !== 1) throw new Conflict("Your rating changed while the match finished. Try again.");
      });
    }
    rankedChanges = [changes[0]!, changes[1]!];
  }
  const outcome = (seat: 0 | 1): SeatOutcome => {
    const p = plans[seat]!;
    return { rewards: { dust: p.dust, packs: p.packs, overflowDust: p.overflowDust, questsCompleted: p.questsCompleted, packProgress: p.packProgress, won: p.won }, ranked: rankedChanges ? rankedChanges[seat] : null };
  };
  return {
    flags, rated, counted: countedSeat[0] && countedSeat[1], outcomes: [outcome(0), outcome(1)],
    async apply() { for (const plan of plans) await plan.apply(); for (const write of writes) await write(); }
  };
}

interface Commit {
  row: DuelRow; state: MatchState; log: Action[]; spells: [number, number]; zones: [number, number]; events: MatchEvent[]; endReason?: string;
  /** Match clocks after this change (default: the row's, charged up to `at`), and when the change happened (default: now). */
  clocks?: Clocks; at?: Date;
}

type Clocks = [number | null, number | null];
const clocksOf = (row: Pick<DuelRow, "clockA" | "clockB">): Clocks => [row.clockA ?? null, row.clockB ?? null];
/** Charges the time since the last change to the seat that had to act, on a live match's clock. */
function charged(clocks: Clocks, before: MatchState, from: Date, at: Date): Clocks {
  if (before.phase === "over") return clocks;
  const seat = actor(before);
  const left = clocks[seat];
  if (left === null) return clocks;
  const out: Clocks = [clocks[0], clocks[1]];
  out[seat] = Math.max(0, left - Math.max(0, at.getTime() - from.getTime()));
  return out;
}
/** When the seat that must act runs out of time: its turn clock, or sooner when its match clock has less left. */
function deadlineOf(turnSeconds: number, clocks: Clocks, state: MatchState, from: Date): Date {
  let ms = turnSeconds * 1000;
  const left = clocks[actor(state)];
  if (left !== null) ms = Math.min(ms, left);
  return new Date(from.getTime() + ms);
}

/** Stores the new state and log with a compare-and-set on the version. When the duel ended, rewards and ratings are settled in the same transaction, once. */
async function commit(tx: Tx, userId: string, c: Commit, now: Date): Promise<DuelResponse> {
  const { row, state } = c;
  const over = state.phase === "over";
  const at = c.at ?? now;
  const clocks = c.clocks ?? charged(clocksOf(row), stateOf(row), row.lastActionAt, at);
  const data: Record<string, unknown> = {
    state, actions: c.log, stateHash: stateHash(state), spellsA: c.spells[0], spellsB: c.spells[1], zonesA: c.zones[0], zonesB: c.zones[1],
    lastActionAt: at, version: row.version + 1, clockA: clocks[0], clockB: clocks[1], turnDeadlineAt: over ? null : deadlineOf(row.turnSeconds, clocks, state, at)
  };
  let end: DuelEnd | null = null;
  if (over) {
    end = await planEnd(tx, row, state, c.spells, c.zones, c.endReason, now);
    Object.assign(data, {
      status: "done", winner: state.winner === "draw" || state.winner === null ? 2 : state.winner, reason: c.endReason ?? state.reason, finishedAt: now,
      counted: end.counted, rated: end.rated, flags: end.flags, result: end.outcomes
    });
  }
  const saved = await tx.tcgDuel.updateMany({ where: { id: row.id, version: row.version, status: "active" }, data: data as never });
  if (saved.count !== 1) throw new Conflict("That match just changed somewhere else. Refresh and try again.");
  if (end) await end.apply();
  return reply(tx, { ...row, ...data } as DuelRow, userId, c.events);
}

/** Settles missed clocks of an active duel (design 2.9, owner 10 November 2026). A missed turn clock plays the safe default
 *  for the seat that must act (keep the hand, first Loot option, end the turn) and the third in a row forfeits; an empty match
 *  clock (live) ends the match on Health lost. Each miss is settled from the deadline of the one before. Returns the settled
 *  response, or null when nothing is overdue. */
async function forfeitIfOverdue(tx: Tx, row: DuelRow, userId: string, now: Date): Promise<DuelResponse | null> {
  if (row.status !== "active" || !row.turnDeadlineAt || row.turnDeadlineAt.getTime() > now.getTime()) return null;
  const state = cloneState(stateOf(row));
  const log = [...actionsOf(row)];
  const events: MatchEvent[] = [];
  const playing = (): boolean => state.phase !== "over";
  let clocks = clocksOf(row);
  let from = row.lastActionAt;
  let deadline = row.turnDeadlineAt;
  for (let i = 0; i < 2 * MAX_TIMEOUTS && playing() && deadline.getTime() <= now.getTime(); i++) {
    clocks = charged(clocks, state, from, deadline);
    const action: Action = clocks[actor(state)] === 0 ? { t: "timeUp" } : { t: "timeout" };
    log.push(action);
    applyMut(state, action, events);
    from = deadline;
    if (playing()) deadline = deadlineOf(row.turnSeconds, clocks, state, from);
  }
  return commit(tx, userId, { row, state, log, spells: [row.spellsA, row.spellsB], zones: [row.zonesA, row.zonesB], events, clocks, at: from, ...(state.reason === "timeout" ? { endReason: "timeout" } : {}) }, now);
}

/** A pending challenge past its expiry becomes expired. Returns the updated row (unchanged when it is not due). */
async function expireIfDue(tx: Tx, row: DuelRow, now: Date): Promise<DuelRow> {
  if (row.status !== "pending" || !row.expiresAt || row.expiresAt.getTime() > now.getTime()) return row;
  const saved = await tx.tcgDuel.updateMany({ where: { id: row.id, version: row.version, status: "pending" }, data: { status: "expired", version: row.version + 1 } });
  if (saved.count !== 1) throw new Conflict();
  return { ...row, status: "expired", version: row.version + 1 };
}

/** The clocks of a match that starts now: live matches get the 2:30 match clock on each seat. Ranked matches are live
 *  since 10 November 2026 (both players are in the waiting room when they are paired). */
function clockStart(live: boolean, turnSeconds: number, state: MatchState, now: Date): { clockA: number | null; clockB: number | null; turnDeadlineAt: Date } {
  const clocks: Clocks = live ? [MATCH_CLOCK_MS, MATCH_CLOCK_MS] : [null, null];
  return { clockA: clocks[0], clockB: clocks[1], turnDeadlineAt: deadlineOf(turnSeconds, clocks, state, now) };
}

function startState(seed: number, clsA: string, clsB: string): { state: MatchState; deckA: DeckList; deckB: DeckList } {
  if (!isClassKey(clsA) || !isClassKey(clsB)) throw new TcgError("Pick one of the nine classes.", 400);
  const deckA: DeckList = { cls: clsA, cards: starterDeck(clsA) }, deckB: DeckList = { cls: clsB, cards: starterDeck(clsB) };
  return { state: createMatch(seed, deckA, deckB), deckA, deckB };
}

// ---- friendly challenges ----

export type Allows = (discordGuildId: string) => boolean;

/** Challenge a guildmate. Both of you need to share a server where the card game is on and have a linked character (the trading rule, without the trading switch). */
export async function challenge(db: DuelDb, userId: string, input: { to: string; cls: unknown; live?: boolean }, allows: Allows, now = new Date()): Promise<DuelResponse> {
  if (!isClassKey(input.cls)) throw new TcgError("Pick one of the nine classes.", 400);
  const cls = input.cls;
  const live = input.live === true;
  return db.$transaction(async tx => {
    if (input.to === userId) throw new TcgError("Challenge a guildmate, not yourself.", 400);
    if (live && !onlineInApp(input.to, now)) throw new TcgError("They are not online in the app right now, so a live challenge would just expire. Send an asynchronous challenge instead (24 hours a turn).", 409);
    const guildId = await sharedGuild(tx, userId, input.to, allows, false);
    if (!guildId) throw new TcgError("You can only challenge a guildmate who has Guilded, a linked character and the card game switched on.", 403);
    const open = await tx.tcgDuel.count({ where: { kind: "friendly", status: "pending", userA: userId } });
    if (open >= MAX_OPEN_CHALLENGES) throw new TcgError(`You already have ${MAX_OPEN_CHALLENGES} open challenges. Cancel one first.`, 409);
    const dupes = await tx.tcgDuel.count({ where: { kind: "friendly", status: "pending", OR: [{ userA: userId, userB: input.to }, { userA: input.to, userB: userId }] } });
    if (dupes > 0) throw new TcgError("There is already a challenge waiting between you two.", 409);
    if (await activeCount(tx, userId) >= MAX_ACTIVE_DUELS) throw new TcgError(`You already have ${MAX_ACTIVE_DUELS} matches in progress. Finish or concede one first.`, 409);
    const row = await tx.tcgDuel.create({ data: {
      kind: "friendly", guildId, userA: userId, userB: input.to, clsA: cls, live, status: "pending",
      turnSeconds: live ? LIVE_TURN_SECONDS : TURN_SECONDS, expiresAt: new Date(now.getTime() + (live ? LIVE_CHALLENGE_TTL_MS : CHALLENGE_TTL_MS)), lastActionAt: now
    } }) as DuelRow;
    const response = await reply(tx, row, userId);
    response.duel.opponent.onlineInGame = (await onlineInGame(tx, [input.to], now)).has(input.to);
    return response;
  });
}

/** Accept a challenge with the class you will play. The match starts at once; the challenger moves or mulligans first as the engine decides. */
export async function acceptChallenge(db: DuelDb, userId: string, id: string, cls: unknown, allows: Allows, now = new Date(), seed: number = random31()): Promise<DuelResponse> {
  if (!isClassKey(cls)) throw new TcgError("Pick one of the nine classes.", 400);
  return withRetry(() => db.$transaction(async tx => {
    let row = await loadDuel(tx, id, userId);
    if (row.userB !== userId) throw new TcgError("Only the member who was challenged can accept.", 403);
    row = await expireIfDue(tx, row, now);
    if (row.status === "expired") return reply(tx, row, userId);
    if (row.status !== "pending") throw new TcgError(`That challenge is ${row.status}.`, 409);
    if (await sharedGuild(tx, row.userA, row.userB, allows, false) !== row.guildId) throw new TcgError("You can no longer play each other.", 403);
    for (const user of [row.userA, row.userB]) if (await activeCount(tx, user) >= MAX_ACTIVE_DUELS) throw new TcgError(user === userId ? `You already have ${MAX_ACTIVE_DUELS} matches in progress.` : "Your opponent has too many matches in progress.", 409);
    const { state, deckA, deckB } = startState(seed, row.clsA, cls);
    const data = {
      status: "active", clsB: cls, seed, deckA: deckA as never, deckB: deckB as never, state: state as never, stateHash: stateHash(state), actions: [] as never,
      startedAt: now, lastActionAt: now, expiresAt: null, version: row.version + 1, ...clockStart(row.live, row.turnSeconds, state, now)
    };
    const saved = await tx.tcgDuel.updateMany({ where: { id, version: row.version, status: "pending" }, data });
    if (saved.count !== 1) throw new Conflict();
    return reply(tx, { ...row, ...data } as DuelRow, userId);
  }));
}

/** The challenged member declines, or the challenger takes the challenge back (cancelled). */
export async function declineChallenge(db: DuelDb, userId: string, id: string, now = new Date()): Promise<DuelResponse> {
  return withRetry(() => db.$transaction(async tx => {
    let row = await loadDuel(tx, id, userId);
    row = await expireIfDue(tx, row, now);
    if (row.status === "expired") return reply(tx, row, userId);
    if (row.status !== "pending") throw new TcgError(`That challenge is ${row.status}.`, 409);
    const status = row.userB === userId ? "declined" : "cancelled";
    const saved = await tx.tcgDuel.updateMany({ where: { id, version: row.version, status: "pending" }, data: { status, version: row.version + 1, finishedAt: now } });
    if (saved.count !== 1) throw new Conflict();
    return reply(tx, { ...row, status, version: row.version + 1, finishedAt: now }, userId);
  }));
}

// ---- playing a duel ----

/** The duel as the member sees it. A pending challenge past its expiry is expired and an overdue turn is forfeited first. */
export async function getDuel(db: DuelDb, userId: string, id: string, now = new Date()): Promise<DuelResponse> {
  return withRetry(() => db.$transaction(async tx => {
    let row = await loadDuel(tx, id, userId);
    if (row.status === "pending") row = await expireIfDue(tx, row, now);
    const settled = await forfeitIfOverdue(tx, row, userId, now);
    return settled ?? reply(tx, row, userId);
  }));
}

export interface PolledDuel extends DuelResponse { changed: boolean }

/** Long poll: returns as soon as the duel's version differs from `since`, or after `waitMs` with `changed: false`. Reconnecting is just calling this again with the last version seen. */
export async function pollDuel(db: DuelDb, userId: string, id: string, since: number, opts: { waitMs?: number; stepMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => Date } = {}): Promise<PolledDuel> {
  const waitMs = Math.max(0, Math.min(opts.waitMs ?? 10_000, 12_000)), stepMs = opts.stepMs ?? 1000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const clock = opts.now ?? (() => new Date());
  let waited = 0;
  for (;;) {
    const response = await getDuel(db, userId, id, clock());
    if (response.duel.version !== since || waited >= waitMs) return { ...response, changed: response.duel.version !== since };
    await sleep(stepMs);
    waited += stepMs;
  }
}

/** Plays one move for the member. Illegal moves, moves out of turn and moves in a finished match are refused and change nothing. */
export async function submitDuelIntent(db: DuelDb, userId: string, id: string, action: Action, now = new Date()): Promise<DuelResponse> {
  return withRetry(() => db.$transaction(async tx => {
    const row = await loadDuel(tx, id, userId);
    const seat = seatOf(row, userId)!;
    const overdue = await forfeitIfOverdue(tx, row, userId, now);
    if (overdue) return overdue;
    if (row.status !== "active") throw new TcgError("That match is not being played.", 409);
    const before = stateOf(row);
    if (actor(before) !== seat) throw new TcgError("It is not your turn.", 409);
    let state: MatchState, events: MatchEvent[];
    try { ({ state, events } = apply(before, action)); } catch (error) {
      if (error instanceof IllegalAction) throw new TcgError("That move is not legal right now.", 400);
      throw error;
    }
    const counts = countPlay(before, action, seat);
    const spells: [number, number] = [row.spellsA + (seat === 0 ? counts.spells : 0), row.spellsB + (seat === 1 ? counts.spells : 0)];
    const zones: [number, number] = [row.zonesA + (seat === 0 ? counts.zones : 0), row.zonesB + (seat === 1 ? counts.zones : 0)];
    return commit(tx, userId, { row, state, log: [...actionsOf(row), action], spells, zones, events }, now);
  }));
}

/** Gives up. It is a forfeit (a loss), also when it is not your turn. */
export async function concedeDuel(db: DuelDb, userId: string, id: string, now = new Date()): Promise<DuelResponse> {
  return withRetry(() => db.$transaction(async tx => {
    const row = await loadDuel(tx, id, userId);
    const seat = seatOf(row, userId)!;
    if (row.status !== "active") throw new TcgError("That match is not being played.", 409);
    const state = cloneState(stateOf(row));
    const log = [...actionsOf(row)];
    const events: MatchEvent[] = [];
    const action: Action = { t: "concede", p: seat };
    log.push(action);
    applyMut(state, action, events);
    return commit(tx, userId, { row, state, log, spells: [row.spellsA, row.spellsB], zones: [row.zonesA, row.zonesB], events }, now);
  }));
}

/** The member's challenges and matches, newest first. Expired challenges and overdue turns are settled on the way. */
export async function listDuels(db: DuelDb, userId: string, now = new Date(), limit = 40): Promise<{ duels: DuelInfo[] }> {
  const rows = await db.tcgDuel.findMany({ where: { OR: [{ userA: userId }, { userB: userId }] }, orderBy: { createdAt: "desc" }, take: Math.min(limit, 60) }) as DuelRow[];
  const names = await namesOf(db, rows.flatMap(r => [r.userA, r.userB]));
  const inGame = await onlineInGame(db, rows.filter(r => r.status === "pending" || r.status === "active").map(r => r.userA === userId ? r.userB : r.userA), now);
  const out: DuelInfo[] = [];
  for (const row of rows) {
    const due = (row.status === "pending" && row.expiresAt && row.expiresAt.getTime() <= now.getTime()) || (row.status === "active" && row.turnDeadlineAt && row.turnDeadlineAt.getTime() <= now.getTime());
    const info = infoOf(row, userId, names);
    info.opponent.onlineInApp = onlineInApp(info.opponent.id, now);
    info.opponent.onlineInGame = inGame.has(info.opponent.id);
    if (due) { const settled = await getDuel(db, userId, row.id, now).catch(() => null); if (settled) { settled.duel.opponent.onlineInGame = info.opponent.onlineInGame; out.push(settled.duel); continue; } }
    out.push(info);
  }
  return { duels: out };
}

/** Replays a stored duel from its seed and decks. The result must equal the stored state (tests and audits). */
export function replayDuel(row: Pick<DuelRow, "seed" | "deckA" | "deckB" | "actions">): MatchState {
  return replay(row.seed, row.deckA as DeckList, row.deckB as DeckList, row.actions as Action[]);
}

/** Guildmates the member can challenge: same server, card game on, a linked character. */
export async function duelPartners(db: DuelDb, userId: string, allows: Allows, now = new Date()): Promise<{ partners: { discordUserId: string; name: string; onlineInApp: boolean; onlineInGame: boolean }[] }> {
  const mine = await db.member.findMany({ where: { discordUserId: userId, status: "ACTIVE", isTest: false }, select: { guildId: true, guild: { select: { discordId: true } } }, take: 25 });
  const served = mine.filter(m => allows(m.guild.discordId)).map(m => m.guildId);
  if (!served.length) return { partners: [] };
  const off = await db.guildSettings.findMany({ where: { guildId: { in: served }, tcgEnabled: false }, select: { guildId: true } });
  const guilds = served.filter(g => !off.some(o => o.guildId === g));
  if (!guilds.length) return { partners: [] };
  const others = await db.member.findMany({ where: { guildId: { in: guilds }, discordUserId: { not: userId }, status: "ACTIVE", isTest: false, characters: { some: {} } }, select: { discordUserId: true, displayName: true }, take: 400 });
  const seen = new Set<string>(), partners: { discordUserId: string; name: string; onlineInApp: boolean; onlineInGame: boolean }[] = [];
  const inGame = await onlineInGame(db, others.map(o => o.discordUserId), now);
  for (const other of others) if (!seen.has(other.discordUserId)) { seen.add(other.discordUserId); partners.push({ discordUserId: other.discordUserId, name: other.displayName, onlineInApp: onlineInApp(other.discordUserId, now), onlineInGame: inGame.has(other.discordUserId) }); }
  return { partners: partners.sort((a, b) => Number(b.onlineInApp) - Number(a.onlineInApp) || a.name.localeCompare(b.name)).slice(0, 150) };
}

// ---- the ranked waiting room ----

interface QueueRow { discordUserId: string; cls: string; rating: number; rd: number; joinedAt: Date; expiresAt: Date }

/** Looks for an opponent for a waiting member. The window of acceptable ratings widens with time waited; pairings capped by the three-games-a-day rule are used last. */
async function tryMatch(tx: Tx, me: QueueRow, now: Date, seed: number): Promise<DuelRow | null> {
  await tx.tcgQueue.deleteMany({ where: { expiresAt: { lt: now } } });
  const waiting = await tx.tcgQueue.findMany({ where: { discordUserId: { not: me.discordUserId } }, orderBy: { joinedAt: "asc" }, take: 200 }) as QueueRow[];
  if (!waiting.length) return null;
  const since = new Date(now.getTime() - DAY_MS);
  const recent = await tx.tcgDuel.findMany({ where: { kind: "ranked", status: "done", finishedAt: { gte: since }, OR: [{ userA: me.discordUserId }, { userB: me.discordUserId }] }, select: { userA: true, userB: true }, take: 200 });
  const played = new Map<string, number>();
  for (const r of recent) { const other = r.userA === me.discordUserId ? r.userB : r.userA; played.set(other, (played.get(other) ?? 0) + 1); }
  const myWait = now.getTime() - me.joinedAt.getTime();
  const candidates = waiting
    .filter(c => Math.abs(c.rating - me.rating) <= Math.max(queueWindow(myWait), queueWindow(now.getTime() - c.joinedAt.getTime())))
    .map(c => ({ c, capped: (played.get(c.discordUserId) ?? 0) >= PAIR_CAP ? 1 : 0, diff: Math.abs(c.rating - me.rating) }))
    .sort((x, y) => x.capped - y.capped || x.diff - y.diff || x.c.joinedAt.getTime() - y.c.joinedAt.getTime());
  for (const { c } of candidates) {
    if (await activeCount(tx, c.discordUserId) >= MAX_ACTIVE_DUELS) continue;
    const [first, second] = c.joinedAt.getTime() <= me.joinedAt.getTime() ? [c, me] : [me, c];
    for (const entry of [first, second]) {
      const gone = await tx.tcgQueue.deleteMany({ where: { discordUserId: entry.discordUserId } });
      if (gone.count !== 1) throw new Conflict("The waiting room just changed. Try again.");
    }
    const { state, deckA, deckB } = startState(seed, first.cls, second.cls);
    const row = await tx.tcgDuel.create({ data: {
      kind: "ranked", userA: first.discordUserId, userB: second.discordUserId, clsA: first.cls, clsB: second.cls, live: true, status: "active", season: seasonKey(now),
      seed, deckA: deckA as never, deckB: deckB as never, state: state as never, stateHash: stateHash(state), actions: [] as never,
      turnSeconds: LIVE_TURN_SECONDS, startedAt: now, lastActionAt: now, ...clockStart(true, LIVE_TURN_SECONDS, state, now)
    } }) as DuelRow;
    return row;
  }
  return null;
}

export interface RankedStatus {
  season: string; seasonEndsAt: string;
  queue: { cls: string; since: string; expiresAt: string } | null;
  /** A match that was just found for the caller (the response of the call that made the pairing). */
  matched: DuelResponse | null;
  standing: { stars: number; rank: RankInfo; streak: number; wins: number; losses: number; games: number };
  active: DuelInfo[];
}

async function statusFor(tx: Tx, userId: string, now: Date, matched: DuelResponse | null): Promise<RankedStatus> {
  const season = seasonKey(now);
  const [queueRow, standing, rows] = await Promise.all([
    tx.tcgQueue.findUnique({ where: { discordUserId: userId } }) as Promise<QueueRow | null>,
    standingOf(tx, userId, season),
    tx.tcgDuel.findMany({ where: { kind: "ranked", status: "active", OR: [{ userA: userId }, { userB: userId }] }, orderBy: { createdAt: "desc" }, take: 20 }) as Promise<DuelRow[]>
  ]);
  const names = await namesOf(tx, rows.flatMap(r => [r.userA, r.userB]));
  return {
    season, seasonEndsAt: seasonEndsAt(season).toISOString(),
    queue: queueRow ? { cls: queueRow.cls, since: queueRow.joinedAt.toISOString(), expiresAt: queueRow.expiresAt.toISOString() } : null,
    matched,
    standing: { stars: standing.stars, rank: rankOf(standing.stars), streak: standing.streak, wins: standing.wins, losses: standing.losses, games: standing.games },
    active: rows.map(r => infoOf(r, userId, names))
  };
}

/** Joins the ranked waiting room with the class you will play. Returns at once: either a match was found or you are waiting (ask `rankedStatus` again). */
export async function joinRanked(db: DuelDb, userId: string, cls: unknown, now = new Date(), seed: number = random31()): Promise<RankedStatus> {
  if (!isClassKey(cls)) throw new TcgError("Pick one of the nine classes.", 400);
  return withRetry(() => db.$transaction(async tx => {
    if (await activeCount(tx, userId) >= MAX_ACTIVE_DUELS) throw new TcgError(`You already have ${MAX_ACTIVE_DUELS} matches in progress. Finish or concede one first.`, 409);
    const rating = await ensureRating(tx, userId, seasonKey(now));
    const existing = await tx.tcgQueue.findUnique({ where: { discordUserId: userId } }) as QueueRow | null;
    const entry = (existing
      ? await tx.tcgQueue.update({ where: { discordUserId: userId }, data: { cls, rating: rating.rating, rd: rating.rd, expiresAt: new Date(now.getTime() + QUEUE_TTL_MS) } })
      : await tx.tcgQueue.create({ data: { discordUserId: userId, cls, rating: rating.rating, rd: rating.rd, joinedAt: now, expiresAt: new Date(now.getTime() + QUEUE_TTL_MS) } })) as QueueRow;
    const row = await tryMatch(tx, entry, now, seed);
    return statusFor(tx, userId, now, row ? await reply(tx, row, userId) : null);
  }));
}

/** Where the member stands: the waiting room (matching is tried again with the wider window), the season standing and the ranked matches in progress. */
export async function rankedStatus(db: DuelDb, userId: string, now = new Date(), seed: number = random31()): Promise<RankedStatus> {
  return withRetry(() => db.$transaction(async tx => {
    const entry = await tx.tcgQueue.findUnique({ where: { discordUserId: userId } }) as QueueRow | null;
    let matched: DuelResponse | null = null;
    if (entry && entry.expiresAt.getTime() > now.getTime()) {
      const row = await tryMatch(tx, entry, now, seed);
      if (row) matched = await reply(tx, row, userId);
    }
    return statusFor(tx, userId, now, matched);
  }));
}

export async function leaveRanked(db: DuelDb, userId: string): Promise<{ left: boolean }> {
  const gone = await db.tcgQueue.deleteMany({ where: { discordUserId: userId } });
  return { left: gone.count > 0 };
}

// ---- leaderboards ----

export interface LadderEntry { position: number; name: string; you: boolean; wins: number; losses: number; games?: number; stars?: number; label?: string; legend?: boolean }
export interface LadderBoard { id: string; title: string; entries: LadderEntry[]; you: LadderEntry | null }
export interface Ladder { scope: "global" | "guild" | "friendly"; season: string; weekStart: string | null; boards: LadderBoard[] }

async function guildsOf(tx: Pick<Tx, "member">, userId: string, allows: Allows): Promise<{ id: string; name: string }[]> {
  const rows = await tx.member.findMany({ where: { discordUserId: userId, status: "ACTIVE", isTest: false }, select: { guildId: true, guild: { select: { discordId: true, name: true } } }, take: 25 });
  return rows.filter(r => allows(r.guild.discordId)).map(r => ({ id: r.guildId, name: r.guild.name }));
}

const ladderEntry = (position: number, name: string, you: boolean, r: Pick<RatingRow, "stars" | "wins" | "losses" | "games">): LadderEntry => {
  const rank = rankOf(r.stars);
  return { position, name, you, wins: r.wins, losses: r.losses, games: r.games, stars: r.stars, label: rank.label, legend: rank.legend };
};

async function rankedBoard(tx: Tx, userId: string, season: string, ids: string[] | null, id: string, title: string): Promise<LadderBoard> {
  const where = { season, games: { gt: 0 }, ...(ids ? { discordUserId: { in: ids } } : {}) };
  const rows = await tx.tcgRating.findMany({ where, orderBy: [{ stars: "desc" }, { rating: "desc" }], take: LADDER_SIZE }) as RatingRow[];
  const names = await namesOf(tx, [...rows.map(r => r.discordUserId), userId]);
  const entries = rows.map((r, i) => ladderEntry(i + 1, names.get(r.discordUserId) ?? "A guildmate", r.discordUserId === userId, r));
  let you = entries.find(e => e.you) ?? null;
  if (!you) {
    const mine = await tx.tcgRating.findUnique({ where: { discordUserId_season: { discordUserId: userId, season } } }) as RatingRow | null;
    if (mine && mine.games > 0 && (!ids || ids.includes(userId))) {
      const better = await tx.tcgRating.count({ where: { ...where, OR: [{ stars: { gt: mine.stars } }, { stars: mine.stars, rating: { gt: mine.rating } }] } });
      you = ladderEntry(better + 1, names.get(userId) ?? "You", true, mine);
    }
  }
  return { id, title, entries, you };
}

/** The ranked ladder (the global ladder across every hosted server, or the member's own server) and the weekly friendly-challenge board of their servers. */
export async function leaderboard(db: DuelDb, userId: string, input: { scope: "global" | "guild" | "friendly"; season?: string }, allows: Allows, now = new Date()): Promise<Ladder> {
  const season = input.season && /^\d{4}-(0[1-9]|1[0-2])$/.test(input.season) ? input.season : seasonKey(now);
  return db.$transaction(async tx => {
    const guilds = input.scope === "global" ? [] : await guildsOf(tx, userId, allows);
    if (input.scope === "global") return { scope: "global" as const, season, weekStart: null, boards: [await rankedBoard(tx, userId, season, null, "global", "Global")] };
    if (input.scope === "guild") {
      const boards: LadderBoard[] = [];
      for (const guild of guilds) {
        const members = await tx.member.findMany({ where: { guildId: guild.id, status: "ACTIVE", isTest: false }, select: { discordUserId: true }, take: 2000 });
        boards.push(await rankedBoard(tx, userId, season, members.map(m => m.discordUserId), guild.id, guild.name));
      }
      return { scope: "guild" as const, season, weekStart: null, boards };
    }
    const start = weekStart(now);
    const boards: LadderBoard[] = [];
    for (const guild of guilds) {
      const rows = await tx.tcgDuel.findMany({ where: { kind: "friendly", status: "done", guildId: guild.id, counted: true, finishedAt: { gte: start } }, select: { userA: true, userB: true, winner: true }, take: 3000 });
      const wins = new Map<string, number>(), losses = new Map<string, number>(), pair = new Map<string, number>();
      for (const r of rows) {
        if (r.winner !== 0 && r.winner !== 1) continue;
        const win = r.winner === 0 ? r.userA : r.userB, lose = r.winner === 0 ? r.userB : r.userA;
        losses.set(lose, (losses.get(lose) ?? 0) + 1);
        const key = `${win}>${lose}`;
        pair.set(key, (pair.get(key) ?? 0) + 1);
        if ((pair.get(key) ?? 0) <= FRIENDLY_PAIR_WEEKLY_CAP) wins.set(win, (wins.get(win) ?? 0) + 1);
      }
      const ids = [...new Set([...wins.keys(), ...losses.keys()])];
      const names = await namesOf(tx, [...ids, userId]);
      const sorted = ids.map(id => ({ id, w: wins.get(id) ?? 0, l: losses.get(id) ?? 0, name: names.get(id) ?? "A guildmate" }))
        .sort((a, b) => b.w - a.w || a.l - b.l || a.name.localeCompare(b.name));
      const all = sorted.map((e, i): LadderEntry => ({ position: i + 1, name: e.name, you: e.id === userId, wins: e.w, losses: e.l }));
      boards.push({ id: guild.id, title: guild.name, entries: all.slice(0, LADDER_SIZE), you: all.find(e => e.you) ?? null });
    }
    return { scope: "friendly" as const, season, weekStart: start.toISOString(), boards };
  });
}
