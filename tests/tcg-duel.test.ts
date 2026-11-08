import { describe, expect, it } from "vitest";
import { chooseAction } from "../src/services/tcg-ai.js";
import { actor } from "../src/services/tcg-engine.js";
import type { MatchState } from "../src/services/tcg-engine-types.js";
import { stateHash } from "../src/services/tcg-engine.js";
import { acceptChallenge, challenge, concedeDuel, declineChallenge, duelPartners, getDuel, joinRanked, leaderboard, leaveRanked, listDuels, pollDuel, rankedStatus, replayDuel, submitDuelIntent, CHALLENGE_TTL_MS, LIVE_CHALLENGE_TTL_MS, LIVE_TURN_SECONDS, MAX_ACTIVE_DUELS, MAX_OPEN_CHALLENGES, QUEUE_TTL_MS, TURN_SECONDS, type DuelDb } from "../src/services/tcg-duel.js";
import { applyStars, glicko2, LEGEND_STARS, queueWindow, rankOf, rolloverRating, seasonKey, startStars, weekStart } from "../src/services/tcg-rating.js";

interface Rec { [key: string]: unknown }
const NOW = new Date(Date.UTC(2026, 10, 20, 12, 0, 0)); // Friday 20 November 2026
const DAY = 86_400_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const later = (ms: number) => new Date(NOW.getTime() + ms);
const allows = () => true;

// ---- a small in-memory database with the same compare-and-set behaviour the service relies on ----

function matches(where: Rec, row: Rec): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === "OR") return (v as Rec[]).some(w => matches(w, row));
    if (k.includes("_") && v && typeof v === "object" && !(v instanceof Date)) return matches(v as Rec, row);
    if (k === "characters") return row["linked"] !== false;
    if (v && typeof v === "object" && !(v instanceof Date)) {
      const o = v as Rec;
      const cmp = (a: unknown, b: unknown) => a instanceof Date ? a.getTime() - (b as Date).getTime() : (a as number) < (b as number) ? -1 : (a as number) > (b as number) ? 1 : 0;
      if ("in" in o) return (o["in"] as unknown[]).includes(row[k]);
      if ("not" in o) return row[k] !== o["not"];
      if ("gte" in o) return row[k] != null && cmp(row[k], o["gte"]) >= 0;
      if ("gt" in o) return row[k] != null && cmp(row[k], o["gt"]) > 0;
      if ("lt" in o) return row[k] != null && cmp(row[k], o["lt"]) < 0;
    }
    return row[k] === v;
  });
}

function sorter(orderBy: unknown): (a: Rec, b: Rec) => number {
  const list = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []) as Record<string, "asc" | "desc">[];
  return (a, b) => {
    for (const o of list) for (const [key, dir] of Object.entries(o)) {
      const x = a[key], y = b[key];
      const d = x instanceof Date ? x.getTime() - (y as Date).getTime() : (x as number) < (y as number) ? -1 : (x as number) > (y as number) ? 1 : 0;
      if (d !== 0) return dir === "desc" ? -d : d;
    }
    return 0;
  };
}

class Table {
  rows: Rec[] = [];
  constructor(private defaults: () => Rec, private keys: string[]) {}
  private same(row: Rec, where: Rec) { const flat: Rec = {}; for (const [k, v] of Object.entries(where)) { if (k.includes("_") && v && typeof v === "object") Object.assign(flat, v); else flat[k] = v; } return matches(flat, row); }
  async findUnique({ where }: { where: Rec }) { const r = this.rows.find(x => this.same(x, where)); return r ? structuredClone(r) : null; }
  async findFirst({ where, orderBy }: { where?: Rec; orderBy?: unknown }) { const r = this.rows.filter(x => matches(where ?? {}, x)).sort(sorter(orderBy))[0]; return r ? structuredClone(r) : null; }
  async findMany({ where, orderBy, take }: { where?: Rec; orderBy?: unknown; take?: number } = {}) { return this.rows.filter(x => matches(where ?? {}, x)).sort(sorter(orderBy)).slice(0, take ?? 1000).map(r => structuredClone(r)); }
  async count({ where }: { where?: Rec } = {}) { return this.rows.filter(x => matches(where ?? {}, x)).length; }
  async create({ data }: { data: Rec }) { const key = this.keys.map(k => data[k]).join("|"); if (this.keys.length && this.rows.some(r => this.keys.map(k => r[k]).join("|") === key)) throw new Error("unique"); const row = { ...this.defaults(), ...structuredClone(data) }; this.rows.push(row); return structuredClone(row); }
  async upsert({ where, create, update }: { where: Rec; create: Rec; update: Rec }) { const r = this.rows.find(x => this.same(x, where)); if (r) { Object.assign(r, structuredClone(update)); return structuredClone(r); } return this.create({ data: create }); }
  async update({ where, data }: { where: Rec; data: Rec }) { const r = this.rows.find(x => this.same(x, where)); if (!r) throw new Error("missing"); Object.assign(r, structuredClone(data)); return structuredClone(r); }
  async updateMany({ where, data }: { where: Rec; data: Rec }) { const hit = this.rows.filter(x => matches(where, x)); for (const r of hit) Object.assign(r, structuredClone(data)); return { count: hit.length }; }
  async deleteMany({ where }: { where?: Rec } = {}) { const keep = this.rows.filter(x => !matches(where ?? {}, x)); const n = this.rows.length - keep.length; this.rows = keep; return { count: n }; }
}

let counter = 0;
interface Tables { tcgAccount: Table; tcgCard: Table; tcgLog: Table; tcgMatch: Table; tcgPlayer: Table; tcgDaily: Table; tcgDuel: Table; tcgRating: Table; tcgQueue: Table; member: Table; character: Table; guildSettings: Table }
interface World { db: DuelDb; t: Tables; users: string[]; link: (user: string, linked: boolean) => void; settings: Rec[]; addUser: (id: string, opts?: { guild?: string; discord?: string; ageDays?: number; played?: number; name?: string }) => void; duel: (id: string) => Rec }

