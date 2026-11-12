import { writeFileSync } from "node:fs";
import { starterDeck } from "../src/services/tcg-cards-set1.js";
import { chooseAction, type AiLevel } from "../src/services/tcg-ai.js";
import { CLASS_KEYS, type Action, type ClassKey, type DeckList, type MatchSetup, type MatchState } from "../src/services/tcg-engine-types.js";
import { actor, applyMut, createMatch, currentRules, POWERS, round, withRules, type Rules } from "../src/services/tcg-engine.js";
import { GAUNTLET } from "../src/services/tcg-pve.js";
import { buildDeck } from "../src/services/tcg-sim.js";
import { cardOf } from "../src/services/tcg-cards-set1.js";

// Guilded Clash balance and match-length simulator (docs/plans/CLASH_BALANCE_REVIEW_2026-11-10.md).
// Plays the real engine with the real AI on both seats and estimates how long each match would take a person on the phone.
//
//   npx tsx scripts/clash-sim.ts --games 20 --seed 1 [--rules '{"startHealth":18}'] [--pve 6] [--hard 4] [--json out.json]
//
// --games is per ordered class pair (72 pairs; decks rotate through the starter deck and three tuned decks).
// --pve is games per (class, deck kind, boss); --hard is games per pair with both seats on "hard".
// --rules overrides the match-length rules (see Rules in src/services/tcg-engine.ts) for a what-if run.

const arg = (name: string, fallback: string): string => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] ?? fallback : fallback; };

// ---- the time model (seconds) ----
// A member on a phone: every move is one or two taps plus a server round trip (Cloudflare Worker to the bot), and every turn
// starts with reading what changed. The live turn clock (60 s, the design's 90 s first turn) caps one turn.
export const TIME = {
  roundTrip: 0.7,
  turnRead: 4,
  perCardInHand: 0.4,
  play: 3.5,
  playTarget: 5.5,
  modal: 2,
  attack: 3.5,
  power: 3,
  powerTarget: 4.5,
  choose: 5,
  end: 1.5,
  mulligan: 8,
  /** What the member spends looking at an AI turn's result, per AI move (the app shows the result, no animation). */
  aiMoveRead: 1.2,
  turnLimit: 60,
  firstTurnLimit: 90
};

function humanSeconds(a: Action, s: MatchState): number {
  switch (a.t) {
    case "mulligan": return TIME.mulligan;
    case "choose": return TIME.choose + TIME.roundTrip;
    case "end": return TIME.end + TIME.roundTrip;
    case "attack": return TIME.attack + TIME.roundTrip;
    case "power": return (a.target ? TIME.powerTarget : TIME.power) + TIME.roundTrip;
    case "play": {
      const id = s.players[s.active].hand[a.hand]!;
      if (id === "loot-bag") return TIME.play * 0.5 + TIME.roundTrip;
      return (a.target ? TIME.playTarget : TIME.play) + (a.mode !== undefined ? TIME.modal : 0) + TIME.roundTrip;
    }
    default: return 0;
  }
}

export interface Game {
  winner: 0 | 1 | "draw";
  first: 0 | 1;
  rounds: number;
  turns: number;
  reason: string | null;
  exhaustion: boolean;
  actions: number;
  /** Estimated seconds: two people live, and one person against the server AI (the AI is seat 1). */
  pvpSeconds: number;
  aiSeconds: number;
  aiCompute: number;
  /** Turns that would have hit the live turn clock. */
  clockHits: number;
  played: [Set<string>, Set<string>];
  deck: [string[], string[]];
  hp: [number, number];
}

export function play(seed: number, a: DeckList, b: DeckList, levels: [AiLevel, AiLevel], setup: MatchSetup = {}): Game {
  const s = createMatch(seed, a, b, setup);
  const played: [Set<string>, Set<string>] = [new Set(), new Set()];
  let exhaustion = false, actions = 0, pvp = 0, vsAi = 0, aiCompute = 0, clockHits = 0;
  // per-turn accumulators for each seat (human pace)
  let turnHuman = 0, turnAi = 0, turnOwner: 0 | 1 = s.first, turnIndex = 0, aiMoves = 0;
  const closeTurn = () => {
    const limit = turnIndex <= 2 ? TIME.firstTurnLimit : TIME.turnLimit;
    if (turnHuman > limit) clockHits++;
    const human = Math.min(turnHuman, limit);
    pvp += human;
    vsAi += turnOwner === 0 ? human : turnAi + aiMoves * TIME.aiMoveRead + TIME.roundTrip;
    turnHuman = 0; turnAi = 0; aiMoves = 0;
  };
  let lastTurn = -1;
  while (s.phase !== "over" && actions < 4000) {
    if (s.phase === "main" && s.turn !== lastTurn) {
      if (lastTurn >= 0) closeTurn();
      lastTurn = s.turn; turnOwner = s.active; turnIndex++;
      turnHuman = TIME.turnRead + TIME.perCardInHand * s.players[s.active].hand.length;
    }
    const who = actor(s);
    const t0 = performance.now();
    const action = chooseAction(s, levels[who]);
    const dt = (performance.now() - t0) / 1000;
    if (who === 1) { aiCompute += dt; turnAi += dt; if (action.t !== "end" && action.t !== "mulligan") aiMoves++; }
    const sec = humanSeconds(action, s);
    if (s.phase === "mulligan") { pvp += sec; vsAi += who === 0 ? sec : 0; }
    else turnHuman += sec;
    if (action.t === "play") { const id = s.players[s.active].hand[action.hand]!; if (id !== "loot-bag") played[s.active].add(id); }
    const ev = applyMut(s, action);
    if (ev.some(e => e.t === "exhaustion")) exhaustion = true;
    actions++;
  }
  closeTurn();
  return {
    winner: s.winner ?? "draw", first: s.first, rounds: round(s), turns: s.turn, reason: s.reason, exhaustion, actions,
    pvpSeconds: pvp, aiSeconds: vsAi, aiCompute, clockHits, played, deck: [a.cards, b.cards], hp: [s.players[0].hp, s.players[1].hp]
  };
}

