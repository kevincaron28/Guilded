import { createHash } from "node:crypto";
import { CARD_BY_ID, DECK_SIZE, LOOT_BAG, cardOf, roleOfCard } from "./tcg-cards-set1.js";
import type { Ability, Action, CardDef, ClassKey, Cond, DeckList, Eff, Keyword, MatchEvent, MatchSetup, MatchState, PlayerState, Sel, Target, To, UnitState } from "./tcg-engine-types.js";

// Guilded Clash rules engine (docs/plans/APP_TCG_GAME.md section 2). Pure and deterministic: all randomness comes from the
// seed stored inside the match state, nothing reads a clock or Math.random, and a match is fully described by
// { seed, decks, actions }. Replaying the actions reproduces the same state hash. No network, no database.

// Match length (balance review of 10 November 2026, docs/plans/CLASH_BALANCE_REVIEW_2026-11-10.md): 16 Health, Sudden Death
// (Exhaustion 2, 4, 6...) from round 8, and round 9 is the last: then the Champion who lost less Health wins.
export const START_HEALTH = 16;
export const HAND_LIMIT = 8;
export const BOARD_LIMIT = 5;
export const MANA_CAP = 8;
export const MANA_HARD_CAP = 10;
export const EXHAUSTION_ROUND = 8;
export const EXHAUSTION_STEP = 2;
/** The last round: the match ends after it (see Rules.capRule). */
export const DRAW_ROUND = 9;
export const SECOND_WIND_HEALTH = 6;
export const POWER_COST = 2;

/** The match-length rules in one place, so the balance simulator (scripts/clash-sim.ts) can try other numbers with
 *  `withRules`. Live matches always use DEFAULT_RULES. */
export interface Rules {
  startHealth: number;
  manaCap: number;
  /** Extra mana on every turn: turn n has min(n + manaBonus, manaCap). */
  manaBonus: number;
  exhaustionRound: number;
  /** Exhaustion damage grows by this much each time (1, 2, 3... with 1). */
  exhaustionStep: number;
  drawRound: number;
  /** After the last round: "draw", or "health" (the Champion who lost less Health, Armor counting as Health, wins; equal is a draw). */
  capRule: "draw" | "health";
  secondWindHealth: number;
  /** Opening hand of the second player (the first player has 3), before the Loot Bag. */
  secondHand: number;
  /** The first player also draws on their first turn (the second player still has one more card and the Loot Bag). */
  firstDraws: boolean;
}
export const DEFAULT_RULES: Readonly<Rules> = Object.freeze({
  startHealth: START_HEALTH, manaCap: MANA_CAP, manaBonus: 0, exhaustionRound: EXHAUSTION_ROUND, exhaustionStep: EXHAUSTION_STEP,
  drawRound: DRAW_ROUND, capRule: "health", secondWindHealth: SECOND_WIND_HEALTH, secondHand: 4, firstDraws: true
} satisfies Rules);
let R: Readonly<Rules> = DEFAULT_RULES;
/** Runs `fn` with some rules changed (the simulator and tests only; not re-entrant across awaits). */
export function withRules<T>(over: Partial<Rules>, fn: () => T): T {
  const before = R;
  R = { ...before, ...over };
  try { return fn(); } finally { R = before; }
}
export const currentRules = (): Readonly<Rules> => R;

type Side = 0 | 1;
const other = (p: Side): Side => (p === 0 ? 1 : 0);

interface Ctx { p: Side; self?: number; selfCard?: string; target?: Target; rally?: boolean }
interface X { s: MatchState; ev: MatchEvent[]; settling: boolean; frenzyQ: number[] }