function world(userCount = 3): World {
  const t: Tables = {
    tcgAccount: new Table(() => ({ banked: 1, accruedAt: NOW, pityEpic: 0, pityLegendary: 0, dust: 0, packsOpened: 0, createdAt: NOW }), ["discordUserId"]),
    tcgCard: new Table(() => ({}), []),
    tcgLog: new Table(() => ({}), []),
    tcgMatch: new Table(() => ({}), []),
    tcgPlayer: new Table(() => ({ packProgress: 0, wins: 0, losses: 0, pveCleared: 0, pveRuns: 0, playedCounted: 0, tradingOff: false, tradeBanned: false }), ["discordUserId"]),
    tcgDaily: new Table(() => ({ played: 0, wins: 0, spells: 0, zones: 0, packsEarned: 0, questsDone: [], bossesPaid: [] }), ["discordUserId", "day"]),
    tcgDuel: new Table(() => ({ id: `d${++counter}`, status: "pending", season: "", seed: 0, actions: [], stateHash: "", winner: null, reason: null, spellsA: 0, zonesA: 0, spellsB: 0, zonesB: 0, counted: false, rated: false, flags: [], result: null, turnSeconds: 86400, turnDeadlineAt: null, expiresAt: null, lastActionAt: NOW, version: 0, createdAt: new Date(NOW.getTime() + counter), startedAt: null, finishedAt: null, state: null, deckA: null, deckB: null, clsB: null, guildId: null, live: false }), []),
    tcgRating: new Table(() => ({ rating: 1500, rd: 350, vol: 0.06, stars: 0, wins: 0, losses: 0, streak: 0, games: 0, version: 0 }), ["discordUserId", "season"]),
    tcgQueue: new Table(() => ({ joinedAt: NOW }), ["discordUserId"]),
    member: new Table(() => ({}), []),
    character: new Table(() => ({}), []),
    guildSettings: new Table(() => ({}), [])
  };
  const settings = t.guildSettings.rows;
  const snapshot = () => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, structuredClone(v.rows)]));
  const db = {
    ...t,
    // The member table answers with the guild it belongs to, like the real select.
    member: { findMany: async (args: { where?: Rec; select?: Rec; take?: number }) => (await t.member.findMany(args)).map(m => ({ ...m, guild: { discordId: m["discordId"], name: m["guildName"] } })) },
    character: { count: async ({ where }: { where: Rec }) => (await t.member.findMany({ where: { id: where["memberId"] } })).some(m => m["linked"] !== false) ? 1 : 0 },
    guildSettings: { findFirst: t.guildSettings.findFirst.bind(t.guildSettings), findMany: t.guildSettings.findMany.bind(t.guildSettings) },
    async $transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      const before = snapshot();
      try { return await fn(db); } catch (error) { for (const [k, rows] of Object.entries(before)) { const table = (t as unknown as Record<string, Table>)[k]!; table.rows.length = 0; table.rows.push(...(rows as Rec[])); } throw error; }
    }
  };
  const w: World = {
    db: db as unknown as DuelDb, t, users: [], settings,
    link: (user, linked) => { for (const m of t.member.rows) if (m["discordUserId"] === user) m["linked"] = linked; },
    addUser: (id, opts = {}) => {
      t.member.rows.push({ id: `mem-${id}-${opts.guild ?? "g1"}`, guildId: opts.guild ?? "g1", discordUserId: id, displayName: opts.name ?? `Name ${id}`, status: "ACTIVE", isTest: false, discordId: opts.discord ?? "123", guildName: opts.guild === "g2" ? "Second Guild" : "First Guild" });
      if (!t.tcgAccount.rows.some(a => a["discordUserId"] === id)) {
        t.tcgAccount.rows.push({ discordUserId: id, banked: 1, accruedAt: ago(DAY), pityEpic: 0, pityLegendary: 0, dust: 0, packsOpened: 0, createdAt: ago((opts.ageDays ?? 20) * DAY) });
        t.tcgPlayer.rows.push({ discordUserId: id, packProgress: 0, wins: 0, losses: 0, pveCleared: 0, pveRuns: 0, playedCounted: opts.played ?? 5, tradingOff: false, tradeBanned: false });
      }
      w.users.push(id);
    },
    duel: (id) => t.tcgDuel.rows.find(r => r["id"] === id)!
  };
  for (let i = 1; i <= userCount; i++) w.addUser(`u${i}`);
  return w;
}

/** Plays a duel to the end: the AI picks each move for whoever has to act, and the move goes through the member-facing service. */
async function playOut(w: World, id: string, a: string, b: string, startAt = NOW, limit = 4000): Promise<void> {
  let now = startAt;
  for (let i = 0; i < limit; i++) {
    const row = w.duel(id);
    if (row["status"] !== "active") return;
    const state = row["state"] as MatchState;
    const who = actor(state) === 0 ? a : b;
    now = new Date(now.getTime() + 1000);
    await submitDuelIntent(w.db, who, id, chooseAction(state, "normal"), now);
  }
  throw new Error("The duel did not finish.");
}

const startFriendly = async (w: World, a = "u1", b = "u2", opts: { live?: boolean; clsA?: string; clsB?: string; now?: Date } = {}) => {
  const now = opts.now ?? NOW;
  const sent = await challenge(w.db, a, { to: b, cls: opts.clsA ?? "warrior", ...(opts.live ? { live: true } : {}) }, allows, now);
  const started = await acceptChallenge(w.db, b, sent.duel.id, opts.clsB ?? "mage", allows, now, 4242);
  return { id: sent.duel.id, sent, started };
};

// ---- the maths ----

describe("Glicko-2", () => {
  it("reproduces the worked example from the Glicko-2 paper", () => {
    const next = glicko2({ rating: 1500, rd: 200, vol: 0.06 }, [{ rating: 1400, rd: 30, score: 1 }, { rating: 1550, rd: 100, score: 0 }, { rating: 1700, rd: 300, score: 0 }]);
    expect(next.rating).toBeCloseTo(1464.06, 1);
    expect(next.rd).toBeCloseTo(151.52, 1);
    expect(next.vol).toBeCloseTo(0.05999, 4);
  });

  it("moves a winner up and a loser down by the same pull against an equal opponent, and sharpens certainty", () => {
    const start = { rating: 1500, rd: 350, vol: 0.06 };
    const win = glicko2(start, [{ rating: 1500, rd: 350, score: 1 }]);
    const loss = glicko2(start, [{ rating: 1500, rd: 350, score: 0 }]);
    expect(win.rating).toBeGreaterThan(1500);
    expect(loss.rating).toBeLessThan(1500);
    expect(win.rating - 1500).toBeCloseTo(1500 - loss.rating, 3);
    expect(win.rd).toBeLessThan(350);
    // A beaten favourite loses more than a beaten underdog.
    const upset = glicko2({ rating: 1700, rd: 80, vol: 0.06 }, [{ rating: 1400, rd: 80, score: 0 }]);
    const expectedLoss = glicko2({ rating: 1700, rd: 80, vol: 0.06 }, [{ rating: 2000, rd: 80, score: 0 }]);
    expect(1700 - upset.rating).toBeGreaterThan(1700 - expectedLoss.rating);
  });

  it("only grows the deviation when nothing was played", () => {
    const idle = glicko2({ rating: 1600, rd: 60, vol: 0.06 }, []);
    expect(idle.rating).toBe(1600);
    expect(idle.rd).toBeGreaterThan(60);
  });
});

