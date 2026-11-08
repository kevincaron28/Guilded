import { describe, expect, it, vi } from "vitest";

// The real catalogue has no tradable Legendary or Uncommon yet, so the tests add one of each (class cards stay Common, Rare and Epic).
vi.mock("../src/services/tcg-catalogue.js", async (original) => {
  const real = await original<typeof import("../src/services/tcg-catalogue.js")>();
  const extra = (key: string, rarity: "uncommon" | "legendary") => ({ key, family: "class" as const, rarity, set: "classes" as const, en: { name: key }, fr: { name: key } });
  const map = new Map(real.CARD_BY_KEY);
  for (const card of [extra("class:test:uncommon", "uncommon"), extra("class:test:uncommon2", "uncommon"), extra("class:test:legendary", "legendary"), extra("class:test:legendary2", "legendary")]) map.set(card.key, card);
  return { ...real, CARD_BY_KEY: map };
});

import { CARD_BY_KEY } from "../src/services/tcg-catalogue.js";
import { CONFIRM_LOCK_MS, GIFTS_PER_DAY, MAX_OPEN_OFFERS, OFFER_TTL_MS, RECEIVED_LOCK_MS, TRADES_PER_DAY, cancelTrade, confirmTrade, editTrade, getTrade, listTrades, offerTrade, setTradingOff, tradableCards, tradePartners, valueWindowOk, type TradeView } from "../src/services/tcg-trade.js";

interface Rec { [key: string]: unknown }
const NOW = new Date(Date.UTC(2026, 10, 20, 12, 0, 0));
const DAY = 86_400_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const allows = () => true;

function matches(where: Rec, row: Rec): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === "OR") return (v as Rec[]).some(w => matches(w, row));
    if (v && typeof v === "object" && !(v instanceof Date)) {
      const o = v as Rec;
      if ("in" in o) return (o["in"] as unknown[]).includes(row[k]);
      if ("not" in o) return row[k] !== o["not"];
      if ("gte" in o) return row[k] instanceof Date && (row[k] as Date).getTime() >= (o["gte"] as Date).getTime();
    }
    return row[k] === v;
  });
}

