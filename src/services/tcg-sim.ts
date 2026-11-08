import { CARDS_SET1, DECK_SIZE, MAX_LEGENDARIES, budgetOf, deckProblem, pointsOf, starterDeck } from "./tcg-cards-set1.js";
import { chooseAction, type AiLevel } from "./tcg-ai.js";
import { CLASS_KEYS, type ClassKey, type DeckList, type MatchEvent, type MatchSetup } from "./tcg-engine-types.js";
import { actor, applyMut, createMatch, round } from "./tcg-engine.js";

// Self-play harness (docs/plans/APP_TCG_GAME.md section 7.5): plays the AI against itself to measure balance. The
// CI-sized run lives in tests/tcg-sim.test.ts; the full 20,000-games-per-pairing matrix is `npm run clash:selfplay`.

export interface GameResult {
  winner: 0 | 1 | "draw";
  first: 0 | 1;
  rounds: number;
  steps: number;
  reason: string | null;
  exhaustion: boolean;
  /** Distinct cards each seat played during the game. */
  played: [string[], string[]];
  stuck: boolean;
}

const MAX_STEPS = 4000;

export function playGame(seed: number, a: DeckList, b: DeckList, levels: [AiLevel, AiLevel] = ["normal", "normal"], setup: MatchSetup = {}): GameResult {
  const s = createMatch(seed, a, b, setup);
  const played: [Set<string>, Set<string>] = [new Set(), new Set()];
  let exhaustion = false;
  let steps = 0;
  while (s.phase !== "over" && steps < MAX_STEPS) {
    const action = chooseAction(s, levels[actor(s)]);
    const ev: MatchEvent[] = [];
    applyMut(s, action, ev);
    for (const e of ev) {
      const card = e["card"];
      if (e.t === "play" && typeof card === "string") played[e["p"] as 0 | 1].add(card);
      if (e.t === "exhaustion") exhaustion = true;
    }
    steps++;
  }
  return { winner: s.winner ?? "draw", first: s.first, rounds: round(s), steps, reason: s.reason, exhaustion, played: [[...played[0]], [...played[1]]], stuck: s.phase !== "over" };
}

// ---- deck building for the "tuned" decks of the matrix ----

const CURVE: Record<number, number> = { 1: 3, 2: 5, 3: 5, 4: 4, 5: 3, 6: 2, 7: 1, 8: 1 };