describe("stars and ranks", () => {
  it("names the ranks and divisions from the plan", () => {
    expect(rankOf(0).label).toBe("Initiate IV");
    expect(rankOf(2).label).toBe("Initiate IV");
    expect(rankOf(3).label).toBe("Initiate III");
    expect(rankOf(12).label).toBe("Adept IV");
    expect(rankOf(24).label).toBe("Veteran IV");
    expect(rankOf(28).label).toBe("Veteran III");
    expect(rankOf(40).label).toBe("Elite IV");
    expect(rankOf(59).label).toBe("Elite I");
    expect(LEGEND_STARS).toBe(60);
    expect(rankOf(60)).toMatchObject({ rank: "Legend", legend: true });
    expect(rankOf(500).legend).toBe(true);
  });

  it("pays +1 for a win and +2 from the third win in a row", () => {
    let s = { stars: 0, streak: 0 };
    const gains: number[] = [];
    for (let i = 0; i < 4; i++) { const r = applyStars(s.stars, s.streak, true); gains.push(r.delta); s = r; }
    expect(gains).toEqual([1, 1, 2, 2]);
    expect(applyStars(10, 5, false).streak).toBe(0);
  });

  it("protects Initiate and Adept from losing stars, and never drops a rank", () => {
    expect(applyStars(5, 0, false)).toMatchObject({ stars: 5, delta: 0 });
    expect(applyStars(20, 0, false)).toMatchObject({ stars: 20, delta: 0 });
    expect(applyStars(30, 0, false)).toMatchObject({ stars: 29, delta: -1 });
    expect(applyStars(24, 0, false)).toMatchObject({ stars: 24, delta: 0 }); // the first Veteran star is the floor
    expect(applyStars(40, 0, false)).toMatchObject({ stars: 40, delta: 0 });
    expect(applyStars(59, 2, true).stars).toBe(60); // capped at Legend
    expect(applyStars(60, 0, false).stars).toBe(60);
  });
});

describe("seasons", () => {
  it("are calendar months in UTC and the friendly week starts on Monday", () => {
    expect(seasonKey(new Date("2026-11-30T23:59:59Z"))).toBe("2026-11");
    expect(seasonKey(new Date("2026-12-01T00:00:00Z"))).toBe("2026-12");
    expect(weekStart(NOW).toISOString()).toBe("2026-11-16T00:00:00.000Z");
    expect(weekStart(new Date("2026-11-22T23:00:00Z")).toISOString()).toBe("2026-11-16T00:00:00.000Z");
    expect(weekStart(new Date("2026-11-23T00:00:00Z")).toISOString()).toBe("2026-11-23T00:00:00.000Z");
  });

  it("resets partly: the rating moves 40% back, certainty is partly lost, stars follow the rating", () => {
    const next = rolloverRating({ rating: 1700, rd: 60, vol: 0.05, stars: 50 });
    expect(next.rating).toBeCloseTo(1620, 5);
    expect(next.rd).toBeGreaterThan(60);
    expect(next.vol).toBe(0.05);
    expect(next.stars).toBe(startStars(1620));
    expect(next.stars).toBeLessThanOrEqual(23);
    expect(rolloverRating({ rating: 1400, rd: 50, vol: 0.06, stars: 3 }).stars).toBe(0);
  });

  it("widens the matching window with time in the queue", () => {
    expect(queueWindow(0)).toBe(75);
    expect(queueWindow(30_000)).toBe(150);
    expect(queueWindow(10 * 60_000)).toBe(600);
  });
});

// ---- friendly challenges ----