// ---- random numbers (mulberry32, state kept in the match) ----
function rngNext(s: MatchState): number {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rngInt = (s: MatchState, n: number): number => Math.floor(rngNext(s) * n);
function shuffle<T>(s: MatchState, list: T[]): void {
  for (let i = list.length - 1; i > 0; i--) { const j = rngInt(s, i + 1); [list[i], list[j]] = [list[j]!, list[i]!]; }
}

// ---- helpers ----
export const cloneState = (s: MatchState): MatchState => JSON.parse(JSON.stringify(s)) as MatchState;
export const round = (s: MatchState): number => Math.ceil(s.turn / 2);
const unitCard = (u: UnitState): CardDef => cardOf(u.card);
const NO_TEXT: Pick<CardDef, "aura" | "frenzy" | "lastStand" | "startTurn" | "endTurn"> = {};
/** The text a unit still has in play: none once it is Dispelled. */
const textOf = (u: UnitState): Pick<CardDef, "aura" | "frenzy" | "lastStand" | "startTurn" | "endTurn"> => (u.quiet ? NO_TEXT : unitCard(u));
const hasKw = (u: UnitState, word: Keyword): boolean => u.kw.includes(word) || u.tempKw.includes(word);
const zoneFlag = (s: MatchState) => (s.zone ? cardOf(s.zone.card).zone : undefined);
const standardOf = (s: MatchState, p: Side) => { const id = s.players[p].standard; return id ? cardOf(id) : null; };
const hasStandard = (s: MatchState, p: Side, flag: string): boolean => standardOf(s, p)?.standard === flag;

function findUnit(s: MatchState, uid: number): { u: UnitState; p: Side; i: number } | null {
  for (const p of [0, 1] as const) {
    const i = s.players[p].board.findIndex(u => u.uid === uid);
    if (i >= 0) return { u: s.players[p].board[i]!, p, i };
  }
  return null;
}

/** Roles on a board right now (Full Party needs all three). */
const roles = (s: MatchState, p: Side) => {
  const found = { tank: false, healer: false, damage: false };
  for (const u of s.players[p].board) found[roleOfCard(unitCard(u))] = true;
  return found;
};
export const partyActive = (s: MatchState, p: Side): boolean => { const r = roles(s, p); return r.tank && r.healer && r.damage; };

function auraSum(s: MatchState, p: Side, pick: (aura: NonNullable<CardDef["aura"]>[number]) => number): number {
  let total = 0;
  for (const u of s.players[p].board) for (const aura of textOf(u).aura ?? []) total += pick(aura);
  return total;
}

/** Current Attack: printed and permanent, this-turn buffs, auras, the Warlord's Ladder Standard and the Smoke Zone. */
export function atkOf(s: MatchState, p: Side, u: UnitState): number {
  let atk = u.atk + u.tempAtk;
  const r = roles(s, p);
  for (const aura of textOf(u).aura ?? []) if (aura.k === "atkIfTankHealer" && r.tank && r.healer) atk += aura.n;
  if (s.active === p && hasStandard(s, p, "atkOnTurn")) atk += 1;
  if (zoneFlag(s) === "smoke" && hasKw(u, "shadow")) atk += 1;
  return Math.max(0, atk);
}
/** Maximum Health including auras. */
export function maxHpOf(s: MatchState, p: Side, u: UnitState): number {
  const role = roleOfCard(unitCard(u));
  let bonus = 0;
  for (const x of s.players[p].board) for (const aura of textOf(x).aura ?? []) if (aura.k === "hpRoles" && aura.roles.includes(role) && x.uid !== u.uid) bonus += aura.n;
  return u.hp + bonus;
}
export const hpOf = (s: MatchState, p: Side, u: UnitState): number => maxHpOf(s, p, u) - u.dmg;

const boardLimit = (s: MatchState): number => (zoneFlag(s) === "narrow" ? 4 : BOARD_LIMIT);

function emit(x: X, t: string, data: Record<string, unknown> = {}): void { x.ev.push({ t, ...data }); }

// ---- creating a match ----
const newUnit = (s: MatchState, cardId: string): UnitState => {
  const c = cardOf(cardId);
  return { uid: s.nextUid++, card: cardId, atk: c.atk ?? 0, hp: c.hp ?? 1, dmg: 0, kw: [...(c.kw ?? [])], tempKw: [], tempAtk: 0, attacks: 0, since: s.turn, chilled: false, gear: null, gearOn: false, frenzied: false, doomed: false, survivor: false, zoneShieldUntil: null };
};

function newPlayer(list: DeckList): PlayerState {
  return { cls: list.cls, hp: R.startHealth, maxHp: R.startHealth, armor: 0, deck: [...list.cards], hand: [], board: [], standard: null, mana: 0, turns: 0, exhaustion: 0, secondWind: false, powerUsed: false, cooldown: 0, lastDied: null, partyDiscount: false, played: 0, nextDiscount: 0, nextSpellFree: false, perfectTurn: 0, attacked: 0 };
}

function drawRaw(s: MatchState, p: Side): string | null {
  const card = s.players[p].deck.pop();
  return card ?? null;
}

/** Opening-hand smoothing: if the hand has no card costing 2 or less, swap its dearest card for the cheapest such card in the deck. */
function smooth(s: MatchState, p: Side): void {
  const pl = s.players[p];
  const cheap = (id: string) => cardOf(id).cost <= 2;
  const real = (id: string) => !cardOf(id).bag;
  if (pl.hand.filter(real).length === 0 || pl.hand.some(id => real(id) && cheap(id))) return;
  const at = pl.deck.findIndex(cheap);
  if (at < 0) return;
  let worst = pl.hand.findIndex(real);
  pl.hand.forEach((id, i) => { if (real(id) && cardOf(id).cost > cardOf(pl.hand[worst]!).cost) worst = i; });
  [pl.hand[worst], pl.deck[at]] = [pl.deck[at]!, pl.hand[worst]!];
}

export function createMatch(seed: number, a: DeckList, b: DeckList, setup: MatchSetup = {}): MatchState {
  for (const list of [a, b]) {
    if (list.cards.length !== DECK_SIZE) throw new Error(`A deck needs ${DECK_SIZE} cards.`);
    for (const id of list.cards) if (!CARD_BY_ID.has(id) || cardOf(id).token) throw new Error(`Unknown card ${id}`);
  }
  const s: MatchState = {
    v: 1, rng: seed >>> 0, turn: 0, first: 0, active: 0, phase: "mulligan", mulligan: [false, false],
    players: [newPlayer(a), newPlayer(b)], zone: null, nextUid: 1, pending: [], winner: null, reason: null
  };
  if (setup.hp) for (const p of [0, 1] as const) { s.players[p].hp = setup.hp[p]; s.players[p].maxHp = setup.hp[p]; }
  if (setup.zone) s.zone = { ...setup.zone };
  s.first = rngInt(s, 2) as Side;
  s.active = s.first;
  for (const p of [0, 1] as const) shuffle(s, s.players[p].deck);
  const second = other(s.first);
  for (let i = 0; i < 3; i++) { const c = drawRaw(s, s.first); if (c) s.players[s.first].hand.push(c); }
  for (let i = 0; i < R.secondHand; i++) { const c = drawRaw(s, second); if (c) s.players[second].hand.push(c); }
  s.players[second].hand.push(LOOT_BAG);
  smooth(s, s.first);
  smooth(s, second);
  return s;
}

// ---- cost ----
/** What a card in hand costs right now. */
export function costOf(s: MatchState, p: Side, id: string): number {
  const c = cardOf(id);
  const pl = s.players[p];
  if (c.bag) return 0;
  let cost = c.cost;
  if (c.type === "spell") {
    if (pl.nextSpellFree) return 0;
    cost -= auraSum(s, p, a => (a.k === "spellCost" ? a.n : 0));
  }
  if (c.type === "gear") {
    cost -= auraSum(s, p, a => (a.k === "gearCost" ? a.n : 0));
    if (hasStandard(s, p, "gearCost")) cost -= 1;
  }
  if (pl.played === 0) {
    if (pl.partyDiscount) cost -= 1;
    if (hasStandard(s, p, "zoneDiscount") && s.zone) cost -= 1;
  }
  cost -= pl.nextDiscount;
  return Math.max(0, cost);
}

// ---- class powers ----
export interface PowerDef { name: string; cost: number; target?: Sel; effects: Eff[] }
export const POWERS: Record<ClassKey, PowerDef> = {
  warrior: { name: "Brace", cost: POWER_COST, effects: [{ k: "armor", n: 2 }] },
  paladin: { name: "Ward", cost: POWER_COST, target: "friendlyUnit", effects: [{ k: "kw", kw: "shield", to: "target" }] },
  hunter: { name: "Call Companion", cost: POWER_COST, effects: [{ k: "summon", token: "tk-beast-companion", n: 1 }] },
  rogue: { name: "Sinister Jab", cost: POWER_COST, target: "enemyUnit", effects: [{ k: "dmg", n: 1, to: "target" }] },
  priest: { name: "Mending Word", cost: POWER_COST, target: "friendlyChar", effects: [{ k: "mend", n: 3, to: "target" }] },
  shaman: { name: "Stone Totem", cost: POWER_COST, effects: [{ k: "summon", token: "tk-totem", n: 1 }] },
  mage: { name: "Ember Spark", cost: POWER_COST, target: "anyChar", effects: [{ k: "dmg", n: 1, to: "target" }] },
  warlock: { name: "Soul Pact", cost: POWER_COST, effects: [{ k: "selfDmg", n: 2 }, { k: "draw", n: 1 }] },
  druid: { name: "Growth", cost: POWER_COST, target: "friendlyUnit", effects: [{ k: "buff", a: 1, h: 1, to: "target" }] }
};
export const powerCost = (s: MatchState, p: Side): number => Math.max(0, POWERS[s.players[p].cls].cost - (hasStandard(s, p, "powerCost") ? 1 : 0));

// ---- targets ----
const targetsEqual = (a: Target | undefined, b: Target | undefined): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Units a side can pick as targets: enemy Shadow units are hidden. */
function targetableUnits(s: MatchState, p: Side, side: Side): UnitState[] {
  return s.players[side].board.filter(u => side === p || !hasKw(u, "shadow"));
}

export function targetsFor(s: MatchState, p: Side, sel: Sel, self?: number, handAfter?: string[]): Target[] {
  const out: Target[] = [];
  const mine = s.players[p].board;
  const theirs = targetableUnits(s, p, other(p));
  const unitT = (u: UnitState): Target => ({ unit: u.uid });
  const anyUnits = [...mine, ...theirs];
  switch (sel) {
    case "enemyUnit": return theirs.map(unitT);
    case "friendlyUnit": return mine.map(unitT);
    case "friendlyOtherUnit": return mine.filter(u => u.uid !== self).map(unitT);
    case "friendlyNoGear": return mine.filter(u => u.gear === null).map(unitT);
    case "anyUnit": return anyUnits.map(unitT);
    case "friendlyChar": return [...mine.map(unitT), { champ: p }];
    case "anyChar": return [...anyUnits.map(unitT), { champ: 0 }, { champ: 1 }];
    case "undamagedUnit": return anyUnits.filter(u => u.dmg === 0).map(unitT);
    case "attackedUnit": return anyUnits.filter(u => u.attacks > 0).map(unitT);
    case "bigUnit": return anyUnits.filter(u => atkOf(s, mine.includes(u) ? p : other(p), u) >= 5).map(unitT);
    case "handOther": (handAfter ?? []).forEach((_, i) => out.push({ hand: i })); return out;
  }
}

function resolveTo(x: X, to: To, c: Ctx): Target[] {
  const s = x.s;
  const p = c.p;
  const unitT = (u: UnitState): Target => ({ unit: u.uid });
  const exists = (t: Target | undefined): t is Target => {
    if (!t) return false;
    if ("unit" in t) return findUnit(s, t.unit) !== null;
    return true;
  };
  switch (to) {
    case "target": return exists(c.target) && !("hand" in c.target) ? [c.target] : [];
    case "self": return c.self !== undefined && findUnit(s, c.self) ? [{ unit: c.self }] : [];
    case "myChamp": return [{ champ: p }];
    case "oppChamp": return [{ champ: other(p) }];
    case "allEnemyUnits": return s.players[other(p)].board.map(unitT);
    case "allFriendlyUnits": return s.players[p].board.map(unitT);
    case "otherFriendlyUnits": return s.players[p].board.filter(u => u.uid !== c.self).map(unitT);
    case "allUnits": return [...s.players[s.active].board, ...s.players[other(s.active)].board].map(unitT);
    case "otherUnits": return [...s.players[s.active].board, ...s.players[other(s.active)].board].filter(u => u.uid !== c.self).map(unitT);
    case "allFriendlyChars": return [...s.players[p].board.map(unitT), { champ: p }];
    case "randomEnemyUnit": { const list = targetableUnits(s, p, other(p)); return list.length ? [unitT(list[rngInt(s, list.length)]!)] : []; }
    case "randomEnemyChar": { const list: Target[] = [...targetableUnits(s, p, other(p)).map(unitT), { champ: other(p) }]; return [list[rngInt(s, list.length)]!]; }
    case "randomDamagedFriendlyChar": {
      const list: Target[] = [...s.players[p].board.filter(u => u.dmg > 0).map(unitT)];
      if (s.players[p].hp < s.players[p].maxHp) list.push({ champ: p });
      return list.length ? [list[rngInt(s, list.length)]!] : [];
    }
  }
}

// ---- damage, healing, drawing ----
function dealDamage(x: X, t: Target, amount: number, c: Ctx, source?: { p: Side; u: UnitState }): number {
  const s = x.s;
  if (amount <= 0) return 0;
  if ("champ" in t) {
    const pl = s.players[t.champ];
    let n = amount;
    if (c.rally && zoneFlag(s) === "smoke") n = Math.max(0, n - 1);
    const soaked = Math.min(pl.armor, n);
    pl.armor -= soaked;
    pl.hp -= n - soaked;
    emit(x, "damage", { champ: t.champ, n });
    return n;
  }
  if (!("unit" in t)) return 0;
  const f = findUnit(s, t.unit);
  if (!f) return 0;
  if (f.u.kw.includes("shield") || f.u.tempKw.includes("shield")) {
    f.u.kw = f.u.kw.filter(k => k !== "shield");
    f.u.tempKw = f.u.tempKw.filter(k => k !== "shield");
    emit(x, "shieldPop", { unit: f.u.uid });
    return 0;
  }
  f.u.dmg += amount;
  emit(x, "damage", { unit: f.u.uid, n: amount });
  if (hpOf(s, f.p, f.u) > 0 && !f.u.frenzied && textOf(f.u).frenzy) x.frenzyQ.push(f.u.uid);
  void source;
  return amount;
}

function mendTarget(x: X, t: Target, n: number): number {
  const s = x.s;
  if ("champ" in t) { const pl = s.players[t.champ]; const gained = Math.max(0, Math.min(n, pl.maxHp - pl.hp)); pl.hp += gained; if (gained) emit(x, "mend", { champ: t.champ, n: gained }); return gained; }
  if ("unit" in t) { const f = findUnit(s, t.unit); if (!f) return 0; const gained = Math.min(n, f.u.dmg); f.u.dmg -= gained; if (gained) emit(x, "mend", { unit: f.u.uid, n: gained }); return gained; }
  return 0;
}

function drawCards(x: X, p: Side, n: number): void {
  for (let i = 0; i < n; i++) {
    const card = drawRaw(x.s, p);
    if (!card) return;
    if (x.s.players[p].hand.length >= HAND_LIMIT) { emit(x, "burn", { p, card }); continue; }
    x.s.players[p].hand.push(card);
    emit(x, "draw", { p });
  }
}

function addToHand(x: X, p: Side, card: string): void {
  if (x.s.players[p].hand.length >= HAND_LIMIT) { emit(x, "burn", { p, card }); return; }
  x.s.players[p].hand.push(card);
}

function gainTempMana(x: X, p: Side, n: number): void {
  const pl = x.s.players[p];
  pl.mana = Math.min(MANA_HARD_CAP, pl.mana + n);
}

// ---- units entering play ----
function addUnit(x: X, p: Side, cardId: string, tweak?: { hp1?: boolean; shield?: boolean; quiet?: boolean }): UnitState | null {
  const s = x.s;
  if (s.players[p].board.length >= boardLimit(s)) return null;
  const u = newUnit(s, cardId);
  if (tweak?.hp1) u.hp = 1;
  if (tweak?.quiet) u.quiet = true;
  if (tweak?.shield && !u.kw.includes("shield")) u.kw.push("shield");
  if (zoneFlag(s) === "cairn" && !u.kw.includes("shield")) { u.kw.push("shield"); u.zoneShieldUntil = s.turn + 1; }
  s.players[p].board.push(u);
  emit(x, "enter", { p, unit: u.uid, card: cardId });
  return u;
}

function cond(x: X, p: Side, c: Cond): boolean {
  const s = x.s;
  switch (c) {
    case "zone": return s.zone !== null;
    case "party": return partyActive(s, p);
    case "units3": return s.players[p].board.length >= 3;
    case "low10": return s.players[p].hp < 10;
  }
}

function lootOptions(s: MatchState, p: Side, spellOnly: boolean): string[] {
  const pl = s.players[p];
  const eligible: number[] = [];
  pl.deck.forEach((id, i) => { if (!spellOnly || cardOf(id).type === "spell") eligible.push(i); });
  const picks: number[] = [];
  while (picks.length < 3 && eligible.length) picks.push(eligible.splice(rngInt(s, eligible.length), 1)[0]!);
  picks.sort((a, b) => b - a);
  const taken = picks.map(i => pl.deck.splice(i, 1)[0]!);
  return taken.reverse();
}

function runEffect(x: X, e: Eff, c: Ctx): void {
  const s = x.s;
  const p = c.p;
  switch (e.k) {
    case "dmg": {
      const src = c.self !== undefined ? findUnit(s, c.self) : null;
      for (const t of resolveTo(x, e.to, c)) {
        dealDamage(x, t, e.n, c, src ? { p: src.p, u: src.u } : undefined);
        if (e.recoil && "unit" in t) { const f = findUnit(s, t.unit); if (f && hpOf(s, f.p, f.u) > 0) dealDamage(x, { champ: p }, e.recoil, c); }
      }
      return;
    }
    case "mend": for (const t of resolveTo(x, e.to, c)) mendTarget(x, t, e.n); return;
    case "armor": s.players[p].armor += e.n; return;
    case "draw": drawCards(x, p, e.n); return;
    case "buff":
      for (const t of resolveTo(x, e.to, c)) {
        if (!("unit" in t)) continue;
        const f = findUnit(s, t.unit);
        if (!f) continue;
        if (e.turn) f.u.tempAtk += e.a; else { f.u.atk += e.a; f.u.hp += e.h; }
      }
      return;
    case "kw":
      for (const t of resolveTo(x, e.to, c)) {
        if (!("unit" in t)) continue;
        const f = findUnit(s, t.unit);
        if (!f) continue;
        const list = e.turn ? f.u.tempKw : f.u.kw;
        if (!list.includes(e.kw)) list.push(e.kw);
      }
      return;
    case "summon": for (let i = 0; i < e.n; i++) addUnit(x, p, e.token); return;
    case "summonCopy": if (c.selfCard) addUnit(x, p, c.selfCard, { hp1: e.hp1 ?? false, shield: e.shield ?? false, quiet: e.quiet ?? false }); return;
    case "destroy": for (const t of resolveTo(x, e.to, c)) if ("unit" in t) { const f = findUnit(s, t.unit); if (f) f.u.doomed = true; } return;
    case "chill": for (const t of resolveTo(x, e.to, c)) if ("unit" in t) { const f = findUnit(s, t.unit); if (f) f.u.chilled = true; } return;
    case "dispel":
      for (const t of resolveTo(x, e.to, c)) if ("unit" in t) { const f = findUnit(s, t.unit); if (f) { f.u.kw = []; f.u.tempKw = []; f.u.gearOn = false; f.u.quiet = true; } }
      return;
    case "selfDmg": dealDamage(x, { champ: p }, e.n, c); return;
    case "tempMana": gainTempMana(x, p, e.n); return;
    case "loot": {
      const options = lootOptions(s, p, e.spell ?? false);
      if (options.length === 0) return;
      if (options.length === 1) { addToHand(x, p, options[0]!); return; }
      s.pending.push({ kind: "loot", p, options });
      return;
    }
    case "steal": {
      const enemy = s.players[other(p)];
      if (enemy.hand.length === 0) return;
      const at = rngInt(s, enemy.hand.length);
      const [card] = enemy.hand.splice(at, 1);
      if (card) addToHand(x, p, card);
      return;
    }
    case "returnSelf": if (c.selfCard) addToHand(x, p, c.selfCard); return;
    case "returnLastDied": { const id = s.players[p].lastDied; if (id) { addToHand(x, p, id); s.players[p].lastDied = null; } return; }
    case "discard": {
      if (c.target && "hand" in c.target) { const [gone] = s.players[p].hand.splice(c.target.hand, 1); if (gone) emit(x, "discard", { p, card: gone }); }
      return;
    }
    case "cooldown": s.players[p].cooldown += e.n; return;
    case "nextDiscount": s.players[p].nextDiscount += e.n; return;
    case "nextSpellFree": s.players[p].nextSpellFree = true; return;
    case "bothMend": mendTarget(x, { champ: 0 }, e.n); mendTarget(x, { champ: 1 }, e.n); return;
    case "splitDmg": for (let i = 0; i < e.n; i++) for (const t of resolveTo(x, "randomEnemyChar", c)) dealDamage(x, t, 1, c); return;
    case "hpPerDamaged": {
      const f = c.self !== undefined ? findUnit(s, c.self) : null;
      if (f) f.u.hp += s.players[p].board.filter(u => u.uid !== f.u.uid && u.dmg > 0).length;
      return;
    }
    case "atkPerGear": {
      const f = c.self !== undefined ? findUnit(s, c.self) : null;
      if (f) f.u.atk += s.players[p].board.filter(u => u.gear !== null).length;
      return;
    }
  }
}

function runEffects(x: X, effects: readonly Eff[], c: Ctx): void {
  for (const e of effects) {
    if (x.s.phase === "over") return;
    if (e.if && !cond(x, c.p, e.if)) continue;
    runEffect(x, e, c);
    settle(x);
  }
}

// ---- deaths, frenzy and the end of the match ----
function checkOver(x: X): void {
  const s = x.s;
  if (s.phase === "over") return;
  const dead0 = s.players[0].hp <= 0;
  const dead1 = s.players[1].hp <= 0;
  if (!dead0 && !dead1) return;
  s.phase = "over";
  s.winner = dead0 && dead1 ? "draw" : dead0 ? 1 : 0;
  s.reason = "health";
  emit(x, "over", { winner: s.winner });
}

function settle(x: X): void {
  if (x.settling) return;
  x.settling = true;
  try {
    const s = x.s;
    for (let guard = 0; guard < 300; guard++) {
      let did = false;
      while (x.frenzyQ.length) {
        const uid = x.frenzyQ.shift()!;
        const f = findUnit(s, uid);
        if (!f || f.u.frenzied || hpOf(s, f.p, f.u) <= 0) continue;
        f.u.frenzied = true;
        did = true;
        runEffects(x, textOf(f.u).frenzy ?? [], { p: f.p, self: f.u.uid, selfCard: f.u.card });
      }
      const dead: { u: UnitState; p: Side }[] = [];
      for (const p of [s.active, other(s.active)] as const) for (const u of s.players[p].board) if (u.doomed || hpOf(s, p, u) <= 0) dead.push({ u, p });
      if (dead.length) {
        did = true;
        const queue: { eff: Eff[]; ctx: Ctx }[] = [];
        for (const { u, p } of dead) {
          const pl = s.players[p];
          pl.board = pl.board.filter(b => b.uid !== u.uid);
          const card = unitCard(u);
          if (hasStandard(s, p, "perfectRun") && pl.perfectTurn !== s.turn) {
            pl.perfectTurn = s.turn;
            addToHand(x, p, u.card);
            emit(x, "saved", { p, unit: u.uid });
            continue;
          }
          emit(x, "death", { p, unit: u.uid, card: u.card });
          if (!card.token) pl.lastDied = u.card;
          if (u.gear && hasStandard(s, p, "gearReturn")) addToHand(x, p, u.gear);
          if (s.active === other(p) && hasStandard(s, other(p), "armorOnKill")) s.players[other(p)].armor += 1;
          const ctx: Ctx = { p, self: u.uid, selfCard: u.card };
          const lastStand = textOf(u).lastStand;
          if (lastStand) queue.push({ eff: lastStand, ctx });
          if (u.gear && u.gearOn) { const g = cardOf(u.gear).gear; if (g?.lastStand) queue.push({ eff: g.lastStand, ctx }); }
        }
        for (const q of queue) runEffects(x, q.eff, q.ctx);
      }
      if (!did) break;
    }
    checkOver(x);
  } finally {
    x.settling = false;
  }
}

// ---- turn flow ----
function startTurn(x: X): void {
  const s = x.s;
  const p = s.active;
  const pl = s.players[p];
  s.turn += 1;
  pl.turns += 1;
  pl.mana = Math.max(0, Math.min(pl.turns + R.manaBonus, R.manaCap) - pl.cooldown);
  pl.cooldown = 0;
  pl.powerUsed = false;
  pl.played = 0;
  pl.nextDiscount = 0;
  pl.nextSpellFree = false;
  pl.attacked = 0;
  for (const u of pl.board) u.attacks = 0;
  pl.partyDiscount = partyActive(s, p);
  emit(x, "turn", { p, turn: s.turn, mana: pl.mana });
  const skipDraw = pl.turns === 1 && p === s.first && !R.firstDraws;
  if (!skipDraw) {
    if (pl.deck.length === 0 || round(s) >= R.exhaustionRound) {
      pl.exhaustion += R.exhaustionStep;
      dealDamage(x, { champ: p }, pl.exhaustion, { p });
      emit(x, "exhaustion", { p, n: pl.exhaustion });
      settle(x);
    }
    if (pl.deck.length > 0 && s.phase !== "over") drawCards(x, p, 1);
  }
  if (s.phase === "over") return;
  if (!pl.secondWind && pl.hp <= R.secondWindHealth) {
    pl.secondWind = true;
    drawCards(x, p, 1);
    pl.armor += 2;
    emit(x, "secondWind", { p });
  }
  if (zoneFlag(s) === "burning") {
    const all = [...s.players[0].board.map(u => ({ u, p: 0 as Side })), ...s.players[1].board.map(u => ({ u, p: 1 as Side }))];
    if (all.length) {
      const low = Math.min(...all.map(e => hpOf(s, e.p, e.u)));
      const ties = all.filter(e => hpOf(s, e.p, e.u) === low);
      const pick = ties[rngInt(s, ties.length)]!;
      dealDamage(x, { unit: pick.u.uid }, 1, { p });
      settle(x);
    }
  }
  for (const u of [...pl.board]) { const card = textOf(u); if (card.startTurn && findUnit(s, u.uid)) runEffects(x, card.startTurn, { p, self: u.uid, selfCard: u.card }); }
  const std = standardOf(s, p);
  if (std?.startTurn) runEffects(x, std.startTurn, { p });
  settle(x);
}

function endTurn(x: X): void {
  const s = x.s;
  const p = s.active;
  const pl = s.players[p];
  for (const u of [...pl.board]) { const card = textOf(u); if (card.endTurn && findUnit(s, u.uid)) runEffects(x, card.endTurn, { p, self: u.uid, selfCard: u.card }); }
  if (zoneFlag(s) === "overgrown") for (const u of pl.board) mendTarget(x, { unit: u.uid }, 1);
  if (hasStandard(s, p, "survivor")) for (const u of pl.board) if (u.since < s.turn && !u.survivor) { u.survivor = true; u.hp += 1; }
  for (const side of [0, 1] as const) {
    for (const u of s.players[side].board) {
      u.tempAtk = 0;
      u.tempKw = [];
      if (u.zoneShieldUntil !== null && u.zoneShieldUntil <= s.turn) { u.kw = u.kw.filter(k => k !== "shield"); u.zoneShieldUntil = null; }
    }
  }
  for (const u of pl.board) u.chilled = false;
  pl.nextDiscount = 0;
  pl.nextSpellFree = false;
  emit(x, "endTurn", { p });
  settle(x);
  if (s.phase === "over") return;
  if (s.turn >= R.drawRound * 2) { endOnHealth(x, "round-cap", R.capRule === "health"); return; }
  s.active = other(p);
  startTurn(x);
}

/** Ends the match on Health lost (Armor counting as Health, fair when a PvE boss starts with more Health); equal is a draw. */
function endOnHealth(x: X, reason: string, byHealth = true): void {
  const s = x.s;
  const total = (q: PlayerState) => q.hp + q.armor - q.maxHp;
  const lead = total(s.players[0]) - total(s.players[1]);
  s.phase = "over";
  s.winner = byHealth && lead !== 0 ? (lead > 0 ? 0 : 1) : "draw";
  s.reason = reason;
  emit(x, "over", { winner: s.winner });
}

/** Missed turn clocks in a row that forfeit the match (design 2.9). */
export const MAX_TIMEOUTS = 3;

/** The turn clock ran out for whoever must act: the safe default is played for them (keep the opening hand, take the first
 *  Loot option, or end the turn). The third miss in a row forfeits. */
function doTimeout(x: X): void {
  const s = x.s;
  const p = actor(s);
  const pl = s.players[p];
  pl.timeouts = (pl.timeouts ?? 0) + 1;
  emit(x, "timeout", { p, n: pl.timeouts });
  if (pl.timeouts >= MAX_TIMEOUTS) { s.phase = "over"; s.winner = other(p); s.reason = "timeout"; emit(x, "over", { winner: s.winner }); return; }
  if (s.phase === "mulligan") doMulligan(x, { t: "mulligan", replace: [] });
  else if (s.pending.length) doChoose(x, { t: "choose", index: 0 });
  else endTurn(x);
}

// ---- legal actions ----
/** One entry per way to play a card: target, mode and (for Gambit) the discard. */
function playOptions(s: MatchState, p: Side, handIndex: number): { target?: Target; mode?: number }[] {
  const pl = s.players[p];
  const card = cardOf(pl.hand[handIndex]!);
  const handAfter = pl.hand.filter((_, i) => i !== handIndex);
  const out: { target?: Target; mode?: number }[] = [];
  if (card.type === "gear") { for (const t of targetsFor(s, p, "friendlyNoGear")) out.push({ target: t }); return out; }
  if (card.type === "zone" || card.type === "standard") return [{}];
  const abilities = card.onPlay ?? [{ effects: [] }];
  abilities.forEach((ability, mode) => {
    const modal = abilities.length > 1;
    if (!ability.target) { out.push(modal ? { mode } : {}); return; }
    const list = targetsFor(s, p, ability.target, undefined, handAfter);
    if (list.length === 0) {
      // A Rally with no target just fizzles; a spell needs a target (Gambit with an empty hand still draws).
      if (card.type === "unit" || ability.target === "handOther") out.push(modal ? { mode } : {});
      return;
    }
    for (const t of list) out.push(modal ? { target: t, mode } : { target: t });
  });
  return out;
}

function canPlay(s: MatchState, p: Side, handIndex: number): boolean {
  const pl = s.players[p];
  const id = pl.hand[handIndex];
  if (!id) return false;
  const card = cardOf(id);
  if (costOf(s, p, id) > pl.mana) return false;
  if (card.type === "unit" && pl.board.length >= boardLimit(s)) return false;
  if (card.type === "standard" && pl.standard !== null) return false;
  if (card.id === "129" && !pl.lastDied) return false;
  return true;
}

/** Whether a unit may attack now. */
export function canAttack(s: MatchState, p: Side, u: UnitState): boolean {
  if (u.chilled || u.doomed) return false;
  if (atkOf(s, p, u) <= 0) return false;
  const limit = hasKw(u, "twin") ? 2 : 1;
  if (u.attacks >= limit) return false;
  if (u.since === s.turn && !hasKw(u, "swift")) return false;
  return true;
}

/** Enemy units an attack may pick: Guard units first, Shadow units never. */
export function attackTargets(s: MatchState, p: Side): Target[] {
  const enemy = s.players[other(p)].board.filter(u => !hasKw(u, "shadow"));
  const guards = enemy.filter(u => hasKw(u, "guard"));
  if (guards.length) return guards.map(u => ({ unit: u.uid }));
  return [...enemy.map(u => ({ unit: u.uid }) as Target), { champ: other(p) }];
}

function powerOptions(s: MatchState, p: Side): { target?: Target }[] {
  const pl = s.players[p];
  const power = POWERS[pl.cls];
  if (pl.powerUsed || powerCost(s, p) > pl.mana) return [];
  if (power.effects.some(e => e.k === "summon") && pl.board.length >= boardLimit(s)) return [];
  if (!power.target) return [{}];
  return targetsFor(s, p, power.target).map(t => ({ target: t }));
}

export function legalActions(s: MatchState): Action[] {
  if (s.phase === "over") return [];
  if (s.phase === "mulligan") {
    const p = s.mulligan[s.first] ? other(s.first) : s.first;
    const slots = s.players[p].hand.map((id, i) => (cardOf(id).bag ? -1 : i)).filter(i => i >= 0);
    const out: Action[] = [];
    for (let mask = 0; mask < 1 << slots.length; mask++) out.push({ t: "mulligan", replace: slots.filter((_, k) => mask & (1 << k)) });
    return out;
  }
  if (s.pending.length) {
    const head = s.pending[0]!;
    return head.options.map((_, index) => ({ t: "choose", index }) as Action);
  }
  const p = s.active;
  const pl = s.players[p];
  const out: Action[] = [];
  pl.hand.forEach((_, i) => {
    if (!canPlay(s, p, i)) return;
    for (const o of playOptions(s, p, i)) out.push({ t: "play", hand: i, ...(o.target ? { target: o.target } : {}), ...(o.mode !== undefined ? { mode: o.mode } : {}) });
  });
  for (const u of pl.board) if (canAttack(s, p, u)) for (const t of attackTargets(s, p)) out.push({ t: "attack", unit: u.uid, target: t });
  for (const o of powerOptions(s, p)) out.push({ t: "power", ...(o.target ? { target: o.target } : {}) });
  out.push({ t: "end" });
  return out;
}

/** The player who must act now (the mulligan decider, the chooser of a Loot, or the active player). */
export function actor(s: MatchState): Side {
  if (s.phase === "mulligan") return s.mulligan[s.first] ? other(s.first) : s.first;
  if (s.pending.length) return s.pending[0]!.p;
  return s.active;
}

// ---- stable stringify and hash ----
export function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const rec = value as Record<string, unknown>;
  return `{${Object.keys(rec).sort().filter(k => rec[k] !== undefined).map(k => `${JSON.stringify(k)}:${stable(rec[k])}`).join(",")}}`;
}
export const actionKey = (a: Action): string => stable(a);
export const stateHash = (s: MatchState): string => createHash("sha256").update(stable(s)).digest("hex").slice(0, 32);

