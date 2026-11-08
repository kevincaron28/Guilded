import type { ClashApi } from "./api";
import { ClashError } from "./api";
import { SET1 } from "./set1";
import { cardOf } from "./state";
import type {
  ClassKey, Collection, CollectionCard, Intent, MatchEvent, MatchInfo, MatchResponse, OpenedPack, PlayerView, PveProgress, Rarity, StartInput, Target, UnitView
} from "./types";
import { CLASS_KEYS } from "./types";

// The sample Clash: made-up collection, gauntlet and a tiny local game, so the screens work in the sample guild and
// before the match API (#638) is live. It is NOT the rules engine: units fight, spells that say "damage" hit, and the
// foe plays its cheapest unit and attacks. Real matches always run on the server.

const CLASS_NAMES: Record<ClassKey, string> = { warrior: "Warrior", paladin: "Paladin", hunter: "Hunter", rogue: "Rogue", priest: "Priest", shaman: "Shaman", mage: "Mage", warlock: "Warlock", druid: "Druid" };
const RARITY_LABEL: Record<Rarity, string> = { common: "Common", uncommon: "Uncommon", rare: "Rare", epic: "Epic", legendary: "Legendary" };
const CRAFT: Partial<Record<Rarity, number>> = { common: 30, uncommon: 60, rare: 150 };
const BADGES: [string, Rarity][] = [["Dungeon Regular", "common"], ["Dungeon Veteran", "uncommon"], ["Raid Regular", "rare"], ["Duelist", "uncommon"], ["Guild Pillar", "epic"], ["Hall of Fame", "legendary"]];

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Seeded generator (mulberry32) so the sample behaves the same on every phone. */
function rng(seed: number) {
  let a = seed >>> 0;
  return (max: number) => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * max); };
}

function sampleCollection(): Collection {
  const classCards: CollectionCard[] = CLASS_KEYS.flatMap((cls, i) => (["common", "rare", "epic"] as Rarity[]).map((rarity, j): CollectionCard => {
    const owned = rarity === "common" || (rarity === "rare" && i % 2 === 0) || (rarity === "epic" && i === 6);
    return { key: `class:${cls}:${rarity}`, family: "class", rarity, rarityLabel: RARITY_LABEL[rarity], set: "classes", name: CLASS_NAMES[cls], flavour: null,
      owned, count: owned ? 1 + ((i + j) % 2) : 0, firstSeenAt: owned ? "2026-11-07T12:00:00.000Z" : null, craftCost: owned ? null : CRAFT[rarity] ?? null, artUrl: null };
  }));
  const badges = BADGES.map(([name, rarity], i): CollectionCard => ({
    key: `badge:sample-${i}`, family: "badge", rarity, rarityLabel: RARITY_LABEL[rarity], set: "badges", name, flavour: "Earned from a real Guilded achievement.",
    owned: i < 2, count: i < 2 ? 1 : 0, firstSeenAt: i < 2 ? "2026-11-06T12:00:00.000Z" : null, craftCost: null, artUrl: null
  }));
  const cards = [...classCards, ...badges];
  return { cards, owned: cards.filter((c) => c.owned).length, total: cards.length, dust: 240, packs: { ready: 2, max: 3, nextAt: new Date(Date.now() + 7 * 3600_000).toISOString() },
    pity: { epicIn: 6, legendaryIn: 31 }, odds: { ordinarySlots: { common: 78, uncommon: 22 }, rarePlusSlot: { rare: 80, epic: 16, legendary: 4 }, packSize: 5, epicPity: 10, legendaryPity: 40 } };
}