describe("friendly challenges", () => {
  it("sends a challenge to a guildmate and lists it for both", async () => {
    const w = world();
    const sent = await challenge(w.db, "u1", { to: "u2", cls: "warrior" }, allows, NOW);
    expect(sent.duel).toMatchObject({ kind: "friendly", status: "pending", direction: "outgoing", live: false, turnSeconds: TURN_SECONDS });
    expect(sent.view).toBeNull();
    expect(sent.duel.opponent).toMatchObject({ id: "u2", cls: null });
    expect(new Date(sent.duel.expiresAt!).getTime()).toBe(NOW.getTime() + CHALLENGE_TTL_MS);
    const theirs = await listDuels(w.db, "u2", NOW);
    expect(theirs.duels).toHaveLength(1);
    expect(theirs.duels[0]).toMatchObject({ direction: "incoming", status: "pending", opponent: { id: "u1", cls: "warrior" } });
  });

  it("applies the guild rule: same server, card game on, linked characters; never yourself", async () => {
    const w = world(2);
    w.addUser("outsider", { guild: "g2", discord: "999" });
    await expect(challenge(w.db, "u1", { to: "outsider", cls: "warrior" }, allows, NOW)).rejects.toMatchObject({ status: 403 });
    await expect(challenge(w.db, "u1", { to: "u1", cls: "warrior" }, allows, NOW)).rejects.toMatchObject({ status: 400 });
    await expect(challenge(w.db, "u1", { to: "u2", cls: "wizard" }, allows, NOW)).rejects.toMatchObject({ status: 400 });
    w.link("u2", false);
    await expect(challenge(w.db, "u1", { to: "u2", cls: "warrior" }, allows, NOW)).rejects.toMatchObject({ status: 403 });
    w.link("u2", true);
    w.settings.push({ guildId: "g1", tcgEnabled: false });
    await expect(challenge(w.db, "u1", { to: "u2", cls: "warrior" }, allows, NOW)).rejects.toMatchObject({ status: 403 });
    w.settings.length = 0;
    // A server the bot does not host does not count either.
    await expect(challenge(w.db, "u1", { to: "u2", cls: "warrior" }, () => false, NOW)).rejects.toMatchObject({ status: 403 });
    // The trading switch does not block a friendly challenge.
    w.settings.push({ guildId: "g1", tcgTradingEnabled: false });
    await expect(challenge(w.db, "u1", { to: "u2", cls: "warrior" }, allows, NOW)).resolves.toBeTruthy();
  });

  it("lets two members share a server even when each also belongs to another one", async () => {
    const w = world(2);
    w.addUser("u1", { guild: "g2", discord: "999" });
    w.addUser("x", { guild: "g2", discord: "999" });
    await expect(challenge(w.db, "u1", { to: "x", cls: "rogue" }, allows, NOW)).resolves.toBeTruthy();
    await expect(challenge(w.db, "u2", { to: "x", cls: "rogue" }, allows, NOW)).rejects.toMatchObject({ status: 403 });
  });

  it("refuses a second challenge between the same pair and caps open challenges", async () => {
    const w = world(2);
    await challenge(w.db, "u1", { to: "u2", cls: "warrior" }, allows, NOW);
    await expect(challenge(w.db, "u2", { to: "u1", cls: "mage" }, allows, NOW)).rejects.toMatchObject({ status: 409 });
    const big = world(MAX_OPEN_CHALLENGES + 2);
    for (let i = 2; i <= MAX_OPEN_CHALLENGES + 1; i++) await challenge(big.db, "u1", { to: `u${i}`, cls: "warrior" }, allows, NOW);
    await expect(challenge(big.db, "u1", { to: `u${MAX_OPEN_CHALLENGES + 2}`, cls: "warrior" }, allows, NOW)).rejects.toMatchObject({ status: 409 });
  });

  it("only the challenged member accepts; the match then starts with both classes and the right clocks", async () => {
    const w = world();
    const sent = await challenge(w.db, "u1", { to: "u2", cls: "warrior" }, allows, NOW);
    await expect(acceptChallenge(w.db, "u1", sent.duel.id, "mage", allows, NOW)).rejects.toMatchObject({ status: 403 });
    await expect(acceptChallenge(w.db, "u3", sent.duel.id, "mage", allows, NOW)).rejects.toMatchObject({ status: 404 });
    await expect(acceptChallenge(w.db, "u2", sent.duel.id, "wizard", allows, NOW)).rejects.toMatchObject({ status: 400 });
    const started = await acceptChallenge(w.db, "u2", sent.duel.id, "mage", allows, later(1000), 99);
    expect(started.duel).toMatchObject({ status: "active", direction: "match", seat: 1, you: { cls: "mage" }, opponent: { id: "u1", cls: "warrior" } });
    expect(started.view).not.toBeNull();
    expect(new Date(started.duel.turnDeadlineAt!).getTime()).toBe(later(1000).getTime() + TURN_SECONDS * 1000);
    await expect(acceptChallenge(w.db, "u2", sent.duel.id, "mage", allows, NOW)).rejects.toMatchObject({ status: 409 });
  });

  it("can be declined by the challenged member and taken back by the challenger", async () => {
    const w = world();
    const a = await challenge(w.db, "u1", { to: "u2", cls: "warrior" }, allows, NOW);
    expect((await declineChallenge(w.db, "u2", a.duel.id, NOW)).duel.status).toBe("declined");
    await expect(acceptChallenge(w.db, "u2", a.duel.id, "mage", allows, NOW)).rejects.toMatchObject({ status: 409 });
    const b = await challenge(w.db, "u1", { to: "u2", cls: "warrior" }, allows, NOW);
    expect((await declineChallenge(w.db, "u1", b.duel.id, NOW)).duel.status).toBe("cancelled");
    await expect(declineChallenge(w.db, "u3", b.duel.id, NOW)).rejects.toMatchObject({ status: 404 });
  });

  it("expires: 24 hours for an asynchronous challenge, 2 minutes for a live one", async () => {
    const w = world();
    const slow = await challenge(w.db, "u1", { to: "u2", cls: "warrior" }, allows, NOW);
    const fast = await challenge(w.db, "u1", { to: "u3", cls: "warrior", live: true }, allows, NOW);
    expect(fast.duel).toMatchObject({ live: true, turnSeconds: LIVE_TURN_SECONDS });
    expect(new Date(fast.duel.expiresAt!).getTime()).toBe(NOW.getTime() + LIVE_CHALLENGE_TTL_MS);
    const soon = later(LIVE_CHALLENGE_TTL_MS + 1000);
    expect((await getDuel(w.db, "u3", fast.duel.id, soon)).duel.status).toBe("expired");
    expect((await getDuel(w.db, "u2", slow.duel.id, soon)).duel.status).toBe("pending");
    // Accepting after the expiry answers "expired" and starts nothing.
    const late = await acceptChallenge(w.db, "u2", slow.duel.id, "mage", allows, later(CHALLENGE_TTL_MS + 1000));
    expect(late.duel.status).toBe("expired");
    expect(late.view).toBeNull();
    expect(w.duel(slow.duel.id)["state"]).toBeNull();
  });

  it("lists the guildmates a member can challenge", async () => {
    const w = world(3);
    w.link("u3", false);
    expect((await duelPartners(w.db, "u1", allows)).partners.map(p => p.discordUserId)).toEqual(["u2"]);
    expect((await duelPartners(w.db, "u1", () => false)).partners).toEqual([]);
  });
});

// ---- two seats ----