// ---- applying actions ----
function beginTurnsAfterMulligan(x: X): void {
  const s = x.s;
  s.phase = "main";
  s.active = s.first;
  s.turn = 0;
  startTurn(x);
}

function doMulligan(x: X, a: Extract<Action, { t: "mulligan" }>): void {
  const s = x.s;
  const p = s.mulligan[s.first] ? other(s.first) : s.first;
  const pl = s.players[p];
  const n = a.replace.length;
  const kept = pl.hand.filter((_, i) => !a.replace.includes(i));
  const out = pl.hand.filter((_, i) => a.replace.includes(i));
  pl.hand = kept;
  for (let i = 0; i < n; i++) { const c = drawRaw(s, p); if (c) pl.hand.push(c); }
  pl.deck.push(...out);
  shuffle(s, pl.deck);
  smooth(s, p);
  s.mulligan[p] = true;
  emit(x, "mulligan", { p, n });
  if (s.mulligan[0] && s.mulligan[1]) beginTurnsAfterMulligan(x);
}

function payAndPlay(x: X, a: Extract<Action, { t: "play" }>): void {
  const s = x.s;
  const p = s.active;
  const pl = s.players[p];
  const id = pl.hand[a.hand]!;
  const card = cardOf(id);
  const cost = costOf(s, p, id);
  pl.mana -= cost;
  if (card.type === "spell" && !card.bag && pl.nextSpellFree) pl.nextSpellFree = false;
  else if (!card.bag && pl.nextDiscount > 0) pl.nextDiscount = 0;
  pl.hand.splice(a.hand, 1);
  if (!card.bag) pl.played += 1;
  emit(x, "play", { p, card: id, cost });
  const abilities = card.onPlay ?? [];
  const ability: Ability | undefined = abilities[a.mode ?? 0];
  if (card.type === "unit") {
    const u = addUnit(x, p, id);
    if (!u) return;
    const times = zoneFlag(s) === "echoes" ? 2 : 1;
    const hasTarget = () => !!a.target && "unit" in a.target && findUnit(s, a.target.unit) !== null;
    for (let i = 0; i < times && ability; i++) {
      if (ability.needsTarget && !hasTarget()) break;
      runEffects(x, ability.effects, { p, self: u.uid, selfCard: id, ...(a.target ? { target: a.target } : {}), rally: true });
    }
    if (card.cooldown) pl.cooldown += card.cooldown;
  } else if (card.type === "spell") {
    if (ability) runEffects(x, ability.effects, { p, ...(a.target ? { target: a.target } : {}) });
    if (card.cooldown) pl.cooldown += card.cooldown;
    if (!card.bag) for (const u of [...pl.board]) { const g = u.gear && u.gearOn ? cardOf(u.gear).gear : undefined; if (g?.onSpell && findUnit(s, u.uid)) runEffects(x, g.onSpell, { p, self: u.uid }); }
  } else if (card.type === "gear") {
    const t = a.target;
    const f = t && "unit" in t ? findUnit(s, t.unit) : null;
    if (f && card.gear) {
      f.u.gear = id;
      f.u.gearOn = true;
      f.u.atk += card.gear.atk;
      f.u.hp += card.gear.hp;
      for (const k of card.gear.kw ?? []) if (!f.u.kw.includes(k)) f.u.kw.push(k);
    }
  } else if (card.type === "zone") {
    s.zone = { card: id, owner: p };
  } else if (card.type === "standard") {
    pl.standard = id;
  }
  settle(x);
}