const GAUNTLET: { id: string; name: string; flavour: string; cls: ClassKey; level: "easy" | "normal" | "hard"; health: number; reward: { dust: number; packs: number } }[] = [
  { id: "boss-1", name: "The Emberdeep Brute", flavour: "He found the chasm warm and decided to stay.", cls: "warrior", level: "easy", health: 20, reward: { dust: 20, packs: 0 } },
  { id: "boss-2", name: "Matron of Briar Hollow", flavour: "Gentle as thorns, and just as patient.", cls: "druid", level: "normal", health: 22, reward: { dust: 30, packs: 0 } },
  { id: "boss-3", name: "The Echo Seer", flavour: "Say it once. She will say it twice.", cls: "mage", level: "normal", health: 24, reward: { dust: 40, packs: 0 } },
  { id: "boss-4", name: "Warlord of the Ashfall", flavour: "You cannot see him. You can only smell him.", cls: "warlock", level: "hard", health: 26, reward: { dust: 60, packs: 1 } },
  { id: "boss-5", name: "Warden of the Cairn", flavour: "The kings are watching. So is she.", cls: "paladin", level: "hard", health: 30, reward: { dust: 80, packs: 2 } }
];

// ---- the tiny local game ----

interface Side { cls: ClassKey; hp: number; maxHp: number; armor: number; deck: string[]; hand: string[]; board: UnitView[]; mana: number; turns: number; powerUsed: boolean }
interface Game { id: string; info: MatchInfo; me: Side; foe: Side; turn: number; active: 0 | 1; phase: PlayerView["phase"]; winner: PlayerView["winner"]; nextUid: number; roll: (max: number) => number; zone: string | null }

function deckFor(cls: ClassKey, roll: (max: number) => number): string[] {
  const pool = SET1.filter((c) => !c.token && (c.cls === cls || c.cls === "neutral") && (c.type === "unit" || (c.type === "spell" && /damage/i.test(c.text))) && c.cost <= 6);
  const deck = pool.slice(0, 24);
  for (let i = deck.length - 1; i > 0; i--) { const j = roll(i + 1); [deck[i], deck[j]] = [deck[j]!, deck[i]!]; }
  return deck.map((c) => c.id);
}
const side = (cls: ClassKey, hp: number, deck: string[], draw: number): Side => ({ cls, hp, maxHp: hp, armor: 0, deck: deck.slice(draw), hand: deck.slice(0, draw), board: [], mana: 0, turns: 0, powerUsed: false });
const hasKw = (u: UnitView, kw: UnitView["kw"][number]) => u.kw.includes(kw) || u.tempKw.includes(kw);
const ready = (u: UnitView, turn: number) => !u.chilled && u.attacks < (hasKw(u, "twin") ? 2 : 1) && (u.since < turn || hasKw(u, "swift")) && u.atk > 0;

function legalFor(g: Game): Intent[] {
  if (g.phase === "over" || g.active !== 0) return [];
  if (g.phase === "mulligan") return [{ t: "mulligan", replace: [] }];
  const out: Intent[] = [];
  const enemyTargets = (units: boolean, champ: boolean): Target[] => [...(units ? g.foe.board.filter((u) => !hasKw(u, "shadow")).map((u) => ({ unit: u.uid })) : []), ...(champ ? [{ champ: 1 as const }] : [])];
  g.me.hand.forEach((id, hand) => {
    const card = cardOf(id);
    if (card.cost > g.me.mana) return;
    if (card.type === "unit") { if (g.me.board.length < 5) out.push({ t: "play", hand }); return; }
    const anyTarget = /any target/i.test(card.text);
    for (const target of enemyTargets(true, anyTarget)) out.push({ t: "play", hand, target });
  });
  const guards = g.foe.board.filter((u) => hasKw(u, "guard"));
  for (const u of g.me.board) {
    if (!ready(u, g.turn)) continue;
    const targets: Target[] = guards.length ? guards.map((x) => ({ unit: x.uid })) : enemyTargets(true, true);
    for (const target of targets) out.push({ t: "attack", unit: u.uid, target });
  }
  if (!g.me.powerUsed && g.me.mana >= 2) out.push({ t: "power" });
  out.push({ t: "end" });
  return out;
}

