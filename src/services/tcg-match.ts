import { randomInt } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { AlbumLang } from "./companion-album.js";
import { chooseAction, type AiLevel } from "./tcg-ai.js";
import { CARD_BY_ID, starterDeck } from "./tcg-cards-set1.js";
import { actor, applyMut, apply, cloneState, createMatch, IllegalAction, legalActions, round, stateHash, replay } from "./tcg-engine.js";
import { CLASS_KEYS, type Action, type ClassKey, type DeckList, type MatchEvent, type MatchSetup, type MatchState, type PendingLoot, type PlayerState, type Target } from "./tcg-engine-types.js";
import { createGauntletMatch, featuredRun, GAUNTLET, type Boss } from "./tcg-pve.js";
import { dayKey, emptyDaily, MAX_PLAY_PACKS_PER_DAY, MIN_TURNS_COUNTED, OVERFLOW_PACK_DUST, questsOn, settleProgress, STEPS_PER_PACK, type DailyCounters } from "./tcg-quests.js";
import { accrue, MAX_BANKED } from "./tcg.js";
import { TcgError } from "./tcg-store.js";

// Guilded Clash stage C (docs/plans/APP_TCG_GAME.md section 9): server-side matches against the AI or a PvE gauntlet boss.
//
// A stored match is { seed, decks, setup, actions[] } plus the current full state. Replaying the actions from the seed reproduces
// the state hash, so any match can be audited or rebuilt. The member is always seat 0 and the opponent seat 1. The phone only
// ever receives a projection (`playerView`): the opponent's hand and both deck orders never leave the server. The AI plays
// synchronously, so after every member move it is the member's turn again (or the match is over). The turn clock fields are in
// place for later live and asynchronous play: a match whose member does not move before `turnDeadlineAt` is forfeited the next
// time it is read or played.

/** The member's seat; the AI or boss is seat 1. */
export const ME = 0 as const;
export const MAX_ACTIVE_MATCHES = 5;
/** 24 hours a turn (the async length in the design), the same clock live play will shorten. */
export const TURN_SECONDS = 86_400;
const AI_STEP_LIMIT = 3000;

export type MatchKind = "ai" | "pve";
export type MatchStatus = "active" | "won" | "lost" | "draw";

type Tx = Pick<PrismaClient, "tcgAccount" | "tcgCard" | "tcgLog" | "tcgMatch" | "tcgPlayer" | "tcgDaily">;
export type MatchDb = Tx & Pick<PrismaClient, "member" | "guildSettings"> & { $transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> };

/** Raised when another request changed the same match or account first. The caller retries once with fresh data. */
export class Conflict extends TcgError { constructor(message = "That match just changed somewhere else. Refresh and try again.") { super(message, 409); } }

// ---- the player's view (pure) ----

export interface OpponentView extends Omit<PlayerState, "hand" | "deck"> { handCount: number; deckCount: number }
export interface OwnView extends Omit<PlayerState, "deck"> { deckCount: number }
export interface PlayerView {
  phase: MatchState["phase"];
  turn: number;
  round: number;
  /** Whose turn it is by seat (0 is you), and who must act now (the mulligan decider, a Loot chooser or the active player). */
  active: 0 | 1;
  actor: 0 | 1;
  yourTurn: boolean;
  first: 0 | 1;
  mulligan: [boolean, boolean];
  zone: MatchState["zone"];
  me: OwnView;
  opponent: OpponentView;
  /** Your own pending Loot choice. The opponent's options stay hidden. */
  pending: PendingLoot | null;
  opponentChoosing: boolean;
  winner: MatchState["winner"];
  reason: string | null;
  /** The moves you may make now (empty when it is not your turn or the match is over). */
  legal: Action[];
}