/** An in-memory world: one server (g1), three members with linked characters, week-old collections and five played matches each. */
function world() {
  const cards = new Map<string, Rec>();
  const trades = new Map<string, Rec>();
  const events: Rec[] = [];
  const logs: Rec[] = [];
  const accounts = new Map<string, Rec>();
  const players = new Map<string, Rec>();
  const members: Rec[] = [];
  const settings: Rec[] = [];
  let counter = 0;
  const addUser = (id: string, guildId = "g1", discordId = "123") => {
    members.push({ id: `mem-${id}`, guildId, discordUserId: id, displayName: `Name ${id}`, status: "ACTIVE", isTest: false, guild: { discordId } });
    accounts.set(id, { discordUserId: id, createdAt: ago(20 * DAY) });
    players.set(id, { discordUserId: id, playedCounted: 5, tradingOff: false, tradeBanned: false });
  };
  const give = (user: string, key: string, age = 3 * DAY) => cards.set(`${user}|${key}`, { discordUserId: user, cardKey: key, count: 1, firstSeenAt: ago(age) });
  const owns = (user: string, key: string) => cards.has(`${user}|${key}`);
  for (const id of ["u1", "u2", "u3"]) addUser(id);
  const tx = {
    tcgCard: {
      findMany: async ({ where }: { where: Rec }) => [...cards.values()].filter(r => matches(where, r)).map(r => ({ ...r })),
      deleteMany: async ({ where }: { where: Rec }) => { let n = 0; for (const [k, r] of cards) if (matches(where, r)) { cards.delete(k); n++; } return { count: n }; },
      create: async ({ data }: { data: Rec }) => { const k = `${data["discordUserId"]}|${data["cardKey"]}`; if (cards.has(k)) throw new Error("unique"); cards.set(k, { ...data }); }
    },
    tcgLog: { create: async ({ data }: { data: Rec }) => { logs.push(data); } },
    tcgAccount: { findUnique: async ({ where }: { where: Rec }) => { const r = accounts.get(where["discordUserId"] as string); return r ? { ...r } : null; } },
    tcgPlayer: {
      findUnique: async ({ where }: { where: Rec }) => { const r = players.get(where["discordUserId"] as string); return r ? { ...r } : null; },
      upsert: async ({ where, create, update }: { where: Rec; create: Rec; update: Rec }) => { const r = players.get(where["discordUserId"] as string); if (r) Object.assign(r, update); else players.set(where["discordUserId"] as string, { playedCounted: 0, tradingOff: false, tradeBanned: false, ...create }); }
    },
    tcgTrade: {
      create: async ({ data }: { data: Rec }) => { const row = { id: `t${++counter}`, status: "open", fromConfirmed: false, toConfirmed: false, version: 0, flags: [], createdAt: new Date(NOW.getTime() + counter), completedAt: null, fromValue: 0, toValue: 0, legendary: false, ...data }; trades.set(row.id as string, row); return structuredClone(row); },
      findFirst: async ({ where }: { where: Rec }) => { const r = [...trades.values()].find(t => matches(where, t)); return r ? structuredClone(r) : null; },
      findMany: async ({ where, take }: { where: Rec; take?: number }) => [...trades.values()].filter(t => matches(where, t)).sort((a, b) => (b["createdAt"] as Date).getTime() - (a["createdAt"] as Date).getTime()).slice(0, take ?? 100).map(t => structuredClone(t)),
      count: async ({ where }: { where: Rec }) => [...trades.values()].filter(t => matches(where, t)).length,
      updateMany: async ({ where, data }: { where: Rec; data: Rec }) => { const r = trades.get(where["id"] as string); if (!r || !matches(where, r)) return { count: 0 }; Object.assign(r, structuredClone(data)); return { count: 1 }; }
    },
    tcgTradeEvent: { create: async ({ data }: { data: Rec }) => { events.push(structuredClone(data)); } },
    member: {
      findMany: async ({ where }: { where: Rec }) => members.filter(m => matches(where, m)).map(m => ({ ...m })),
      findFirst: async ({ where }: { where: Rec }) => members.find(m => matches(where, m)) ?? null
    },
    character: { count: async ({ where }: { where: Rec }) => (where["memberId"] as string).startsWith("mem-") && !unlinked.has(where["memberId"] as string) ? 1 : 0 },
    guildSettings: { findFirst: async ({ where }: { where: Rec }) => settings.find(s => matches(where, s)) ?? null }
  };
  const unlinked = new Set<string>();
  const db = {
    ...tx,
    $transaction: async <T>(fn: (t: typeof tx) => Promise<T>): Promise<T> => {
      const snap = { c: structuredClone([...cards]), t: structuredClone([...trades]), e: events.length, l: logs.length };
      try { return await fn(tx); } catch (error) {
        cards.clear(); snap.c.forEach(([k, v]) => cards.set(k, v)); trades.clear(); snap.t.forEach(([k, v]) => trades.set(k, v)); events.length = snap.e; logs.length = snap.l;
        throw error;
      }
    }
  };
  return { db: db as never, cards, trades, events, logs, accounts, players, members, settings, unlinked, addUser, give, owns };
}
type World = ReturnType<typeof world>;

const WARRIOR_RARE = "class:warrior:rare", MAGE_RARE = "class:mage:rare", HUNTER_RARE = "class:hunter:rare";
const afterLock = new Date(NOW.getTime() + CONFIRM_LOCK_MS + 1);