function hit(g: Game, owner: Side, target: Target, n: number, ev: MatchEvent[]): void {
  if ("champ" in target) {
    const s = target.champ === 0 ? g.me : g.foe;
    const soaked = Math.min(s.armor, n);
    s.armor -= soaked; s.hp = Math.max(0, s.hp - (n - soaked));
    ev.push({ t: "damage", champ: target.champ, n });
    return;
  }
  if (!("unit" in target)) return;
  const victim = owner.board.find((u) => u.uid === target.unit);
  if (!victim) return;
  if (hasKw(victim, "shield")) { victim.kw = victim.kw.filter((k) => k !== "shield"); ev.push({ t: "shieldPop", unit: victim.uid }); return; }
  victim.dmg += n;
  ev.push({ t: "damage", unit: victim.uid, n });
}
function bury(g: Game, ev: MatchEvent[]): void {
  for (const [p, s] of [[0, g.me], [1, g.foe]] as const) {
    for (const u of s.board.filter((x) => x.dmg >= x.hp)) ev.push({ t: "death", p, unit: u.uid, card: u.card });
    s.board = s.board.filter((x) => x.dmg < x.hp);
  }
  if (g.me.hp <= 0 || g.foe.hp <= 0) {
    g.phase = "over";
    g.winner = g.me.hp <= 0 && g.foe.hp <= 0 ? "draw" : g.foe.hp <= 0 ? 0 : 1;
    g.info.status = g.winner === 0 ? "won" : g.winner === "draw" ? "draw" : "lost";
    g.info.finishedAt = new Date().toISOString();
    g.info.rewards = g.winner === 0 ? { dust: 20, packs: 0 } : { dust: 5, packs: 0 };
    ev.push({ t: "over", winner: g.winner });
  }
}
function summon(g: Game, s: Side, id: string): UnitView {
  const card = cardOf(id);
  const unit: UnitView = { uid: g.nextUid++, card: id, atk: card.atk ?? 0, hp: card.hp ?? 1, dmg: 0, kw: [...(card.kw ?? [])], tempKw: [], tempAtk: 0, attacks: 0, since: g.turn, chilled: false, gear: null };
  s.board.push(unit);
  return unit;
}
function startTurn(g: Game, p: 0 | 1, ev: MatchEvent[]): void {
  const s = p === 0 ? g.me : g.foe;
  g.active = p; g.turn += 1; s.turns += 1; s.mana = Math.min(s.turns, 8); s.powerUsed = false;
  for (const u of s.board) { u.attacks = 0; u.chilled = false; }
  const next = s.deck.shift();
  if (next && s.hand.length < 8) s.hand.push(next);
  else if (!next) { s.hp -= 1; ev.push({ t: "exhaustion", p, n: 1 }); }
  ev.push({ t: "turn", p, turn: g.turn, mana: s.mana });
}
function foeTurn(g: Game, ev: MatchEvent[]): void {
  startTurn(g, 1, ev);
  const foe = g.foe;
  const affordable = foe.hand.map((id, i) => ({ id, i, card: cardOf(id) })).filter((x) => x.card.type === "unit" && x.card.cost <= foe.mana).sort((a, b) => b.card.cost - a.card.cost);
  for (const pick of affordable) {
    if (pick.card.cost > foe.mana || foe.board.length >= 5) continue;
    foe.mana -= pick.card.cost; foe.hand.splice(foe.hand.indexOf(pick.id), 1);
    summon(g, foe, pick.id); ev.push({ t: "play", p: 1, card: pick.id, cost: pick.card.cost });
  }
  for (const u of foe.board) {
    if (!ready(u, g.turn) || g.phase === "over") continue;
    const guard = g.me.board.find((x) => hasKw(x, "guard"));
    const target: Target = guard ? { unit: guard.uid } : { champ: 0 };
    u.attacks += 1;
    if ("unit" in target) { hit(g, g.me, target, u.atk, ev); const back = g.me.board.find((x) => x.uid === target.unit); if (back) u.dmg += back.atk; }
    else hit(g, g.me, target, u.atk, ev);
    bury(g, ev);
  }
  if (g.phase !== "over") startTurn(g, 0, ev);
}