/** What a seat is allowed to see: its own hand and pending choices, the board and the public counters, never the opponent's hand, either deck order or the random state. */
export function playerView(state: MatchState, seat: 0 | 1 = ME): PlayerView {
  const other = (1 - seat) as 0 | 1;
  const mine = state.players[seat], theirs = state.players[other];
  const { deck: myDeck, ...ownRest } = mine;
  const { deck: theirDeck, hand: theirHand, ...theirRest } = theirs;
  const who = actor(state);
  const yourTurn = state.phase !== "over" && who === seat;
  const pending = state.pending.find(p => p.p === seat) ?? null;
  const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
  return {
    phase: state.phase, turn: state.turn, round: round(state), active: (seat === 0 ? state.active : (1 - state.active)) as 0 | 1, actor: (seat === 0 ? who : (1 - who)) as 0 | 1, yourTurn, first: (seat === 0 ? state.first : (1 - state.first)) as 0 | 1,
    mulligan: seat === 0 ? [state.mulligan[0], state.mulligan[1]] : [state.mulligan[1], state.mulligan[0]],
    zone: state.zone ? { card: state.zone.card, owner: (seat === 0 ? state.zone.owner : (1 - state.zone.owner)) as 0 | 1 } : null,
    me: copy({ ...ownRest, deckCount: myDeck.length }),
    opponent: copy({ ...theirRest, handCount: theirHand.length, deckCount: theirDeck.length }),
    pending: pending ? copy(pending) : null,
    opponentChoosing: state.pending.some(p => p.p === other),
    winner: state.winner === null || state.winner === "draw" ? state.winner : (seat === 0 ? state.winner : (1 - state.winner) as 0 | 1),
    reason: state.reason,
    legal: yourTurn ? legalActions(state) : []
  };
}

// ---- parsing an intent (pure) ----

const isInt = (value: unknown, max = 200): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;

function parseTarget(value: unknown): Target | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { unit?: unknown; champ?: unknown; hand?: unknown };
  if (isInt(v.unit, 100000)) return { unit: v.unit };
  if (v.champ === 0 || v.champ === 1) return { champ: v.champ };
  if (isInt(v.hand)) return { hand: v.hand };
  return null;
}

/** Builds a clean action from an untrusted request body. Only the five moves a member makes; conceding has its own route. Returns null for anything else. */
export function parseIntent(value: unknown): Action | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { t?: unknown; replace?: unknown; hand?: unknown; target?: unknown; mode?: unknown; unit?: unknown; index?: unknown };
  switch (v.t) {
    case "mulligan": {
      if (!Array.isArray(v.replace) || v.replace.length > 8 || !v.replace.every(i => isInt(i, 8))) return null;
      return { t: "mulligan", replace: [...v.replace] as number[] };
    }
    case "play": {
      if (!isInt(v.hand)) return null;
      const out: Extract<Action, { t: "play" }> = { t: "play", hand: v.hand };
      if (v.target !== undefined) { const target = parseTarget(v.target); if (!target) return null; out.target = target; }
      if (v.mode !== undefined) { if (!isInt(v.mode, 4)) return null; out.mode = v.mode; }
      return out;
    }
    case "attack": {
      const target = parseTarget(v.target);
      if (!isInt(v.unit, 100000) || !target) return null;
      return { t: "attack", unit: v.unit, target };
    }
    case "power": {
      if (v.target === undefined) return { t: "power" };
      const target = parseTarget(v.target);
      return target ? { t: "power", target } : null;
    }
    case "choose": return isInt(v.index, 10) ? { t: "choose", index: v.index } : null;
    case "end": return { t: "end" };
    default: return null;
  }
}

// ---- stored shape ----

interface Row {
  id: string; discordUserId: string; kind: string; aiLevel: string; bossId: string | null; seed: number;
  playerDeck: unknown; opponentDeck: unknown; setup: unknown; actions: unknown; state: unknown; stateHash: string;
  status: string; reason: string | null; spellsCast: number; zonesPlayed: number; turnSeconds: number; turnDeadlineAt: Date | null;
  lastActionAt: Date; version: number; rewardedAt: Date | null; rewardDust: number; rewardPacks: number; createdAt: Date; finishedAt: Date | null;
}
export const stateOf = (row: Row) => row.state as MatchState;
const actionsOf = (row: Row) => row.actions as Action[];