function doAttack(x: X, a: Extract<Action, { t: "attack" }>): void {
  const s = x.s;
  const p = s.active;
  const f = findUnit(s, a.unit);
  if (!f) return;
  const attacker = f.u;
  attacker.kw = attacker.kw.filter(k => k !== "shadow");
  attacker.tempKw = attacker.tempKw.filter(k => k !== "shadow");
  attacker.attacks += 1;
  s.players[p].attacked += 1;
  const aAtk = atkOf(s, p, attacker);
  emit(x, "attack", { unit: attacker.uid, target: a.target });
  if ("champ" in a.target) {
    const dealt = dealDamage(x, a.target, aAtk, { p }, { p, u: attacker });
    if (hasKw(attacker, "drain") && dealt > 0) mendTarget(x, { champ: p }, dealt);
  } else if ("unit" in a.target) {
    const d = findUnit(s, a.target.unit);
    if (!d) return;
    const defender = d.u;
    const dAtk = atkOf(s, d.p, defender);
    const dealt1 = dealDamage(x, { unit: defender.uid }, aAtk, { p }, { p, u: attacker });
    const dealt2 = dealDamage(x, { unit: attacker.uid }, dAtk, { p: d.p }, { p: d.p, u: defender });
    if (dealt1 > 0 && hasKw(attacker, "venom")) defender.doomed = true;
    if (dealt2 > 0 && hasKw(defender, "venom")) attacker.doomed = true;
    if (dealt1 > 0 && hasKw(attacker, "drain")) mendTarget(x, { champ: p }, dealt1);
    if (dealt2 > 0 && hasKw(defender, "drain")) mendTarget(x, { champ: d.p }, dealt2);
    const g = defender.gear && defender.gearOn ? cardOf(defender.gear).gear : undefined;
    if (g?.thorns && findUnit(s, attacker.uid)) dealDamage(x, { unit: attacker.uid }, 1, { p: d.p });
  }
  settle(x);
}