/** A rare for a rare between u1 and u2, ready to confirm. */
async function swap(w: World, give = [WARRIOR_RARE], want = [MAGE_RARE]): Promise<TradeView> {
  for (const k of give) if (!w.owns("u1", k)) w.give("u1", k);
  for (const k of want) if (!w.owns("u2", k)) w.give("u2", k);
  return offerTrade(w.db, "u1", { to: "u2", give, want }, "en", allows, NOW);
}
const both = async (w: World, id: string, at = afterLock) => { await confirmTrade(w.db, "u1", id, "en", allows, at); return confirmTrade(w.db, "u2", id, "en", allows, at); };
const fail = async (promise: Promise<unknown>, status: number, text?: RegExp) => { const error = await promise.then(() => null, (e: unknown) => e) as { status?: number; message?: string } | null; expect(error, "expected a refusal").not.toBeNull(); expect(error!.status).toBe(status); if (text) expect(error!.message).toMatch(text); };
const doneTrade = (w: World, from: string, to: string, over: Rec = {}) => w.trades.set(`pre${w.trades.size}`, { id: `pre${w.trades.size}`, guildId: "g1", fromUser: from, toUser: to, kind: "swap", fromCards: [], toCards: [], fromValue: 10, toValue: 10, legendary: false, status: "done", completedAt: ago(1000), createdAt: ago(2000), flags: [], version: 1, ...over });

describe("the value window", () => {
  it("allows a difference of 5 points or 25%, whichever is larger", () => {
    expect(valueWindowOk(10, 10)).toBe(true);
    expect(valueWindowOk(1, 6)).toBe(true);
    expect(valueWindowOk(1, 7)).toBe(false);
    expect(valueWindowOk(40, 50)).toBe(true);
    expect(valueWindowOk(40, 53)).toBe(true);
    expect(valueWindowOk(40, 55)).toBe(false);
    expect(valueWindowOk(120, 40)).toBe(false);
  });
});