export interface MatchRewards { dust: number; packs: number; overflowDust: number; questsCompleted: string[]; packProgress: number; won: boolean }
export interface MatchInfo {
  id: string; kind: MatchKind; aiLevel: AiLevel; boss: { id: string; name: string } | null; status: MatchStatus; reason: string | null;
  round: number; version: number; turnSeconds: number; turnDeadlineAt: string | null; createdAt: string; finishedAt: string | null;
  rewards: { dust: number; packs: number } | null;
}
export interface MatchResponse { match: MatchInfo; view: PlayerView; events: MatchEvent[]; rewards: MatchRewards | null }

function infoOf(row: Row): MatchInfo {
  const boss = row.bossId ? GAUNTLET.find(b => b.id === row.bossId) : null;
  return {
    id: row.id, kind: row.kind as MatchKind, aiLevel: row.aiLevel as AiLevel, boss: boss ? { id: boss.id, name: boss.name } : null, status: row.status as MatchStatus, reason: row.reason,
    round: round(stateOf(row)), version: row.version, turnSeconds: row.turnSeconds, turnDeadlineAt: row.turnDeadlineAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(), finishedAt: row.finishedAt?.toISOString() ?? null,
    rewards: row.rewardedAt ? { dust: row.rewardDust, packs: row.rewardPacks } : null
  };
}
const responseOf = (row: Row, events: MatchEvent[] = [], rewards: MatchRewards | null = null): MatchResponse => ({ match: infoOf(row), view: playerView(stateOf(row)), events, rewards });

// ---- running the opponent ----

/** Plays the AI's moves until it is the member's turn again or the match ends. Each move is appended to the log. */
function runOpponent(state: MatchState, level: AiLevel, log: Action[], events: MatchEvent[]): void {
  for (let step = 0; step < AI_STEP_LIMIT && state.phase !== "over" && actor(state) === 1; step++) {
    const action = chooseAction(state, level);
    log.push(action);
    applyMut(state, action, events);
  }
  if (state.phase !== "over" && actor(state) === 1) throw new Error("The opponent could not finish its turn.");
}

/** Spells and Zones the member plays are counted for the daily quests (the Loot Bag is not a played card). */
export function countPlay(state: MatchState, action: Action, seat: 0 | 1 = ME): { spells: number; zones: number } {
  if (action.t !== "play") return { spells: 0, zones: 0 };
  const id = state.players[seat].hand[action.hand];
  const card = id ? CARD_BY_ID.get(id) : undefined;
  if (!card || card.bag) return { spells: 0, zones: 0 };
  return { spells: card.type === "spell" ? 1 : 0, zones: card.type === "zone" ? 1 : 0 };
}

// ---- rewards ----

export const jsonList = (value: unknown): string[] => Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];

export interface Settlement { dust: number; packs: number; overflowDust: number; questsCompleted: string[]; packProgress: number; won: boolean; apply: () => Promise<void> }

/** What one member's finished match is worth. Used by matches against the AI and by both seats of a duel. */
export interface RewardInput {
  userId: string; matchId: string; won: boolean; lost: boolean;
  /** The member took enough turns for the match to count. */
  counted: boolean;
  /** A win of this kind counts toward a pack (not Easy AI wins, not friendly challenges, not capped repeat pairings). */
  winCounts: boolean;
  spells: number; zones: number; boss: Boss | null;
}
export type RewardTx = Pick<Tx, "tcgAccount" | "tcgLog" | "tcgPlayer" | "tcgDaily">;