// ---- runs ----
const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : "-");
const q = (list: number[], p: number) => { const v = [...list].sort((x, y) => x - y); return v.length ? v[Math.min(v.length - 1, Math.floor(p * v.length))]! : 0; };
const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

const deckKinds = (cls: ClassKey): { kind: string; deck: DeckList }[] => [
  { kind: "starter", deck: { cls, cards: starterDeck(cls) } },
  { kind: "tuned0", deck: buildDeck(cls, 0) },
  { kind: "tuned1", deck: buildDeck(cls, 1) },
  { kind: "tuned2", deck: buildDeck(cls, 2) }
];

export interface Summary {
  label: string;
  rules: Rules;
  games: number;
  rounds: { median: number; p90: number; p95: number; max: number };
  pvp: { median: number; p90: number; p95: number; max: number; over5: number };
  ai: { median: number; p90: number; p95: number; max: number; over5: number };
  firstWins: number;
  draws: number;
  roundCap: number;
  exhaustion: number;
  clockHitGames: number;
  aiComputeMedian: number;
}
function summarise(label: string, games: Game[]): Summary {
  const decided = games.filter(g => g.winner !== "draw");
  const stat = (f: (g: Game) => number) => { const v = games.map(f); return { median: q(v, 0.5), p90: q(v, 0.9), p95: q(v, 0.95), max: Math.max(...v) }; };
  return {
    label, rules: { ...currentRules() }, games: games.length,
    rounds: stat(g => g.rounds),
    pvp: { ...stat(g => g.pvpSeconds), over5: games.filter(g => g.pvpSeconds > 300).length / games.length },
    ai: { ...stat(g => g.aiSeconds), over5: games.filter(g => g.aiSeconds > 300).length / games.length },
    firstWins: decided.filter(g => g.winner === g.first).length / Math.max(1, decided.length),
    draws: games.filter(g => g.winner === "draw").length / games.length,
    roundCap: games.filter(g => g.reason === "round-cap").length / games.length,
    exhaustion: games.filter(g => g.exhaustion).length / games.length,
    clockHitGames: games.filter(g => g.clockHits > 0).length / games.length,
    aiComputeMedian: q(games.map(g => g.aiCompute), 0.5)
  };
}

/** What-if card and power numbers for one run: --patch '{"powers":{"paladin":{"cost":2}},"cards":{"121":{"n":5}}}'. A card patch
 *  sets fields on the card, and "n" sets the number of its first numbered effect. Changes this process only. */
function applyPatch(raw: string): void {
  const patch = JSON.parse(raw) as { powers?: Record<string, { cost?: number; n?: number }>; cards?: Record<string, Record<string, unknown>> };
  for (const [cls, p] of Object.entries(patch.powers ?? {})) {
    const power = POWERS[cls as ClassKey];
    if (p.cost !== undefined) power.cost = p.cost;
    if (p.n !== undefined) { const e = power.effects[0] as { n?: number }; e.n = p.n; }
  }
  for (const [id, fields] of Object.entries(patch.cards ?? {})) {
    const card = cardOf(id) as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(fields)) {
      if (k === "n") { const e = (cardOf(id).onPlay ?? [])[0]?.effects.find(x => "n" in x) as { n?: number } | undefined; if (e) e.n = v as number; }
      else card[k] = v;
    }
  }
}