describe("a swap", () => {
  it("needs both confirmations after the 10 second look, then moves the cards, locks them and writes the audit trail", async () => {
    const w = world();
    const offer = await swap(w);
    expect(offer.status).toBe("open");
    expect(offer.kind).toBe("swap");
    expect(offer.give.map(c => c.key)).toEqual([WARRIOR_RARE]);
    expect(offer.partner.name).toBe("Name u2");
    await fail(confirmTrade(w.db, "u1", offer.id, "en", allows, NOW), 409, /confirm in/);
    const first = await confirmTrade(w.db, "u1", offer.id, "en", allows, afterLock);
    expect(first.status).toBe("open");
    expect(first.youConfirmed).toBe(true);
    expect(w.owns("u1", WARRIOR_RARE)).toBe(true);
    const done = await confirmTrade(w.db, "u2", offer.id, "en", allows, afterLock);
    expect(done.status).toBe("done");
    expect(w.owns("u1", WARRIOR_RARE)).toBe(false);
    expect(w.owns("u2", WARRIOR_RARE)).toBe(true);
    expect(w.owns("u1", MAGE_RARE)).toBe(true);
    expect(w.owns("u2", MAGE_RARE)).toBe(false);
    expect(w.events.map(e => e["kind"])).toEqual(["offered", "confirmed", "completed"]);
    expect(w.logs.map(l => l["kind"])).toEqual(["trade", "trade"]);
    // Received cards are locked for 24 hours.
    const received = w.cards.get(`u2|${WARRIOR_RARE}`)!;
    expect((received["firstSeenAt"] as Date).getTime()).toBe(afterLock.getTime());
    await fail(offerTrade(w.db, "u2", { to: "u3", give: [WARRIOR_RARE], want: [] }, "en", allows, afterLock), 409, /24 hours/);
    const later = new Date(afterLock.getTime() + RECEIVED_LOCK_MS + 1);
    w.give("u3", HUNTER_RARE);
    await expect(offerTrade(w.db, "u2", { to: "u3", give: [WARRIOR_RARE], want: [HUNTER_RARE] }, "en", allows, later)).resolves.toMatchObject({ status: "open" });
  });

  it("a repeated confirm is harmless and a finished trade never moves cards twice", async () => {
    const w = world();
    const offer = await swap(w);
    await confirmTrade(w.db, "u1", offer.id, "en", allows, afterLock);
    await confirmTrade(w.db, "u1", offer.id, "en", allows, afterLock);
    await both(w, offer.id);
    const snapshot = JSON.stringify([...w.cards]);
    const again = await confirmTrade(w.db, "u2", offer.id, "en", allows, afterLock);
    expect(again.status).toBe("done");
    await confirmTrade(w.db, "u1", offer.id, "en", allows, afterLock);
    expect(JSON.stringify([...w.cards])).toBe(snapshot);
    expect(w.events.filter(e => e["kind"] === "completed")).toHaveLength(1);
  });

  it("loses the race cleanly: a confirm that finds the offer changed under it rolls back", async () => {
    const w = world();
    const offer = await swap(w);
    await confirmTrade(w.db, "u1", offer.id, "en", allows, afterLock);
    const real = (w.db as unknown as { tcgTrade: { updateMany: (a: unknown) => Promise<{ count: number }> } }).tcgTrade;
    const original = real.updateMany;
    real.updateMany = async () => ({ count: 0 });
    await fail(confirmTrade(w.db, "u2", offer.id, "en", allows, afterLock), 409, /changed/);
    real.updateMany = original;
    expect(w.owns("u1", WARRIOR_RARE)).toBe(true);
    expect(w.trades.get(offer.id)!["status"]).toBe("open");
  });

  it("a card pledged in two offers can only leave once", async () => {
    const w = world();
    w.give("u1", WARRIOR_RARE); w.give("u2", MAGE_RARE); w.give("u3", HUNTER_RARE);
    const a = await offerTrade(w.db, "u1", { to: "u2", give: [WARRIOR_RARE], want: [MAGE_RARE] }, "en", allows, NOW);
    const b = await offerTrade(w.db, "u1", { to: "u3", give: [WARRIOR_RARE], want: [HUNTER_RARE] }, "en", allows, NOW);
    await both(w, a.id);
    expect(w.owns("u2", WARRIOR_RARE)).toBe(true);
    await confirmTrade(w.db, "u1", b.id, "en", allows, afterLock).catch(() => null);
    await fail(confirmTrade(w.db, "u3", b.id, "en", allows, afterLock), 409);
    expect(w.owns("u3", WARRIOR_RARE)).toBe(false);
    expect(w.owns("u3", HUNTER_RARE)).toBe(true);
    expect(w.trades.get(b.id)!["status"]).toBe("open");
  });

  it("editing resets both confirmations and the lock, and either side can edit", async () => {
    const w = world();
    const offer = await swap(w);
    await confirmTrade(w.db, "u1", offer.id, "en", allows, afterLock);
    w.give("u2", "class:priest:rare");
    const edited = await editTrade(w.db, "u2", offer.id, { give: ["class:priest:rare"], want: [WARRIOR_RARE] }, "en", afterLock);
    expect(edited.youConfirmed).toBe(false);
    expect(edited.partnerConfirmed).toBe(false);
    expect(edited.lockSecondsLeft).toBeGreaterThan(0);
    expect(edited.give.map(c => c.key)).toEqual(["class:priest:rare"]);
    await fail(confirmTrade(w.db, "u1", offer.id, "en", allows, afterLock), 409, /confirm in/);
    const later = new Date(afterLock.getTime() + CONFIRM_LOCK_MS + 1);
    await both(w, offer.id, later);
    expect(w.owns("u1", "class:priest:rare")).toBe(true);
    expect(w.owns("u2", WARRIOR_RARE)).toBe(true);
    expect(w.events.map(e => e["kind"])).toContain("edited");
  });
});