describe("a duel between two members", () => {
  it("starts with one shared seed and replays from the log to the stored state", async () => {
    const w = world();
    const { id } = await startFriendly(w);
    await playOut(w, id, "u1", "u2");
    const row = w.duel(id);
    expect(row["status"]).toBe("done");
    expect(row["winner"]).not.toBeNull();
    const replayed = replayDuel(row as never);
    expect(stateHash(replayed)).toBe(row["stateHash"]);
    expect(stateHash(replayed)).toBe(stateHash(row["state"] as MatchState));
    expect((row["actions"] as unknown[]).length).toBeGreaterThan(5);
    // Everything is on the record: the same seed was used for both seats.
    expect(row["seed"]).toBe(4242);
  });

  it("keeps each seat's hidden information from the other, in every response", async () => {
    const w = world();
    const { id } = await startFriendly(w);
    for (let i = 0; i < 12; i++) {
      const row = w.duel(id);
      if (row["status"] !== "active") break;
      const state = row["state"] as MatchState;
      const seat = actor(state);
      const seen = await Promise.all([getDuel(w.db, "u1", id, NOW), getDuel(w.db, "u2", id, NOW)]);
      for (const [index, response] of seen.entries()) {
        expect(Object.keys(response).sort()).toEqual(["duel", "events", "ranked", "rewards", "view"]);
        const view = response.view!;
        const mine = state.players[index as 0 | 1], theirs = state.players[(1 - index) as 0 | 1];
        expect(view.me.hand).toEqual(mine.hand);
        expect(view.me.deckCount).toBe(mine.deck.length);
        expect(view.opponent.handCount).toBe(theirs.hand.length);
        expect(view.opponent.deckCount).toBe(theirs.deck.length);
        expect(view.opponent).not.toHaveProperty("hand");
        expect(view.opponent).not.toHaveProperty("deck");
        expect(view.me).not.toHaveProperty("deck");
        const text = JSON.stringify(response);
        expect(text).not.toContain("\"rng\"");
        expect(text).not.toContain("deckA");
        expect(text).not.toContain("\"seed\"");
        expect(response.view!.yourTurn).toBe(index === seat);
        expect(response.view!.legal.length > 0).toBe(index === seat);
        // The same board from both seats, mirrored.
        expect(view.opponent.hp).toBe(seen[1 - index]!.view!.me.hp);
      }
      await submitDuelIntent(w.db, seat === 0 ? "u1" : "u2", id, chooseAction(state, "normal"), NOW);
    }
  });

  it("refuses moves out of turn, illegal moves and moves from non-players, and changes nothing", async () => {
    const w = world();
    const { id } = await startFriendly(w);
    const state = w.duel(id)["state"] as MatchState;
    const mover = actor(state) === 0 ? "u1" : "u2", waiter = mover === "u1" ? "u2" : "u1";
    const before = JSON.stringify(w.duel(id));
    await expect(submitDuelIntent(w.db, waiter, id, { t: "end" }, NOW)).rejects.toMatchObject({ status: 409 });
    await expect(submitDuelIntent(w.db, mover, id, { t: "play", hand: 99 }, NOW)).rejects.toMatchObject({ status: 400 });
    await expect(submitDuelIntent(w.db, "u3", id, { t: "end" }, NOW)).rejects.toMatchObject({ status: 404 });
    await expect(getDuel(w.db, "u3", id, NOW)).rejects.toMatchObject({ status: 404 });
    expect(JSON.stringify(w.duel(id))).toBe(before);
  });

  it("a finished friendly duel pays only the daily quest credit, once, and counts for the week board", async () => {
    const w = world();
    const { id } = await startFriendly(w);
    await playOut(w, id, "u1", "u2");
    const row = w.duel(id);
    const winnerId = row["winner"] === 0 ? "u1" : "u2", loserId = winnerId === "u1" ? "u2" : "u1";
    expect(row).toMatchObject({ kind: "friendly", rated: false, counted: true });
    const result = row["result"] as { rewards: { won: boolean; packs: number; dust: number }; ranked: unknown }[];
    expect(result[0]!.ranked).toBeNull();
    // No pack step for the win itself: only quests can move progress, and there are no ratings.
    const winnerStats = w.t.tcgPlayer.rows.find(r => r["discordUserId"] === winnerId)!;
    const loserStats = w.t.tcgPlayer.rows.find(r => r["discordUserId"] === loserId)!;
    expect(winnerStats["wins"]).toBe(1);
    expect(loserStats["losses"]).toBe(1);
    expect(winnerStats["playedCounted"]).toBe(6);
    const day = w.t.tcgDaily.rows.find(r => r["discordUserId"] === winnerId)!;
    expect(day["played"]).toBe(1);
    expect(day["wins"]).toBe(1);
    const steps = (day["questsDone"] as string[]).length;
    expect((winnerStats["packProgress"] as number) + (day["packsEarned"] as number) * 3).toBe(steps);
    expect(w.t.tcgRating.rows).toHaveLength(0);
    // Finished means finished: no second payment, no more moves.
    const logs = w.t.tcgLog.rows.length;
    await expect(concedeDuel(w.db, "u1", id, later(1000))).rejects.toMatchObject({ status: 409 });
    await expect(submitDuelIntent(w.db, "u1", id, { t: "end" }, later(1000))).rejects.toMatchObject({ status: 409 });
    await getDuel(w.db, "u1", id, later(2 * TURN_SECONDS * 1000));
    expect(w.t.tcgLog.rows).toHaveLength(logs);
  });

  it("can be conceded at any time by either player, and that is a loss", async () => {
    const w = world();
    const { id } = await startFriendly(w);
    const state = w.duel(id)["state"] as MatchState;
    const waiter = actor(state) === 0 ? "u2" : "u1";
    const done = await concedeDuel(w.db, waiter, id, later(5000));
    expect(done.duel.status).toBe("lost");
    expect(done.duel.reason).toBe("concede");
    expect(done.view!.winner).toBe(1);
    const other = await getDuel(w.db, waiter === "u1" ? "u2" : "u1", id, later(6000));
    expect(other.duel.status).toBe("won");
    expect(other.view!.winner).toBe(0);
    expect(w.duel(id)["winner"]).toBe(waiter === "u1" ? 1 : 0);
    expect(w.duel(id)["flags"]).toContain("early-concede");
  });
});

describe("turn clocks and forfeits", () => {
  it("forfeits the player whose turn it is once the clock runs out, whoever looks first, and only once", async () => {
    const w = world();
    const { id } = await startFriendly(w);
    const state = w.duel(id)["state"] as MatchState;
    const stuck = actor(state) === 0 ? "u1" : "u2", other = stuck === "u1" ? "u2" : "u1";
    expect((await getDuel(w.db, other, id, later(TURN_SECONDS * 1000 - 1000))).duel.status).toBe("active");
    const settled = await getDuel(w.db, other, id, later(TURN_SECONDS * 1000 + 1000));
    expect(settled.duel).toMatchObject({ status: "won", reason: "timeout" });
    const mine = await getDuel(w.db, stuck, id, later(TURN_SECONDS * 1000 + 2000));
    expect(mine.duel).toMatchObject({ status: "lost", reason: "timeout" });
    const logs = w.t.tcgLog.rows.length, version = w.duel(id)["version"];
    await getDuel(w.db, other, id, later(3 * TURN_SECONDS * 1000));
    expect(w.t.tcgLog.rows).toHaveLength(logs);
    expect(w.duel(id)["version"]).toBe(version);
  });

  it("a move sent after the clock ran out is not played: the late player forfeits", async () => {
    const w = world();
    const { id } = await startFriendly(w);
    const state = w.duel(id)["state"] as MatchState;
    const stuck = actor(state) === 0 ? "u1" : "u2";
    const res = await submitDuelIntent(w.db, stuck, id, chooseAction(state, "normal"), later(TURN_SECONDS * 1000 + 5000));
    expect(res.duel).toMatchObject({ status: "lost", reason: "timeout" });
    expect((w.duel(id)["actions"] as unknown[]).slice(-1)[0]).toEqual({ t: "concede", p: stuck === "u1" ? 0 : 1 });
  });

  it("a live match runs a 60 second clock that restarts after every move", async () => {
    const w = world();
    const { id } = await startFriendly(w, "u1", "u2", { live: true });
    expect(w.duel(id)["turnSeconds"]).toBe(LIVE_TURN_SECONDS);
    const state = w.duel(id)["state"] as MatchState;
    const mover = actor(state) === 0 ? "u1" : "u2";
    const t1 = later(50_000);
    const moved = await submitDuelIntent(w.db, mover, id, chooseAction(state, "normal"), t1);
    expect(new Date(moved.duel.turnDeadlineAt!).getTime()).toBe(t1.getTime() + 60_000);
    expect((await getDuel(w.db, "u1", id, later(100_000))).duel.status).toBe("active");
    expect((await getDuel(w.db, "u1", id, later(50_000 + 61_000))).duel.status).not.toBe("active");
  });

  it("settles overdue matches and expired challenges when the list is read", async () => {
    const w = world();
    const { id } = await startFriendly(w);
    const pending = await challenge(w.db, "u1", { to: "u3", cls: "rogue", live: true }, allows, NOW);
    const out = await listDuels(w.db, "u1", later(TURN_SECONDS * 1000 + 1000));
    expect(out.duels.find(d => d.id === id)!.status).toMatch(/won|lost/);
    expect(out.duels.find(d => d.id === pending.duel.id)!.status).toBe("expired");
  });
});