/** Works out what a finished match pays one member and the writes that grant it. Nothing is written here; the caller applies the plan only after it wins the compare-and-set on the match row, so a match pays at most once. */
export async function planReward(tx: RewardTx, input: RewardInput, now: Date): Promise<Settlement> {
  const { userId, won, lost, counted, boss } = input;
  const bossIndex = boss ? GAUNTLET.indexOf(boss) : -1;
  const day = dayKey(now);

  const [existingAccount, playerRow, dailyRow] = await Promise.all([
    tx.tcgAccount.findUnique({ where: { discordUserId: userId } }),
    tx.tcgPlayer.findUnique({ where: { discordUserId: userId } }),
    tx.tcgDaily.findUnique({ where: { discordUserId_day: { discordUserId: userId, day } } })
  ]);
  const account = existingAccount ?? await tx.tcgAccount.create({ data: { discordUserId: userId, banked: 1, accruedAt: now } });
  const daily: DailyCounters = dailyRow
    ? { played: dailyRow.played, wins: dailyRow.wins, spells: dailyRow.spells, zones: dailyRow.zones, packsEarned: dailyRow.packsEarned, questsDone: jsonList(dailyRow.questsDone) }
    : emptyDaily();
  const bossesPaid = dailyRow ? jsonList(dailyRow.bossesPaid) : [];
  const player = playerRow ?? { packProgress: 0, wins: 0, losses: 0, pveCleared: 0, pveRuns: 0, playedCounted: 0 };

  const progress = settleProgress(day, daily, player.packProgress, { won, counted, winCounts: input.winCounts, spells: input.spells, zones: input.zones });
  let dust = 0, packs = progress.packs;

  // A boss pays once per boss per day. The weekly spotlight boss pays double dust, and a bonus pack when it is the last boss.
  let pveCleared = player.pveCleared, pveRuns = player.pveRuns;
  if (boss && won) {
    if (!bossesPaid.includes(boss.id)) {
      const spotlight = featuredRun(now).boss.id === boss.id;
      dust += boss.reward.dust * (spotlight ? 2 : 1);
      packs += boss.reward.packs + (spotlight && bossIndex === GAUNTLET.length - 1 ? 1 : 0);
      bossesPaid.push(boss.id);
    }
    if (bossIndex === pveCleared) { pveCleared += 1; if (pveCleared >= GAUNTLET.length) { pveCleared = 0; pveRuns += 1; } }
  }

  // The bank keeps at most 3 packs; the rest of the packs are paid as dust.
  const clock = accrue(account, now);
  const toBank = Math.min(packs, MAX_BANKED - clock.banked);
  const overflowDust = (packs - toBank) * OVERFLOW_PACK_DUST;
  dust += overflowDust;

  const result = {
    dust, packs: toBank, overflowDust, questsCompleted: progress.questsCompleted, packProgress: progress.packProgress, won,
    async apply() {
      if (dust > 0 || toBank > 0) {
        const banked = clock.banked + toBank;
        const paid = await tx.tcgAccount.updateMany({
          where: { discordUserId: userId, banked: account.banked, dust: account.dust, packsOpened: account.packsOpened },
          data: { banked, accruedAt: banked >= MAX_BANKED ? now : clock.accruedAt, dust: account.dust + dust }
        });
        if (paid.count !== 1) throw new Conflict("Your packs changed while the match finished. Try again.");
        await tx.tcgLog.create({ data: { discordUserId: userId, kind: "match", cards: [{ match: input.matchId, status: won ? "won" : "lost", packs: toBank, overflowDust }], dustDelta: dust } });
      }
      const playerData = { packProgress: progress.packProgress, wins: player.wins + (won ? 1 : 0), losses: player.losses + (lost ? 1 : 0), pveCleared, pveRuns, playedCounted: player.playedCounted + (counted ? 1 : 0) };
      await tx.tcgPlayer.upsert({ where: { discordUserId: userId }, create: { discordUserId: userId, ...playerData }, update: playerData });
      const dailyData = { ...progress.daily, bossesPaid, questsDone: progress.daily.questsDone };
      await tx.tcgDaily.upsert({ where: { discordUserId_day: { discordUserId: userId, day } }, create: { discordUserId: userId, day, ...dailyData }, update: dailyData });
    }
  };
  return result;
}

/** Works out what a finished match against the AI or a boss pays the member. */
async function planSettlement(tx: Tx, row: Row, state: MatchState, spells: number, zones: number, now: Date): Promise<Settlement> {
  const won = state.winner === ME;
  const boss = row.bossId ? GAUNTLET.find(b => b.id === row.bossId) ?? null : null;
  return planReward(tx, {
    userId: row.discordUserId, matchId: row.id, won, lost: state.winner === 1, counted: state.players[ME].turns >= MIN_TURNS_COUNTED,
    winCounts: won && (boss !== null || row.aiLevel !== "easy"), spells, zones, boss
  }, now);
}