describe("which cards may be traded", () => {
  it("refuses achievement cards, unknown cards, fresh cards, cards not owned and cards the other member already has", async () => {
    const w = world();
    const badge = [...CARD_BY_KEY.keys()].find(k => k.startsWith("badge:"))!;
    w.give("u1", badge); w.give("u2", MAGE_RARE);
    await fail(offerTrade(w.db, "u1", { to: "u2", give: [badge], want: [MAGE_RARE] }, "en", allows, NOW), 409, /bound/);
    await fail(offerTrade(w.db, "u1", { to: "u2", give: ["class:nope:rare"], want: [] }, "en", allows, NOW), 404);
    w.give("u1", WARRIOR_RARE, 3_600_000);
    await fail(offerTrade(w.db, "u1", { to: "u2", give: [WARRIOR_RARE], want: [MAGE_RARE] }, "en", allows, NOW), 409, /24 hours/);
    await fail(offerTrade(w.db, "u1", { to: "u2", give: [HUNTER_RARE], want: [MAGE_RARE] }, "en", allows, NOW), 409, /not owned/);
    w.give("u1", HUNTER_RARE); w.give("u2", HUNTER_RARE);
    await fail(offerTrade(w.db, "u1", { to: "u2", give: [HUNTER_RARE], want: [MAGE_RARE] }, "en", allows, NOW), 409, /already/);
  });

  it("limits the cards a side and rejects duplicates and malformed lists", async () => {
    const w = world();
    await fail(offerTrade(w.db, "u1", { to: "u2", give: ["class:warrior:common", "class:mage:common", "class:priest:common", "class:rogue:common", "class:hunter:common", "class:druid:common"], want: [] }, "en", allows, NOW), 400, /At most/);
    await fail(offerTrade(w.db, "u1", { to: "u2", give: [WARRIOR_RARE, WARRIOR_RARE], want: [] }, "en", allows, NOW), 400, /once/);
    await fail(offerTrade(w.db, "u1", { to: "u2", give: "all", want: [] }, "en", allows, NOW), 400);
    await fail(offerTrade(w.db, "u1", { to: "u2", give: [5], want: [] }, "en", allows, NOW), 400);
  });

  it("shows each card's trade state", async () => {
    const w = world();
    w.give("u1", WARRIOR_RARE); w.give("u1", [...CARD_BY_KEY.keys()].find(k => k.startsWith("badge:"))!); w.give("u1", "class:mage:common", 1000);
    const res = await tradableCards(w.db, "u1", "en", NOW);
    expect(res.eligible).toBe(true);
    const by = Object.fromEntries(res.cards.map(c => [c.key, c]));
    expect(by[WARRIOR_RARE]).toMatchObject({ tradable: true, reason: null });
    expect(by["class:mage:common"]).toMatchObject({ tradable: false, reason: "locked" });
    expect(by["class:mage:common"]!.tradableAt).toBe(new Date(ago(1000).getTime() + RECEIVED_LOCK_MS).toISOString());
  });
});

describe("value and laundering", () => {
  it("refuses lopsided swaps, so a pile of commons cannot buy a better card", async () => {
    const w = world();
    const commons = ["warrior", "mage", "priest", "rogue", "hunter"].map(c => `class:${c}:common`);
    commons.forEach(k => w.give("u1", k)); w.give("u2", "class:druid:epic");
    await fail(offerTrade(w.db, "u1", { to: "u2", give: commons, want: ["class:druid:epic"] }, "en", allows, NOW), 409, /value/);
    w.give("u1", "class:test:legendary"); w.give("u2", "class:test:legendary2");
    await expect(offerTrade(w.db, "u1", { to: "u2", give: ["class:test:legendary"], want: ["class:test:legendary2"] }, "en", allows, NOW)).resolves.toBeDefined();
    await fail(offerTrade(w.db, "u1", { to: "u2", give: ["class:test:legendary"], want: ["class:druid:epic"] }, "en", allows, NOW), 409, /value/);
  });

  it("re-checks the value window when the offer is edited", async () => {
    const w = world();
    const offer = await swap(w);
    w.give("u1", "class:test:legendary");
    await fail(editTrade(w.db, "u1", offer.id, { give: ["class:test:legendary"], want: [MAGE_RARE] }, "en", NOW), 409, /value/);
  });

  it("flags a member whose net inflow over 7 days is large, without blocking the trade", async () => {
    const w = world();
    doneTrade(w, "u3", "u1", { fromValue: 110, toValue: 0, completedAt: ago(2 * DAY) });
    w.give("u1", "class:warrior:epic"); w.give("u2", "class:mage:epic");
    const offer = await offerTrade(w.db, "u1", { to: "u2", give: ["class:warrior:epic"], want: ["class:mage:epic"] }, "en", allows, NOW);
    expect((await both(w, offer.id)).status).toBe("done");
    const flags = w.trades.get(offer.id)!["flags"] as string[];
    expect(flags.some(f => f.startsWith("inflow:u1:"))).toBe(true);
    expect(flags.some(f => f.startsWith("inflow:u2"))).toBe(false);
  });

  it("flags trades with accounts under two weeks old", async () => {
    const w = world();
    w.accounts.set("u2", { discordUserId: "u2", createdAt: ago(8 * DAY) });
    const offer = await swap(w);
    await both(w, offer.id);
    expect(w.trades.get(offer.id)!["flags"]).toEqual(["young:u2"]);
  });
});