function doPower(x: X, a: Extract<Action, { t: "power" }>): void {
  const s = x.s;
  const p = s.active;
  const pl = s.players[p];
  const power = POWERS[pl.cls];
  pl.mana -= powerCost(s, p);
  pl.powerUsed = true;
  emit(x, "power", { p, cls: pl.cls });
  runEffects(x, power.effects, { p, ...(a.target ? { target: a.target } : {}) });
  settle(x);
}

function doChoose(x: X, a: Extract<Action, { t: "choose" }>): void {
  const s = x.s;
  const head = s.pending.shift()!;
  const picked = head.options[a.index]!;
  const rest = head.options.filter((_, i) => i !== a.index);
  addToHand(x, head.p, picked);
  s.players[head.p].deck.push(...rest);
  shuffle(s, s.players[head.p].deck);
  emit(x, "loot", { p: head.p });
}

/** Applies an action in place without checking legality (the caller has validated it, or it came from legalActions). */
export function applyMut(s: MatchState, a: Action, ev: MatchEvent[] = []): MatchEvent[] {
  const x: X = { s, ev, settling: false, frenzyQ: [] };
  if (s.phase === "over") return ev;
  // A move the player made themselves ends a run of missed clocks.
  if (a.t === "mulligan" || a.t === "play" || a.t === "attack" || a.t === "power" || a.t === "choose" || a.t === "end") s.players[actor(s)].timeouts = 0;
  switch (a.t) {
    case "mulligan": doMulligan(x, a); break;
    case "play": payAndPlay(x, a); break;
    case "attack": doAttack(x, a); break;
    case "power": doPower(x, a); break;
    case "choose": doChoose(x, a); break;
    case "end": endTurn(x); break;
    case "concede":
      s.phase = "over"; s.winner = other(a.p); s.reason = "concede"; emit(x, "over", { winner: s.winner });
      break;
    case "timeout": doTimeout(x); break;
    case "timeUp": endOnHealth(x, "time"); break;
  }
  return ev;
}