function apply(g: Game, intent: Intent): MatchEvent[] {
  const ev: MatchEvent[] = [];
  const legal = legalFor(g);
  if (!legal.some((l) => JSON.stringify(l) === JSON.stringify(intent)) && !(intent.t === "mulligan" && g.phase === "mulligan")) throw new ClashError("That move is not allowed right now.", 409);
  switch (intent.t) {
    case "mulligan": {
      for (const i of [...intent.replace].sort((a, b) => b - a)) { const [id] = g.me.hand.splice(i, 1); if (id) g.me.deck.push(id); }
      while (g.me.hand.length < 3 && g.me.deck.length) g.me.hand.push(g.me.deck.shift()!);
      g.phase = "main"; g.turn = 0; startTurn(g, 0, ev);
      break;
    }
    case "play": {
      const id = g.me.hand[intent.hand]!;
      const card = cardOf(id);
      g.me.mana -= card.cost; g.me.hand.splice(intent.hand, 1);
      ev.push({ t: "play", p: 0, card: id, cost: card.cost });
      if (card.type === "unit") summon(g, g.me, id);
      else if (intent.target) { hit(g, g.foe, intent.target, Number(/Deal (\d+)/i.exec(card.text)?.[1] ?? 2), ev); bury(g, ev); }
      break;
    }
    case "attack": {
      const u = g.me.board.find((x) => x.uid === intent.unit)!;
      u.attacks += 1; u.kw = u.kw.filter((k) => k !== "shadow");
      if ("unit" in intent.target) { const target = intent.target; const victim = g.foe.board.find((x) => x.uid === target.unit); hit(g, g.foe, target, u.atk, ev); if (victim) u.dmg += victim.atk; }
      else hit(g, g.foe, intent.target, u.atk, ev);
      bury(g, ev);
      break;
    }
    case "power": g.me.mana -= 2; g.me.powerUsed = true; g.me.armor += 2; ev.push({ t: "power", p: 0, cls: g.me.cls }); break;
    case "end": foeTurn(g, ev); break;
    case "choose": break;
  }
  g.info.round = Math.ceil(g.turn / 2); g.info.version += 1;
  return ev;
}

function viewOf(g: Game): PlayerView {
  const own = { ...g.me, deckCount: g.me.deck.length, standard: null, secondWind: false };
  const { deck: _deck, hand, ...foe } = g.foe;
  void _deck;
  return {
    phase: g.phase, turn: g.turn, round: Math.max(1, Math.ceil(g.turn / 2)), active: g.active, actor: g.active, yourTurn: g.phase !== "over" && g.active === 0, first: 0,
    mulligan: [g.phase !== "mulligan", true], zone: g.zone ? { card: g.zone, owner: 1 } : null,
    me: JSON.parse(JSON.stringify(own)) as PlayerView["me"],
    opponent: JSON.parse(JSON.stringify({ ...foe, handCount: hand.length, deckCount: g.foe.deck.length, standard: null, secondWind: false })) as PlayerView["opponent"],
    pending: null, opponentChoosing: false, winner: g.winner, reason: null, legal: legalFor(g)
  };
}

/** The sample client: the same interface as the live one, all local. */
export class MockClash implements ClashApi {
  readonly sample = true;
  private coll = sampleCollection();
  private games = new Map<string, Game>();
  private cleared = 1;
  private packRoll = rng(7);
  private respond = (g: Game, events: MatchEvent[] = []): MatchResponse => ({ match: { ...g.info }, view: viewOf(g), events, rewards: g.phase === "over" ? { dust: g.info.rewards?.dust ?? 0, packs: 0, overflowDust: 0, questsCompleted: [], packProgress: 1, won: g.winner === 0 } : null });
  private game(id: string): Game { const g = this.games.get(id); if (!g) throw new ClashError("That match does not exist.", 404); return g; }