describe("gifts", () => {
  it("allows Common and Uncommon gifts only, up to 3 a day", async () => {
    const w = world();
    const commons = ["warrior", "mage", "priest", "rogue"].map(c => `class:${c}:common`);
    commons.forEach(k => w.give("u1", k));
    w.give("u1", WARRIOR_RARE);
    await fail(offerTrade(w.db, "u1", { to: "u2", give: [WARRIOR_RARE], want: [] }, "en", allows, NOW), 409, /Common and Uncommon/);
    for (const k of commons.slice(0, GIFTS_PER_DAY)) { const g = await offerTrade(w.db, "u1", { to: "u2", give: [k], want: [] }, "en", allows, NOW); expect(g.kind).toBe("gift"); expect((await both(w, g.id)).status).toBe("done"); }
    const fourth = await offerTrade(w.db, "u1", { to: "u2", give: [commons[3]!], want: [] }, "en", allows, NOW);
    await confirmTrade(w.db, "u1", fourth.id, "en", allows, afterLock);
    await fail(confirmTrade(w.db, "u2", fourth.id, "en", allows, afterLock), 409, /3 gifts/);
    const nextDay = new Date(afterLock.getTime() + DAY);
    // The next day the cap is fresh (the offer itself expired after 24 hours, so it is offered again).
    const again = await offerTrade(w.db, "u1", { to: "u2", give: [commons[3]!], want: [] }, "en", allows, nextDay);
    expect((await both(w, again.id, new Date(nextDay.getTime() + CONFIRM_LOCK_MS + 1))).status).toBe("done");
  });
});

describe("limits", () => {
  it("allows 5 swaps a day per member", async () => {
    const w = world();
    for (let i = 0; i < TRADES_PER_DAY; i++) doneTrade(w, "u1", "u3", { completedAt: ago(1000 + i) });
    const offer = await swap(w);
    await confirmTrade(w.db, "u1", offer.id, "en", allows, afterLock);
    await fail(confirmTrade(w.db, "u2", offer.id, "en", allows, afterLock), 409, /5 trades today/);
    expect(w.owns("u1", WARRIOR_RARE)).toBe(true);
    // The other member's cap counts too.
    const w2 = world();
    for (let i = 0; i < TRADES_PER_DAY; i++) doneTrade(w2, "u2", "u3", { completedAt: ago(1000 + i) });
    const offer2 = await swap(w2);
    await confirmTrade(w2.db, "u1", offer2.id, "en", allows, afterLock);
    await fail(confirmTrade(w2.db, "u2", offer2.id, "en", allows, afterLock), 409, /5 trades today/);
  });

  it("allows one Legendary trade a week per member", async () => {
    const w = world();
    doneTrade(w, "u3", "u1", { legendary: true, completedAt: ago(2 * DAY) });
    w.give("u1", "class:test:legendary"); w.give("u2", "class:test:legendary2");
    const offer = await offerTrade(w.db, "u1", { to: "u2", give: ["class:test:legendary"], want: ["class:test:legendary2"] }, "en", allows, NOW);
    expect(w.trades.get(offer.id)!["legendary"]).toBe(true);
    await confirmTrade(w.db, "u1", offer.id, "en", allows, afterLock);
    await fail(confirmTrade(w.db, "u2", offer.id, "en", allows, afterLock), 409, /Legendary this week/);
    const w2 = world();
    doneTrade(w2, "u3", "u1", { legendary: true, completedAt: ago(8 * DAY) });
    w2.give("u1", "class:test:legendary"); w2.give("u2", "class:test:legendary2");
    const ok = await offerTrade(w2.db, "u1", { to: "u2", give: ["class:test:legendary"], want: ["class:test:legendary2"] }, "en", allows, NOW);
    expect((await both(w2, ok.id)).status).toBe("done");
  });

  it("caps the open offers a member can have", async () => {
    const w = world();
    const keys = [...["warrior", "mage", "priest", "rogue", "hunter", "druid", "paladin", "shaman", "warlock"].map(c => `class:${c}:common`), "class:test:uncommon", "class:test:uncommon2"];
    keys.forEach(k => w.give("u1", k));
    for (let i = 0; i < MAX_OPEN_OFFERS; i++) await offerTrade(w.db, "u1", { to: "u2", give: [keys[i]!], want: [] }, "en", allows, NOW);
    await fail(offerTrade(w.db, "u1", { to: "u2", give: [keys[MAX_OPEN_OFFERS]!], want: [] }, "en", allows, NOW), 409, /open offers/);
  });
});