describe("reconnecting", () => {
  it("a poll returns at once when the version moved on, and waits (then reports no change) when it did not", async () => {
    const w = world();
    const { id } = await startFriendly(w);
    const state = w.duel(id)["state"] as MatchState;
    const mover = actor(state) === 0 ? "u1" : "u2", waiter = mover === "u1" ? "u2" : "u1";
    const slept: number[] = [];
    const sleep = async (ms: number) => { slept.push(ms); };
    const idle = await pollDuel(w.db, waiter, id, 1, { waitMs: 3000, stepMs: 1000, sleep, now: () => NOW });
    expect(idle.changed).toBe(false);
    expect(slept).toEqual([1000, 1000, 1000]);
    // Resuming with an old version returns the current view straight away.
    const stale = await pollDuel(w.db, waiter, id, 0, { waitMs: 3000, sleep, now: () => NOW });
    expect(stale.changed).toBe(true);
    expect(stale.view!.yourTurn).toBe(false);
    expect(slept).toHaveLength(3);
    await submitDuelIntent(w.db, mover, id, chooseAction(state, "normal"), NOW);
    const moved = await pollDuel(w.db, waiter, id, 1, { waitMs: 3000, sleep, now: () => NOW });
    expect(moved.changed).toBe(true);
    expect(moved.duel.version).toBe(2);
  });
});

// ---- ranked ----

const rate = (w: World, user: string, season: string, over: Rec = {}) => w.t.tcgRating.rows.push({ discordUserId: user, season, rating: 1500, rd: 350, vol: 0.06, stars: 0, wins: 0, losses: 0, streak: 0, games: 0, version: 0, ...over });

describe("the ranked waiting room", () => {
  it("makes you wait, then pairs you across servers with the first player in seat 0", async () => {
    const w = world(1);
    w.addUser("far", { guild: "g2", discord: "999" });
    const first = await joinRanked(w.db, "u1", "warrior", NOW, 11);
    expect(first.matched).toBeNull();
    expect(first.queue).toMatchObject({ cls: "warrior" });
    expect(first.season).toBe("2026-11");
    expect(first.standing.rank.label).toBe("Initiate IV");
    const second = await joinRanked(w.db, "far", "priest", later(1000), 12);
    expect(second.matched).not.toBeNull();
    expect(second.matched!.duel).toMatchObject({ kind: "ranked", status: "active", season: "2026-11", seat: 1, opponent: { id: "u1", cls: "warrior" } });
    expect(second.queue).toBeNull();
    const mine = await rankedStatus(w.db, "u1", later(2000));
    expect(mine.queue).toBeNull();
    expect(mine.active).toHaveLength(1);
    expect(mine.active[0]).toMatchObject({ kind: "ranked", seat: 0 });
    expect(w.t.tcgQueue.rows).toHaveLength(0);
    expect(w.duel(second.matched!.duel.id)).toMatchObject({ userA: "u1", userB: "far", clsA: "warrior", clsB: "priest" });
  });

  it("matches by rating: far-apart players wait, and the window widens with time", async () => {
    const w = world(2);
    rate(w, "u1", "2026-11", { rating: 1900, rd: 60, games: 10 });
    rate(w, "u2", "2026-11", { rating: 1500, rd: 60, games: 10 });
    await joinRanked(w.db, "u1", "warrior", NOW, 1);
    const near = await joinRanked(w.db, "u2", "mage", later(1000), 2);
    expect(near.matched).toBeNull();
    // 400 points apart needs a 400 window: 75 + 25 * 13 = 400 after 130 seconds.
    expect((await rankedStatus(w.db, "u1", later(60_000), 3)).matched).toBeNull();
    const widened = await rankedStatus(w.db, "u1", later(135_000), 4);
    expect(widened.matched).not.toBeNull();
  });

  it("prefers the closest rating among those inside the window, and the older entry takes seat 0", async () => {
    const w = world(3);
    rate(w, "u2", "2026-11", { rating: 1700, games: 3 });
    rate(w, "u3", "2026-11", { rating: 1560, games: 3 });
    // Both have been waiting a while, so a 200-point gap is inside the window, but they are too far apart to pair with each other early on.
    await joinRanked(w.db, "u2", "mage", ago(8 * 60_000), 1);
    await joinRanked(w.db, "u3", "priest", ago(8 * 60_000 - 1000), 2);
    expect(w.t.tcgQueue.rows).toHaveLength(2);
    const res = await joinRanked(w.db, "u1", "rogue", NOW, 3);
    expect(res.matched!.duel.opponent.id).toBe("u3");
    expect(w.duel(res.matched!.duel.id)).toMatchObject({ userA: "u3", userB: "u1" });
    expect(w.t.tcgQueue.rows.map(r => r["discordUserId"])).toEqual(["u2"]);
  });

  it("leaves the room, drops stale entries and refuses a second wait while at the match cap", async () => {
    const w = world(2);
    await joinRanked(w.db, "u1", "warrior", NOW, 1);
    expect(await leaveRanked(w.db, "u1")).toEqual({ left: true });
    expect(await leaveRanked(w.db, "u1")).toEqual({ left: false });
    await joinRanked(w.db, "u1", "warrior", NOW, 1);
    const late = await joinRanked(w.db, "u2", "mage", later(QUEUE_TTL_MS + 1000), 2);
    expect(late.matched).toBeNull();
    expect(w.t.tcgQueue.rows.map(r => r["discordUserId"])).toEqual(["u2"]);
    await expect(joinRanked(w.db, "u2", "wizard", NOW)).rejects.toMatchObject({ status: 400 });
    for (let i = 0; i < MAX_ACTIVE_DUELS; i++) w.t.tcgDuel.rows.push({ id: `x${i}`, kind: "ranked", status: "active", userA: "u2", userB: `z${i}` });
    await expect(joinRanked(w.db, "u2", "mage", NOW)).rejects.toMatchObject({ status: 409 });
  });

  it("does not pair a member with themselves", async () => {
    const w = world(1);
    await joinRanked(w.db, "u1", "warrior", NOW, 1);
    const again = await joinRanked(w.db, "u1", "mage", later(1000), 2);
    expect(again.matched).toBeNull();
    expect(again.queue!.cls).toBe("mage");
    expect(w.t.tcgQueue.rows).toHaveLength(1);
  });
});