  async collection() { return clone(this.coll); }
  async openPack(): Promise<OpenedPack> {
    if (this.coll.packs.ready < 1) throw new ClashError("No pack is ready yet. A new one arrives every 20 hours (up to 3 are kept).", 409);
    const pool = this.coll.cards.filter((c) => c.family === "class");
    const picks = [0, 1, 2, 3].map(() => pool.filter((c) => c.rarity === "common")[this.packRoll(9)]!);
    const rareSlot = pool.filter((c) => c.rarity !== "common");
    picks.push(rareSlot[this.packRoll(rareSlot.length)]!);
    let dustGained = 0;
    const cards = picks.map((c) => {
      const isNew = !c.owned;
      const dust = isNew ? 0 : c.rarity === "common" ? 5 : c.rarity === "rare" ? 25 : 100;
      dustGained += dust; c.owned = true; c.count += 1; c.craftCost = null;
      return { key: c.key, rarity: c.rarity, isNew, dust, name: c.name, rarityLabel: c.rarityLabel };
    });
    this.coll.packs.ready -= 1; this.coll.dust += dustGained; this.coll.owned = this.coll.cards.filter((c) => c.owned).length;
    return { cards, dustGained, collection: clone(this.coll) };
  }
  async craft(key: string) {
    const card = this.coll.cards.find((c) => c.key === key);
    if (!card || card.owned || card.craftCost === null) throw new ClashError("That card cannot be crafted.", 409);
    if (card.craftCost > this.coll.dust) throw new ClashError("Not enough dust.", 409);
    this.coll.dust -= card.craftCost; card.owned = true; card.count = 1; card.craftCost = null; this.coll.owned += 1;
    return clone(this.coll);
  }
  async start(input: StartInput) {
    const roll = rng(this.games.size + 11);
    const boss = input.mode === "pve" ? GAUNTLET.find((b) => b.id === input.boss) ?? GAUNTLET[0]! : null;
    const foeCls = boss?.cls ?? input.opponent ?? CLASS_KEYS[(CLASS_KEYS.indexOf(input.cls) + 4) % 9]!;
    const id = `sample-${this.games.size + 1}`;
    const g: Game = {
      id, turn: 0, active: 0, phase: "mulligan", winner: null, nextUid: 1, roll, zone: boss ? "133" : null,
      me: side(input.cls, 20, deckFor(input.cls, roll), 3), foe: side(foeCls, boss?.health ?? 20, deckFor(foeCls, roll), 4),
      info: { id, kind: input.mode, aiLevel: input.level ?? boss?.level ?? "normal", boss: boss ? { id: boss.id, name: boss.name } : null, status: "active", reason: null,
        round: 1, version: 1, turnSeconds: 86_400, turnDeadlineAt: null, createdAt: new Date().toISOString(), finishedAt: null, rewards: null }
    };
    this.games.set(id, g);
    return this.respond(g);
  }
  async match(id: string) { return this.respond(this.game(id)); }
  async intent(id: string, intent: Intent) {
    const g = this.game(id);
    const events = apply(g, intent);
    if (g.phase === "over" && g.winner === 0 && g.info.kind === "pve") this.cleared = Math.max(this.cleared, GAUNTLET.findIndex((b) => b.id === g.info.boss?.id) + 1);
    return this.respond(g, events);
  }
  async concede(id: string) {
    const g = this.game(id);
    g.phase = "over"; g.winner = 1; g.info.status = "lost"; g.info.reason = "concede"; g.info.finishedAt = new Date().toISOString();
    return this.respond(g, [{ t: "over", winner: 1 }]);
  }
  async matches() { return [...this.games.values()].map((g) => ({ ...g.info })).reverse(); }
  async pve(): Promise<PveProgress> {
    return {
      bosses: GAUNTLET.map((b, i) => ({ ...b, cleared: i < this.cleared, unlocked: i <= this.cleared, paidToday: i === 0, spotlight: i === 2 })),
      cleared: this.cleared, runs: 3, featured: { week: 45, boss: "boss-3", note: "Double dust this week." },
      daily: { day: "2026-11-08", packsFromPlay: 1, packCap: 3, packProgress: 2, stepsPerPack: 3, quests: [
        { id: "win1", text: "Win a match", target: 1, progress: 1, done: true }, { id: "play3", text: "Play 3 matches", target: 3, progress: 2, done: false },
        { id: "zone1", text: "Play a Zone", target: 1, progress: 0, done: false }] },
      wins: 4, losses: 2
    };
  }
}