describe("who may trade", () => {
  it("refuses new accounts and accounts with too few matches (alt farming)", async () => {
    const w = world();
    w.give("u1", WARRIOR_RARE); w.give("u2", MAGE_RARE);
    w.accounts.set("u1", { discordUserId: "u1", createdAt: ago(3 * DAY) });
    await fail(offerTrade(w.db, "u1", { to: "u2", give: [WARRIOR_RARE], want: [MAGE_RARE] }, "en", allows, NOW), 409, /7 days/);
    w.accounts.set("u1", { discordUserId: "u1", createdAt: ago(10 * DAY) });
    w.players.get("u1")!["playedCounted"] = 4;
    await fail(offerTrade(w.db, "u1", { to: "u2", give: [WARRIOR_RARE], want: [MAGE_RARE] }, "en", allows, NOW), 409, /5 played matches/);
    w.players.get("u1")!["playedCounted"] = 5;
    // The receiving account is checked too, without saying why.
    w.accounts.set("u2", { discordUserId: "u2", createdAt: ago(NOW.getTime() - NOW.getTime() + 1000) });
    await fail(offerTrade(w.db, "u1", { to: "u2", give: [WARRIOR_RARE], want: [MAGE_RARE] }, "en", allows, NOW), 409, /cannot trade yet/);
    w.accounts.delete("u1");
    await fail(offerTrade(w.db, "u1", { to: "u2", give: [WARRIOR_RARE], want: [] }, "en", allows, NOW), 409, /7 days/);
  });

  it("re-checks eligibility when the second confirmation arrives", async () => {
    const w = world();
    const offer = await swap(w);
    await confirmTrade(w.db, "u1", offer.id, "en", allows, afterLock);
    w.players.get("u1")!["tradeBanned"] = true;
    await fail(confirmTrade(w.db, "u2", offer.id, "en", allows, afterLock), 409);
    expect(w.owns("u1", WARRIOR_RARE)).toBe(true);
  });

  it("honours the member's own switch, bans and unlinked characters", async () => {
    const w = world();
    w.give("u1", WARRIOR_RARE); w.give("u2", MAGE_RARE);
    const attempt = () => offerTrade(w.db, "u1", { to: "u2", give: [WARRIOR_RARE], want: [MAGE_RARE] }, "en", allows, NOW);
    w.players.get("u1")!["tradingOff"] = true;
    await fail(attempt(), 409, /switched off/);
    w.players.get("u1")!["tradingOff"] = false; w.players.get("u1")!["tradeBanned"] = true;
    await fail(attempt(), 409, /removed/);
    w.players.get("u1")!["tradeBanned"] = false; w.unlinked.add("mem-u2");
    await fail(attempt(), 403);
  });

  it("is guild-only and follows the officer switches", async () => {
    const w = world();
    w.addUser("u4", "g2", "999");
    w.give("u1", WARRIOR_RARE); w.give("u4", MAGE_RARE);
    await fail(offerTrade(w.db, "u1", { to: "u4", give: [WARRIOR_RARE], want: [MAGE_RARE] }, "en", allows, NOW), 403);
    await fail(offerTrade(w.db, "u1", { to: "u1", give: [WARRIOR_RARE], want: [] }, "en", allows, NOW), 403);
    w.give("u2", MAGE_RARE);
    w.settings.push({ guildId: "g1", tcgTradingEnabled: false });
    await fail(offerTrade(w.db, "u1", { to: "u2", give: [WARRIOR_RARE], want: [MAGE_RARE] }, "en", allows, NOW), 403);
    w.settings.length = 0; w.settings.push({ guildId: "g1", tcgEnabled: false });
    await fail(offerTrade(w.db, "u1", { to: "u2", give: [WARRIOR_RARE], want: [MAGE_RARE] }, "en", allows, NOW), 403);
    w.settings.length = 0;
    await fail(offerTrade(w.db, "u1", { to: "u2", give: [WARRIOR_RARE], want: [MAGE_RARE] }, "en", () => false, NOW), 403);
  });

  it("lists only eligible guildmates as partners", async () => {
    const w = world();
    w.players.get("u3")!["playedCounted"] = 1;
    w.addUser("u4", "g2", "999");
    expect((await tradePartners(w.db, "u1", allows, NOW)).partners).toEqual([{ discordUserId: "u2", name: "Name u2" }]);
  });
});