describe("a ranked match", () => {
  const rankedPair = async (w: World, a = "u1", b = "u2", at = NOW) => {
    await joinRanked(w.db, a, "warrior", at, 7);
    const res = await joinRanked(w.db, b, "mage", new Date(at.getTime() + 1000), 8);
    if (res.matched) return res.matched.duel.id;
    // Ratings that moved apart need the window to widen: wait in the room, then ask again.
    const widened = await rankedStatus(w.db, a, new Date(at.getTime() + 10 * 60_000), 8);
    return widened.matched!.duel.id;
  };

  it("pays stars and rating to the winner, protects the loser at Initiate, and grants the match rewards", async () => {
    const w = world();
    const id = await rankedPair(w);
    await playOut(w, id, "u1", "u2", later(2000));
    const row = w.duel(id);
    expect(row).toMatchObject({ status: "done", rated: true, counted: true });
    const win = (row["winner"] === 0 ? "u1" : "u2"), lose = win === "u1" ? "u2" : "u1";
    const rw = w.t.tcgRating.rows.find(r => r["discordUserId"] === win)!, rl = w.t.tcgRating.rows.find(r => r["discordUserId"] === lose)!;
    expect(rw).toMatchObject({ stars: 1, wins: 1, games: 1, streak: 1, season: "2026-11", version: 1 });
    expect(rw["rating"] as number).toBeGreaterThan(1500);
    expect(rl).toMatchObject({ stars: 0, losses: 1, games: 1, streak: 0 });
    expect(rl["rating"] as number).toBeLessThan(1500);
    expect(rw["rd"] as number).toBeLessThan(350);
    // Each member is told what changed for them.
    const view = await getDuel(w.db, win, id, later(9_000_000));
    expect(view.ranked).toMatchObject({ rated: true, starsDelta: 1, stars: 1, season: "2026-11" });
    expect(view.ranked!.rank.label).toBe("Initiate IV");
    expect(view.rewards).toMatchObject({ won: true });
    // The win counts toward a pack (an eligible account) in addition to any quests: more progress than a friendly win would give.
    const day = w.t.tcgDaily.rows.find(r => r["discordUserId"] === win)!;
    const winnerStats = w.t.tcgPlayer.rows.find(r => r["discordUserId"] === win)!;
    expect((day["questsDone"] as string[]).length + 1).toBe((winnerStats["packProgress"] as number) + (day["packsEarned"] as number) * 3);
    const loserDay = w.t.tcgDaily.rows.find(r => r["discordUserId"] === lose)!;
    const loserStats = w.t.tcgPlayer.rows.find(r => r["discordUserId"] === lose)!;
    expect((loserDay["questsDone"] as string[]).length).toBe((loserStats["packProgress"] as number) + (loserDay["packsEarned"] as number) * 3);
  });

  it("gives no pack credit for a ranked win to a collection under 7 days old, but quests still count", async () => {
    const w = world(1);
    w.addUser("new", { ageDays: 2, played: 0 });
    const id = await rankedPair(w, "u1", "new");
    // Let the new account win by conceding from u1.
    await concedeDuel(w.db, "u1", id, later(3000));
    const row = w.duel(id);
    expect(row["winner"]).toBe(1);
    const stats = w.t.tcgPlayer.rows.find(r => r["discordUserId"] === "new")!;
    expect(stats["wins"]).toBe(1);
    expect(stats["packProgress"]).toBe(0);
    expect(w.t.tcgRating.rows.find(r => r["discordUserId"] === "new")!["stars"]).toBe(1);
  });

  it("stars: three wins in a row pay +2 on the third; a loss above Adept costs one star", async () => {
    const w = world();
    rate(w, "u1", "2026-11", { stars: 2, streak: 2, games: 2 });
    rate(w, "u2", "2026-11", { stars: 30, streak: 0, games: 9 });
    const id = await rankedPair(w);
    // u1 queued first so it holds seat 0: concede from u2 to hand u1 the win.
    await concedeDuel(w.db, "u2", id, later(3000));
    const a = w.t.tcgRating.rows.find(r => r["discordUserId"] === "u1")!, b = w.t.tcgRating.rows.find(r => r["discordUserId"] === "u2")!;
    expect(a).toMatchObject({ stars: 4, streak: 3 });
    expect(b).toMatchObject({ stars: 29, streak: 0 });
  });

  it("flags an early concede for the officers", async () => {
    const w = world();
    const id = await rankedPair(w);
    await concedeDuel(w.db, "u1", id, later(3000));
    expect(w.duel(id)["flags"]).toContain("early-concede");
    expect(w.duel(id)["rated"]).toBe(true);
  });

  it("changes no rating after the third ranked match between the same two in 24 hours, and flags it", async () => {
    const w = world();
    const winners: number[] = [];
    for (let i = 0; i < 4; i++) {
      const at = new Date(NOW.getTime() + i * 3_600_000);
      const id = await rankedPair(w, "u1", "u2", at);
      await concedeDuel(w.db, "u2", id, new Date(at.getTime() + 5000));
      const row = w.duel(id);
      winners.push(row["rated"] ? 1 : 0);
      if (i === 3) {
        expect(row["flags"]).toContain("repeat-pair");
        const view = await getDuel(w.db, "u1", id, new Date(at.getTime() + 6000));
        expect(view.ranked).toMatchObject({ rated: false, starsDelta: 0 });
        expect(view.rewards!.packs).toBe(0);
      }
    }
    expect(winners).toEqual([1, 1, 1, 0]);
    const rating = w.t.tcgRating.rows.find(r => r["discordUserId"] === "u1")!;
    expect(rating["games"]).toBe(3);
    // A day later they may rate again.
    const later1 = new Date(NOW.getTime() + 30 * 3_600_000);
    const id = await rankedPair(w, "u1", "u2", later1);
    await concedeDuel(w.db, "u2", id, new Date(later1.getTime() + 5000));
    expect(w.duel(id)["rated"]).toBe(true);
  });

  it("a match belongs to the season it started in, and a new season starts from the partial reset", async () => {
    const w = world();
    rate(w, "u1", "2026-11", { rating: 1700, rd: 60, stars: 50, games: 40, wins: 30, losses: 10 });
    const eve = new Date(Date.UTC(2026, 10, 30, 23, 0, 0));
    const id = await rankedPair(w, "u1", "u2", eve);
    await concedeDuel(w.db, "u2", id, new Date(Date.UTC(2026, 11, 1, 0, 30, 0)));
    expect(w.duel(id)["season"]).toBe("2026-11");
    expect(w.t.tcgRating.rows.filter(r => r["season"] === "2026-12")).toHaveLength(0);
    const nov = w.t.tcgRating.rows.find(r => r["discordUserId"] === "u1" && r["season"] === "2026-11")!;
    expect(nov["games"]).toBe(41);
    // In December the next join starts from last season's final rating, partly reset.
    const dec = new Date(Date.UTC(2026, 11, 2, 12, 0, 0));
    const status = await joinRanked(w.db, "u1", "warrior", dec, 1);
    const row = w.t.tcgRating.rows.find(r => r["discordUserId"] === "u1" && r["season"] === "2026-12")!;
    expect(row["rating"] as number).toBeCloseTo(1500 + ((nov["rating"] as number) - 1500) * 0.6, 6);
    expect(row["stars"]).toBe(startStars(row["rating"] as number));
    expect(row["games"]).toBe(0);
    expect(status.season).toBe("2026-12");
    expect(status.standing.stars).toBe(row["stars"]);
    expect(new Date(status.seasonEndsAt).toISOString()).toBe("2027-01-01T00:00:00.000Z");
    // A member who never played before starts fresh.
    expect((await joinRanked(w.db, "u3", "rogue", dec, 2)).standing).toMatchObject({ stars: 0, games: 0 });
  });

  it("an overdue ranked turn is a forfeit and still rates", async () => {
    const w = world();
    const id = await rankedPair(w);
    const stuck = actor(w.duel(id)["state"] as MatchState) === 0 ? "u1" : "u2";
    const done = await getDuel(w.db, stuck === "u1" ? "u2" : "u1", id, later(TURN_SECONDS * 1000 + 10_000));
    expect(done.duel).toMatchObject({ status: "won", reason: "timeout", rated: true });
    expect(w.t.tcgRating.rows.find(r => r["discordUserId"] === (stuck === "u1" ? "u2" : "u1"))!["wins"]).toBe(1);
  });
});