function noise(variant: number, id: string): number {
  let h = (variant + 1) * 2654435761;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

/** A deterministic, legal tuned deck for a class: the best cards by points over budget, filling a standard cost curve. Variant 0 is the plain ranking. */
export function buildDeck(cls: ClassKey, variant = 0): DeckList {
  const pool = CARDS_SET1.filter(c => (c.cls === cls || c.cls === "neutral") && c.type !== "standard")
    .map(c => ({ c, score: pointsOf(c) - budgetOf(c) + (c.type === "unit" ? 1.5 : 0) + (variant ? noise(variant, c.id) * 3 : 0) - (c.type === "zone" ? 3 : 0) }))
    .sort((x, y) => y.score - x.score || x.c.id.localeCompare(y.c.id));
  const deck: string[] = [];
  const count = (id: string) => deck.filter(x => x === id).length;
  let legendaries = 0;
  let zones = 0;
  const take = (id: string): boolean => {
    const card = pool.find(p => p.c.id === id)!.c;
    if (deck.length >= DECK_SIZE || count(id) >= (card.rarity === "legendary" ? 1 : 2)) return false;
    if (card.rarity === "legendary" && legendaries >= MAX_LEGENDARIES) return false;
    if (card.type === "zone" && zones >= 1) return false;
    if (card.rarity === "legendary") legendaries++;
    if (card.type === "zone") zones++;
    deck.push(id);
    return true;
  };
  for (const [cost, slots] of Object.entries(CURVE)) {
    let left = slots;
    for (const { c } of pool) { if (left === 0) break; if (c.cost === Number(cost) && take(c.id)) left--; }
  }
  for (const { c } of pool) { if (deck.length >= DECK_SIZE) break; take(c.id); }
  const list = deck.sort();
  const problem = deckProblem(cls, list);
  if (problem) throw new Error(`buildDeck(${cls}, ${variant}): ${problem}`);
  return { cls, cards: list };
}

/** The decks the matrix plays for a class: the free starter deck plus three tuned variants. */
export const matrixDecks = (cls: ClassKey): DeckList[] => [{ cls, cards: starterDeck(cls) }, buildDeck(cls, 0), buildDeck(cls, 1), buildDeck(cls, 2)];

// ---- the matrix ----

export interface MatrixOptions { gamesPerPair: number; levels?: [AiLevel, AiLevel]; seed?: number; classes?: readonly ClassKey[] }
export interface MatrixReport {
  games: number;
  draws: number;
  stuck: number;
  firstPlayerWins: number;
  medianRounds: number;
  exhaustionShare: number;
  byClass: Record<string, { games: number; wins: number; rate: number }>;
  pairs: { a: ClassKey; b: ClassKey; games: number; winsA: number; winsB: number }[];
  cards: Record<string, { played: number; wins: number; rate: number }>;
}

/** Plays every ordered pair of different classes `gamesPerPair` times, rotating through the decks of each class. */
export function runMatrix(opts: MatrixOptions): MatrixReport {
  const classes = opts.classes ?? CLASS_KEYS;
  const levels = opts.levels ?? ["normal", "normal"];
  const decks = new Map(classes.map(c => [c, matrixDecks(c)]));
  const byClass: MatrixReport["byClass"] = Object.fromEntries(classes.map(c => [c, { games: 0, wins: 0, rate: 0 }]));
  const cards: MatrixReport["cards"] = {};
  const pairs: MatrixReport["pairs"] = [];
  const rounds: number[] = [];
  let games = 0, draws = 0, stuck = 0, firstWins = 0, exhaustion = 0;
  let seed = opts.seed ?? 1;
  for (const a of classes) for (const b of classes) {
    if (a === b) continue;
    const pair = { a, b, games: 0, winsA: 0, winsB: 0 };
    for (let g = 0; g < opts.gamesPerPair; g++) {
      const da = decks.get(a)![g % 4]!;
      const db = decks.get(b)![Math.floor(g / 4) % 4]!;
      const r = playGame(seed++, da, db, levels);
      games++; pair.games++;
      byClass[a]!.games++; byClass[b]!.games++;
      rounds.push(r.rounds);
      if (r.exhaustion) exhaustion++;
      if (r.stuck) stuck++;
      if (r.winner === "draw") { draws++; continue; }
      if (r.winner === r.first) firstWins++;
      if (r.winner === 0) { pair.winsA++; byClass[a]!.wins++; } else { pair.winsB++; byClass[b]!.wins++; }
      for (const seat of [0, 1] as const) for (const id of r.played[seat]) {
        const row = (cards[id] ??= { played: 0, wins: 0, rate: 0 });
        row.played++;
        if (r.winner === seat) row.wins++;
      }
    }
    pairs.push(pair);
  }
  rounds.sort((x, y) => x - y);
  for (const row of Object.values(byClass)) row.rate = row.games ? row.wins / row.games : 0;
  for (const row of Object.values(cards)) row.rate = row.played ? row.wins / row.played : 0;
  return { games, draws, stuck, firstPlayerWins: firstWins, medianRounds: rounds[Math.floor(rounds.length / 2)] ?? 0, exhaustionShare: games ? exhaustion / games : 0, byClass, pairs, cards };
}

/** The design's balance targets (section 7.5) that a report misses; empty when all are met. Card rates need a few hundred plays to mean anything. */
export function missedTargets(r: MatrixReport, minCardPlays = 200): string[] {
  const out: string[] = [];
  for (const [cls, row] of Object.entries(r.byClass)) if (row.games && (row.rate < 0.45 || row.rate > 0.55)) out.push(`${cls} wins ${(row.rate * 100).toFixed(1)}% (target 45 to 55)`);
  const decided = r.games - r.draws;
  const first = decided ? r.firstPlayerWins / decided : 0.5;
  if (first < 0.48 || first > 0.52) out.push(`first player wins ${(first * 100).toFixed(1)}% (target 48 to 52)`);
  if (r.medianRounds < 6 || r.medianRounds > 9) out.push(`median match is ${r.medianRounds} rounds (target 6 to 9)`);
  if (r.exhaustionShare >= 0.02) out.push(`${(r.exhaustionShare * 100).toFixed(1)}% of games reach Exhaustion (target under 2)`);
  for (const [id, row] of Object.entries(r.cards)) if (row.played >= minCardPlays && row.rate > 0.6) out.push(`card ${id} wins ${(row.rate * 100).toFixed(1)}% when played (target at most 60)`);
  return out;
}