describe("cancel, expiry and privacy", () => {
  it("lets either side cancel, and a cancelled or expired offer can no longer be confirmed", async () => {
    const w = world();
    const offer = await swap(w);
    expect((await cancelTrade(w.db, "u2", offer.id, "en", NOW)).status).toBe("cancelled");
    await fail(confirmTrade(w.db, "u1", offer.id, "en", allows, afterLock), 409, /cancelled/);
    await fail(cancelTrade(w.db, "u1", offer.id, "en", NOW), 409);
    await fail(editTrade(w.db, "u1", offer.id, { give: [WARRIOR_RARE], want: [] }, "en", NOW), 409);
    const second = await offerTrade(w.db, "u1", { to: "u2", give: [WARRIOR_RARE], want: [MAGE_RARE] }, "en", allows, NOW);
    const late = new Date(NOW.getTime() + OFFER_TTL_MS + 1);
    expect((await confirmTrade(w.db, "u1", second.id, "en", allows, late)).status).toBe("expired");
    expect(w.trades.get(second.id)!["status"]).toBe("expired");
    expect(w.owns("u1", WARRIOR_RARE)).toBe(true);
    expect(w.events.map(e => e["kind"])).toEqual(expect.arrayContaining(["offered", "cancelled", "expired"]));
  });

  it("expires overdue offers when they are listed or read", async () => {
    const w = world();
    const offer = await swap(w);
    const late = new Date(NOW.getTime() + OFFER_TTL_MS + 1);
    expect((await getTrade(w.db, "u2", offer.id, "en", late)).status).toBe("expired");
    const w2 = world();
    await swap(w2);
    expect((await listTrades(w2.db, "u1", "en", late)).trades.map(t => t.status)).toEqual(["expired"]);
  });

  it("hides trades from everyone else", async () => {
    const w = world();
    const offer = await swap(w);
    await fail(getTrade(w.db, "u3", offer.id, "en", NOW), 404);
    await fail(confirmTrade(w.db, "u3", offer.id, "en", allows, afterLock), 404);
    await fail(cancelTrade(w.db, "u3", offer.id, "en", NOW), 404);
    await fail(editTrade(w.db, "u3", offer.id, { give: [], want: [] }, "en", NOW), 404);
    expect((await listTrades(w.db, "u3", "en", NOW)).trades).toEqual([]);
    const view = await getTrade(w.db, "u2", offer.id, "en", NOW);
    expect(view.you).toBe("to");
    expect(view.give.map(c => c.key)).toEqual([MAGE_RARE]);
    expect(view.get.map(c => c.key)).toEqual([WARRIOR_RARE]);
    expect(JSON.stringify(view)).not.toContain("flags");
  });

  it("turning trading off cancels the member's open offers", async () => {
    const w = world();
    const offer = await swap(w);
    expect(await setTradingOff(w.db, "u2", true, NOW)).toEqual({ tradingOff: true });
    expect(w.trades.get(offer.id)!["status"]).toBe("cancelled");
    expect(w.players.get("u2")!["tradingOff"]).toBe(true);
  });
});