export class IllegalAction extends Error {}

/** Validates against the legal actions, then applies to a copy. Concede is always allowed. */
export function apply(s: MatchState, a: Action): { state: MatchState; events: MatchEvent[] } {
  if (s.phase === "over") throw new IllegalAction("The match is over.");
  if (a.t !== "concede" && a.t !== "timeout" && a.t !== "timeUp") {
    const key = actionKey(a);
    if (!legalActions(s).some(l => actionKey(l) === key)) throw new IllegalAction(`Illegal action: ${key}`);
  }
  const next = cloneState(s);
  const events = applyMut(next, a);
  return { state: next, events };
}

/** Replays a recorded action list from the start; the result must match the stored final state hash. */
export function replay(seed: number, a: DeckList, b: DeckList, actions: readonly Action[], setup: MatchSetup = {}): MatchState {
  let s = createMatch(seed, a, b, setup);
  for (const action of actions) s = apply(s, action).state;
  return s;
}

export { targetsEqual };

/** Puts a unit on a side's board without paying for it (tests and the simulator). `ready` skips summoning sickness. */
export function spawn(s: MatchState, p: Side, cardId: string, ready = true): UnitState {
  const u = newUnit(s, cardId);
  if (ready) u.since = 0;
  s.players[p].board.push(u);
  return u;
}