// ---- committing a move ----

interface Commit { row: Row; state: MatchState; log: Action[]; spells: number; zones: number; events: MatchEvent[]; endReason?: string }

/** Stores the new state and log with a compare-and-set on the version. When the match ended, the rewards are planned and granted in the same transaction, once. */
async function commit(tx: Tx, c: Commit, now: Date): Promise<MatchResponse> {
  const { row, state } = c;
  const over = state.phase === "over";
  const data: Record<string, unknown> = {
    state, actions: c.log, stateHash: stateHash(state), spellsCast: c.spells, zonesPlayed: c.zones, lastActionAt: now, version: row.version + 1,
    turnDeadlineAt: over ? null : new Date(now.getTime() + row.turnSeconds * 1000)
  };
  let settlement: Settlement | null = null;
  if (over) {
    settlement = await planSettlement(tx, row, state, c.spells, c.zones, now);
    Object.assign(data, {
      status: state.winner === ME ? "won" : state.winner === 1 ? "lost" : "draw", reason: c.endReason ?? state.reason, finishedAt: now,
      rewardedAt: now, rewardDust: settlement.dust, rewardPacks: settlement.packs
    });
  }
  const saved = await tx.tcgMatch.updateMany({ where: { id: row.id, version: row.version, status: "active" }, data: data as never });
  if (saved.count !== 1) throw new Conflict();
  if (settlement) await settlement.apply();
  const next = { ...row, ...data } as Row;
  const rewards = settlement ? { dust: settlement.dust, packs: settlement.packs, overflowDust: settlement.overflowDust, questsCompleted: settlement.questsCompleted, packProgress: settlement.packProgress, won: settlement.won } : null;
  return responseOf(next, c.events, rewards);
}

/** Forfeits an active match whose turn clock ran out. Returns the settled response, or null when the match is not overdue. */
async function forfeitIfOverdue(tx: Tx, row: Row, now: Date): Promise<MatchResponse | null> {
  if (row.status !== "active" || !row.turnDeadlineAt || row.turnDeadlineAt.getTime() > now.getTime()) return null;
  const state = cloneState(stateOf(row));
  const log = [...actionsOf(row)];
  const events: MatchEvent[] = [];
  const action: Action = { t: "concede", p: ME };
  log.push(action);
  applyMut(state, action, events);
  return commit(tx, { row, state, log, spells: row.spellsCast, zones: row.zonesPlayed, events, endReason: "timeout" }, now);
}

// ---- the store ----

const random31 = () => randomInt(1, 2 ** 31 - 1);

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); } catch (error) {
      if (error instanceof Conflict && attempt < 2) continue;
      throw error;
    }
  }
}

async function loadRow(db: Pick<MatchDb, "tcgMatch">, id: string, userId: string): Promise<Row> {
  const row = await db.tcgMatch.findFirst({ where: { id, discordUserId: userId } }) as Row | null;
  if (!row) throw new TcgError("That match does not exist.", 404);
  return row;
}

export interface StartInput { mode: MatchKind; cls: ClassKey; level?: AiLevel; opponentCls?: ClassKey; boss?: string }

export const isClassKey = (value: unknown): value is ClassKey => typeof value === "string" && (CLASS_KEYS as readonly string[]).includes(value);
export const isAiLevel = (value: unknown): value is AiLevel => value === "easy" || value === "normal" || value === "hard";