function main(): void {
  applyPatch(arg("patch", "{}"));
  const gamesPerPair = Number(arg("games", "20"));
  const pveGames = Number(arg("pve", "4"));
  const hardGames = Number(arg("hard", "0"));
  let seed = Number(arg("seed", "1"));
  const over = JSON.parse(arg("rules", "{}")) as Partial<Rules>;
  const label = arg("label", Object.keys(over).length ? JSON.stringify(over) : "current rules");
  const jsonOut = arg("json", "");
  const started = Date.now();
  withRules(over, () => {
    const matrix: Game[] = [];
    const byClass: Record<string, { games: number; wins: number }> = {};
    const byKind: Record<string, { games: number; wins: number }> = {};
    const pair: Record<string, { games: number; wins: number }> = {};
    const card: Record<string, { inDeck: number; played: number; playedWins: number }> = {};
    const decks = new Map(CLASS_KEYS.map(c => [c, deckKinds(c)]));
    const record = (g: Game, seats: [{ cls: string; kind: string }, { cls: string; kind: string }]) => {
      for (const seat of [0, 1] as const) {
        const me = seats[seat];
        const won = g.winner === seat ? 1 : 0;
        (byClass[me.cls] ??= { games: 0, wins: 0 }).games++; byClass[me.cls]!.wins += won;
        (byKind[me.kind] ??= { games: 0, wins: 0 }).games++; byKind[me.kind]!.wins += won;
        for (const id of new Set(g.deck[seat])) {
          const row = (card[id] ??= { inDeck: 0, played: 0, playedWins: 0 });
          row.inDeck++;
          if (g.played[seat].has(id)) { row.played++; row.playedWins += won; }
        }
      }
    };
    const focus = arg("focus", "");
    for (const a of CLASS_KEYS) for (const b of CLASS_KEYS) {
      if (a === b || (focus && a !== focus && b !== focus)) continue;
      for (let i = 0; i < gamesPerPair; i++) {
        const da = decks.get(a)![i % 4]!, db = decks.get(b)![Math.floor(i / 4) % 4]!;
        const g = play(seed++, da.deck, db.deck, ["normal", "normal"]);
        matrix.push(g);
        record(g, [{ cls: a, kind: da.kind }, { cls: b, kind: db.kind }]);
        const key = `${a}>${b}`;
        (pair[key] ??= { games: 0, wins: 0 }).games++; if (g.winner === 0) pair[key]!.wins++;
      }
    }
    const hard: Game[] = [];
    if (hardGames) for (const a of CLASS_KEYS) for (const b of CLASS_KEYS) {
      if (a === b) continue;
      for (let i = 0; i < hardGames; i++) hard.push(play(seed++, decks.get(a)![1 + (i % 3)]!.deck, decks.get(b)![1 + ((i + 1) % 3)]!.deck, ["hard", "hard"]));
    }
    const pve: Record<string, Game[]> = {};
    for (const boss of GAUNTLET) for (const cls of CLASS_KEYS) for (const kind of [0, 1]) for (let i = 0; i < pveGames; i++) {
      const mine = decks.get(cls)![kind]!.deck;
      const g = play(seed++, mine, { cls: boss.cls, cards: [...boss.deck] }, ["normal", boss.level], { zone: { card: boss.zone, owner: 1 }, hp: [currentRules().startHealth, boss.health] });
      (pve[boss.id] ??= []).push(g);
    }

    const sm = summarise("class matrix (normal vs normal)", matrix);
    const out = { label, rules: currentRules(), time: TIME, matrix: sm, hard: hard.length ? summarise("hard vs hard", hard) : null,
      pve: Object.fromEntries(Object.entries(pve).map(([id, list]) => [id, { ...summarise(id, list), playerWins: list.filter(g => g.winner === 0).length / list.length }])),
      byClass: Object.fromEntries(Object.entries(byClass).map(([k, v]) => [k, v.wins / v.games])),
      byKind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, v.wins / v.games])),
      pairs: Object.fromEntries(Object.entries(pair).map(([k, v]) => [k, v.wins / v.games])),
      cards: Object.fromEntries(Object.entries(card).map(([id, v]) => [id, { name: cardOf(id).name, inDeck: v.inDeck, playRate: v.played / v.inDeck, winWhenPlayed: v.played ? v.playedWins / v.played : null }])),
      seconds: (Date.now() - started) / 1000 };
    if (jsonOut) writeFileSync(jsonOut, JSON.stringify(out, null, 1));
    const line = (x: Summary) => `${x.games} games | rounds med ${x.rounds.median} p95 ${x.rounds.p95} max ${x.rounds.max} | live PvP med ${mmss(x.pvp.median)} p90 ${mmss(x.pvp.p90)} p95 ${mmss(x.pvp.p95)} max ${mmss(x.pvp.max)} >5min ${pct(x.pvp.over5, 1)} | vs AI med ${mmss(x.ai.median)} p95 ${mmss(x.ai.p95)} >5min ${pct(x.ai.over5, 1)} | first ${pct(x.firstWins, 1)} draws ${pct(x.draws, 1)} cap ${pct(x.roundCap, 1)} exhaustion ${pct(x.exhaustion, 1)} clock ${pct(x.clockHitGames, 1)}`;
    console.log(`== ${label} (${out.seconds.toFixed(0)} s)`);
    console.log(`matrix: ${line(sm)}`);
    if (out.hard) console.log(`hard:   ${line(out.hard)}`);
    for (const [id, x] of Object.entries(out.pve)) console.log(`${id}: player wins ${pct(x.playerWins, 1)} | ${line(x)}`);
    console.log("classes:", Object.entries(out.byClass).map(([k, v]) => `${k} ${pct(v, 1)}`).join(", "));
    console.log("decks:", Object.entries(out.byKind).map(([k, v]) => `${k} ${pct(v, 1)}`).join(", "));
  });
}

main();
