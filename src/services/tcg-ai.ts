import { cardOf } from "./tcg-cards-set1.js";
import type { Action, MatchState, UnitState } from "./tcg-engine-types.js";
import { actor, applyMut, atkOf, cloneState, hpOf, legalActions } from "./tcg-engine.js";

// Guilded Clash AI opponent (docs/plans/APP_TCG_GAME.md section 4.1): a greedy one-ply search. For every legal action it
// plays the action on a copy of the state and scores the result with a hand-written evaluation; it takes the best action
// while that beats standing still, then ends the turn. No lookahead beyond the action itself, no hidden information (the
// copy's random numbers are reseeded so the AI cannot peek at what a shuffle or a random effect will do), and a pure
// function of the state: the same state always gives the same action, which keeps AI matches replayable.

export type AiLevel = "easy" | "normal" | "hard";
type Side = 0 | 1;
const other = (p: Side): Side => (p === 0 ? 1 : 0);

const WIN = 100_000;

function mix(a: number, b: number): number {
  let t = (a ^ Math.imul(b + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function unitValue(s: MatchState, p: Side, u: UnitState): number {
  const atk = atkOf(s, p, u);
  const hp = Math.max(0, hpOf(s, p, u));
  let v = atk + hp * 0.9;
  const has = (k: string) => u.kw.includes(k as never) || u.tempKw.includes(k as never);
  if (has("guard")) v += 1.5;
  if (has("shield")) v += 2;
  if (has("shadow")) v += 1;
  if (has("venom")) v += 2.5;
  if (has("drain")) v += 1.2;
  if (has("twin")) v += atk * 0.8;
  if (has("swift")) v += 0.5;
  if (u.chilled && s.active !== p) v -= atk * 0.4;
  const card = cardOf(u.card);
  if (card.endTurn || card.startTurn) v += 1.5;
  if (card.aura) v += 1.5;
  if (card.lastStand) v += 1;
  return v;
}

const handValue = (ids: readonly string[]): number => ids.reduce((sum, id) => { const c = cardOf(id); return sum + (c.bag ? 0.5 : 0.6 * (2 * c.cost + 1) + 0.4); }, 0);

/** Scores a state for one player: higher is better for `me`. Hard also fears the opponent's next attack. */
export function evaluate(s: MatchState, me: Side, level: AiLevel = "normal"): number {
  if (s.phase === "over") return s.winner === me ? WIN : s.winner === "draw" ? 0 : -WIN;
  const you = s.players[me];
  const them = s.players[other(me)];
  const shield = (pl: typeof you) => pl.hp + pl.armor * 0.8;
  let score = (shield(you) - shield(them)) * 1.6;
  if (you.hp <= 8) score -= (9 - you.hp) * 1.5;
  if (them.hp <= 8) score += (9 - them.hp) * 1.5;
  for (const u of you.board) score += unitValue(s, me, u);
  for (const u of them.board) score -= unitValue(s, other(me), u) * 1.05;
  score += handValue(you.hand) - them.hand.length * 2.4;
  if (level === "hard") {
    const guards = you.board.some(u => u.kw.includes("guard") && !u.kw.includes("shadow"));
    const threat = them.board.reduce((sum, u) => sum + atkOf(s, other(me), u), 0) * (guards ? 0.5 : 1) + 2;
    const room = you.hp + you.armor;
    if (s.active === me && threat >= room) score -= 40 + (threat - room) * 3;
    else if (threat >= room * 0.8) score -= (threat - room * 0.8) * 1.5;
  }
  return score;
}

function mulliganAction(s: MatchState, legal: Action[]): Action {
  const p = actor(s);
  const hand = s.players[p].hand;
  const wanted = hand.map((id, i) => ({ id, i })).filter(({ id }) => !cardOf(id).bag && cardOf(id).cost >= 5).map(x => x.i);
  const key = JSON.stringify(wanted);
  return legal.find(a => a.t === "mulligan" && JSON.stringify(a.replace) === key) ?? legal.find(a => a.t === "mulligan" && a.replace.length === 0) ?? legal[0]!;
}

function chooseLoot(s: MatchState, legal: Action[]): Action {
  const head = s.pending[0]!;
  let best = 0;
  let bestScore = -1;
  head.options.forEach((id, i) => {
    const c = cardOf(id);
    const score = c.cost * 2 + (c.rarity === "legendary" ? 4 : c.rarity === "epic" ? 3 : c.rarity === "rare" ? 2 : 0) + (c.type === "unit" ? 1 : 0);
    if (score > bestScore) { bestScore = score; best = i; }
  });
  return legal.find(a => a.t === "choose" && a.index === best) ?? legal[0]!;
}

/** The action this level would take now. A pure function of the state. */
export function chooseAction(s: MatchState, level: AiLevel = "normal"): Action {
  const legal = legalActions(s);
  if (legal.length === 0) throw new Error("No legal actions.");
  if (s.phase === "mulligan") return mulliganAction(s, legal);
  if (s.pending.length) return chooseLoot(s, legal);
  const me = s.active;
  const end = legal.find(a => a.t === "end")!;
  const candidates = legal.filter(a => a.t !== "end");
  if (candidates.length === 0) return end;
  // The Loot Bag only adds mana, which the evaluation cannot see, so it is always played first.
  const bag = candidates.find(a => a.t === "play" && s.players[me].hand[a.hand] === "loot-bag");
  if (bag) return bag;
  // Easy sometimes just stops.
  if (level === "easy" && mix(s.rng, s.turn * 977 + s.players[me].played) < 0.12) return end;
  const base = evaluate(s, me, level);
  let best: Action = end;
  let bestScore = base + 0.01;
  candidates.forEach((a, i) => {
    const c = cloneState(s);
    c.rng = (c.rng ^ 0x9e3779b9) >>> 0;
    applyMut(c, a);
    let score = evaluate(c, me, level);
    if (level === "easy") score += (mix(s.rng + i, s.turn) - 0.5) * 8;
    if (score > bestScore) { bestScore = score; best = a; }
  });
  return best;
}