/** Starts a match against the AI or a gauntlet boss. The member plays their class's free starter deck until deck building arrives. */
export async function startMatch(db: MatchDb, userId: string, input: StartInput, now = new Date(), seed: number = random31()): Promise<MatchResponse> {
  const active = await db.tcgMatch.count({ where: { discordUserId: userId, status: "active" } });
  if (active >= MAX_ACTIVE_MATCHES) throw new TcgError(`You already have ${MAX_ACTIVE_MATCHES} matches in progress. Finish or concede one first.`, 409);
  const mine: DeckList = { cls: input.cls, cards: starterDeck(input.cls) };
  let theirs: DeckList, setup: MatchSetup = {}, level: AiLevel, boss: Boss | null = null, state: MatchState;
  if (input.mode === "pve") {
    boss = GAUNTLET.find(b => b.id === input.boss) ?? null;
    if (!boss) throw new TcgError("That boss does not exist.", 404);
    const player = await db.tcgPlayer.findUnique({ where: { discordUserId: userId } });
    const cleared = player?.pveCleared ?? 0;
    const index = GAUNTLET.indexOf(boss);
    if (index > cleared) throw new TcgError(`Beat ${GAUNTLET[cleared]!.name} first.`, 409);
    level = boss.level;
    theirs = { cls: boss.cls, cards: [...boss.deck] };
    state = createGauntletMatch(seed, mine, boss);
    setup = { zone: { card: boss.zone, owner: 1 }, hp: [20, boss.health] };
  } else {
    level = input.level ?? "normal";
    const opponentCls = input.opponentCls ?? CLASS_KEYS[seed % CLASS_KEYS.length]!;
    theirs = { cls: opponentCls, cards: starterDeck(opponentCls) };
    state = createMatch(seed, mine, theirs);
  }
  const log: Action[] = [];
  const events: MatchEvent[] = [];
  runOpponent(state, level, log, events);
  const stamp = now;
  const created = await db.tcgMatch.create({ data: {
    discordUserId: userId, kind: input.mode, aiLevel: level, bossId: boss?.id ?? null, seed, playerDeck: mine as never, opponentDeck: theirs as never, setup: setup as never,
    actions: log as never, state: state as never, stateHash: stateHash(state), turnSeconds: TURN_SECONDS, lastActionAt: stamp, turnDeadlineAt: new Date(stamp.getTime() + TURN_SECONDS * 1000)
  } }) as Row;
  return responseOf(created, events);
}

/** The match as the member sees it. An overdue match is forfeited first. */
export async function getMatch(db: MatchDb, userId: string, id: string, now = new Date()): Promise<MatchResponse> {
  return withRetry(async () => {
    const row = await loadRow(db, id, userId);
    if (row.status === "active" && row.turnDeadlineAt && row.turnDeadlineAt.getTime() <= now.getTime()) {
      const settled = await db.$transaction(tx => forfeitIfOverdue(tx, row, now));
      if (settled) return settled;
    }
    return responseOf(row);
  });
}

/** Plays one member move, then the opponent's replies. Illegal moves are refused and change nothing. */
export async function submitIntent(db: MatchDb, userId: string, id: string, action: Action, now = new Date()): Promise<MatchResponse> {
  return withRetry(async () => {
    const row = await loadRow(db, id, userId);
    return db.$transaction(async tx => {
      const overdue = await forfeitIfOverdue(tx, row, now);
      if (overdue) return overdue;
      if (row.status !== "active") throw new TcgError("That match is over.", 409);
      const before = stateOf(row);
      if (actor(before) !== ME) throw new TcgError("It is not your turn.", 409);
      let state: MatchState;
      let events: MatchEvent[];
      try { ({ state, events } = apply(before, action)); } catch (error) {
        if (error instanceof IllegalAction) throw new TcgError("That move is not legal right now.", 400);
        throw error;
      }
      const counts = countPlay(before, action);
      const log = [...actionsOf(row), action];
      runOpponent(state, row.aiLevel as AiLevel, log, events);
      return commit(tx, { row, state, log, spells: row.spellsCast + counts.spells, zones: row.zonesPlayed + counts.zones, events }, now);
    });
  });
}

/** Gives up. The match is lost; it still counts as played when the member had taken enough turns. */
export async function concedeMatch(db: MatchDb, userId: string, id: string, now = new Date()): Promise<MatchResponse> {
  return withRetry(async () => {
    const row = await loadRow(db, id, userId);
    return db.$transaction(async tx => {
      if (row.status !== "active") throw new TcgError("That match is over.", 409);
      const state = cloneState(stateOf(row));
      const log = [...actionsOf(row)];
      const events: MatchEvent[] = [];
      const action: Action = { t: "concede", p: ME };
      log.push(action);
      applyMut(state, action, events);
      return commit(tx, { row, state, log, spells: row.spellsCast, zones: row.zonesPlayed, events }, now);
    });
  });
}