// ---- leaderboards ----

describe("leaderboards", () => {
  it("orders the global ladder by stars then hidden rating, numbers Legend, and shows you when outside the top", async () => {
    const w = world(1);
    w.addUser("far", { guild: "g2", discord: "999" });
    for (let i = 0; i < 4; i++) w.addUser(`p${i}`);
    rate(w, "p0", "2026-11", { stars: 60, rating: 1900, games: 9, wins: 9 });
    rate(w, "p1", "2026-11", { stars: 60, rating: 2000, games: 9, wins: 9 });
    rate(w, "p2", "2026-11", { stars: 31, rating: 1600, games: 9, wins: 5, losses: 4 });
    rate(w, "far", "2026-11", { stars: 31, rating: 1650, games: 9, wins: 5, losses: 4 });
    rate(w, "u1", "2026-11", { stars: 4, rating: 1510, games: 2, wins: 2 });
    rate(w, "p3", "2026-11", { stars: 20, rating: 1500, games: 0 }); // nothing played: hidden
    rate(w, "p2", "2026-10", { stars: 59, rating: 1800, games: 50 });
    const board = await leaderboard(w.db, "u1", { scope: "global" }, allows, NOW);
    const list = board.boards[0]!.entries;
    expect(list.map(e => e.name)).toEqual(["Name p1", "Name p0", "Name far", "Name p2", "Name u1"]);
    expect(list[0]).toMatchObject({ position: 1, legend: true, label: "Legend" });
    expect(list[4]).toMatchObject({ you: true, position: 5 });
    expect(board.boards[0]!.you).toMatchObject({ position: 5, you: true });
    expect(JSON.stringify(board)).not.toContain("\"rating\"");
    // Last season is its own list.
    const old = await leaderboard(w.db, "u1", { scope: "global", season: "2026-10" }, allows, NOW);
    expect(old.boards[0]!.entries.map(e => e.name)).toEqual(["Name p2"]);
    expect(old.boards[0]!.you).toBeNull();
    expect((await leaderboard(w.db, "u1", { scope: "global", season: "nope" }, allows, NOW)).season).toBe("2026-11");
  });

  it("the guild ladder only lists members of your own server", async () => {
    const w = world(1);
    w.addUser("far", { guild: "g2", discord: "999" });
    w.addUser("mate");
    rate(w, "far", "2026-11", { stars: 50, games: 9 });
    rate(w, "mate", "2026-11", { stars: 3, games: 9 });
    rate(w, "u1", "2026-11", { stars: 1, games: 1 });
    const board = await leaderboard(w.db, "u1", { scope: "guild" }, allows, NOW);
    expect(board.boards).toHaveLength(1);
    expect(board.boards[0]!.title).toBe("First Guild");
    expect(board.boards[0]!.entries.map(e => e.name)).toEqual(["Name mate", "Name u1"]);
    expect((await leaderboard(w.db, "u1", { scope: "guild" }, () => false, NOW)).boards).toEqual([]);
  });

  it("the friendly board counts this week's counted wins in your server, at most 3 a week against one opponent", async () => {
    const w = world(3);
    const week = weekStart(NOW);
    const done = (a: string, b: string, winner: 0 | 1, over: Rec = {}) => w.t.tcgDuel.rows.push({ id: `f${++counter}`, kind: "friendly", status: "done", guildId: "g1", userA: a, userB: b, winner, counted: true, finishedAt: new Date(week.getTime() + 3_600_000), ...over });
    for (let i = 0; i < 5; i++) done("u1", "u2", 0); // five wins over u2: three count
    done("u2", "u3", 0); // u2 beats u3
    done("u3", "u1", 0, { counted: false }); // left early: ignored
    done("u3", "u1", 0, { finishedAt: new Date(week.getTime() - 1000) }); // last week: ignored
    done("u3", "u1", 0, { guildId: "g2" }); // another server: ignored
    done("u1", "u3", 0, { winner: 2 }); // draw: ignored
    const board = await leaderboard(w.db, "u2", { scope: "friendly" }, allows, NOW);
    expect(board.weekStart).toBe(week.toISOString());
    const entries = board.boards[0]!.entries;
    expect(entries.map(e => [e.name, e.wins, e.losses])).toEqual([["Name u1", 3, 0], ["Name u2", 1, 5], ["Name u3", 0, 1]]);
    expect(board.boards[0]!.you).toMatchObject({ name: "Name u2", position: 2 });
  });

  it("a finished friendly duel lands on the board", async () => {
    const w = world();
    const { id } = await startFriendly(w);
    await playOut(w, id, "u1", "u2");
    const winner = w.duel(id)["winner"] === 0 ? "Name u1" : "Name u2";
    const board = await leaderboard(w.db, "u3", { scope: "friendly" }, allows, later(60_000));
    expect(board.boards[0]!.entries[0]).toMatchObject({ name: winner, wins: 1, losses: 0 });
  });
});

describe("the ladder keeps the maths and the stored shape honest", () => {
  it("a draw is 0.5 for both and changes no stars", async () => {
    // Exercised through the pure parts: an equal draw between equals moves nobody.
    const draw = glicko2({ rating: 1500, rd: 200, vol: 0.06 }, [{ rating: 1500, rd: 200, score: 0.5 }]);
    expect(draw.rating).toBeCloseTo(1500, 6);
    expect(draw.rd).toBeLessThan(200);
  });
});