/** The member's recent matches, newest first. Overdue active matches are forfeited on the way. */
export async function listMatches(db: MatchDb, userId: string, now = new Date(), limit = 30): Promise<{ matches: MatchInfo[] }> {
  const rows = await db.tcgMatch.findMany({ where: { discordUserId: userId }, orderBy: { createdAt: "desc" }, take: Math.min(limit, 50) }) as Row[];
  const out: MatchInfo[] = [];
  for (const row of rows) {
    if (row.status === "active" && row.turnDeadlineAt && row.turnDeadlineAt.getTime() <= now.getTime()) {
      const settled = await getMatch(db, userId, row.id, now).catch(() => null);
      if (settled) { out.push(settled.match); continue; }
    }
    out.push(infoOf(row));
  }
  return { matches: out };
}

/** Replays a stored match from its seed and decks. The result must equal the stored state (used by tests and audits). */
export function replayRow(row: Pick<Row, "seed" | "playerDeck" | "opponentDeck" | "setup" | "actions">): MatchState {
  return replay(row.seed, row.playerDeck as DeckList, row.opponentDeck as DeckList, row.actions as Action[], row.setup as MatchSetup);
}

export interface PveProgress {
  bosses: { id: string; name: string; flavour: string; cls: ClassKey; level: AiLevel; health: number; reward: Boss["reward"]; cleared: boolean; unlocked: boolean; paidToday: boolean; spotlight: boolean }[];
  cleared: number; runs: number;
  featured: { week: number; boss: string; note: string };
  daily: { day: string; quests: { id: string; text: string; target: number; progress: number; done: boolean }[]; packsFromPlay: number; packCap: number; packProgress: number; stepsPerPack: number };
  wins: number; losses: number;
}

/** The gauntlet, today's quests and the member's pack progress. */
export async function pveProgress(db: MatchDb, userId: string, lang: AlbumLang, now = new Date()): Promise<PveProgress> {
  const day = dayKey(now);
  const [player, dailyRow] = await Promise.all([
    db.tcgPlayer.findUnique({ where: { discordUserId: userId } }),
    db.tcgDaily.findUnique({ where: { discordUserId_day: { discordUserId: userId, day } } })
  ]);
  const cleared = player?.pveCleared ?? 0;
  const paid = dailyRow ? jsonList(dailyRow.bossesPaid) : [];
  const done = dailyRow ? jsonList(dailyRow.questsDone) : [];
  const spotlight = featuredRun(now);
  const value: Record<string, number> = { win1: dailyRow?.wins ?? 0, play3: dailyRow?.played ?? 0, spells10: dailyRow?.spells ?? 0, zone1: dailyRow?.zones ?? 0 };
  return {
    bosses: GAUNTLET.map((boss, i) => ({ id: boss.id, name: boss.name, flavour: boss.flavour, cls: boss.cls, level: boss.level, health: boss.health, reward: boss.reward, cleared: i < cleared, unlocked: i <= cleared, paidToday: paid.includes(boss.id), spotlight: spotlight.boss.id === boss.id })),
    cleared, runs: player?.pveRuns ?? 0,
    featured: { week: spotlight.week, boss: spotlight.boss.id, note: spotlight.note },
    daily: {
      day, packsFromPlay: dailyRow?.packsEarned ?? 0, packCap: MAX_PLAY_PACKS_PER_DAY, packProgress: player?.packProgress ?? 0, stepsPerPack: STEPS_PER_PACK,
      quests: questsOn(day).map(q => ({ id: q.id, text: q[lang], target: q.target, progress: Math.min(q.target, value[q.id] ?? 0), done: done.includes(q.id) }))
    },
    wins: player?.wins ?? 0, losses: player?.losses ?? 0
  };
}
