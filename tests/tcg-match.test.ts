import { describe, expect, it } from "vitest";
import { actor, legalActions, stateHash } from "../src/services/tcg-engine.js";
import type { Action, MatchState } from "../src/services/tcg-engine-types.js";
import { concedeMatch, getMatch, listMatches, MAX_ACTIVE_MATCHES, parseIntent, playerView, pveProgress, replayRow, startMatch, submitIntent, TURN_SECONDS, type MatchResponse } from "../src/services/tcg-match.js";
import { TcgError } from "../src/services/tcg-store.js";
import { ACCRUAL_MS } from "../src/services/tcg.js";

// An in-memory database with the same compare-and-set behaviour as the real one. A failed transaction rolls everything back.
interface Rec {
  id?: string; discordUserId?: string; createdAt?: Date; state?: unknown; seed?: unknown; stateHash?: unknown; actions?: unknown; status?: unknown; kind?: unknown; rewardedAt?: unknown;
  banked?: unknown; dust?: unknown; packProgress?: unknown; pveCleared?: unknown;
  [key: string]: unknown
}
function fakeDb() {
  const matches = new Map<string, Rec>();
  const players = new Map<string, Rec>();
  const dailies = new Map<string, Rec>();
  const accounts = new Map<string, Rec>();
  const logs: Rec[] = [];
  let counter = 0;
  const match = (where: Rec, row: Rec) => Object.entries(where).every(([k, v]) => row[k] === v);
  const tx = {
    tcgMatch: {
      create: async ({ data }: { data: Rec }) => { const row = { id: `m${++counter}`, status: "active", reason: null, spellsCast: 0, zonesPlayed: 0, version: 0, rewardedAt: null, rewardDust: 0, rewardPacks: 0, createdAt: new Date(Date.UTC(2026, 10, 10, 12, 0, counter)), finishedAt: null, ...data }; matches.set(row.id as string, row); return structuredClone(row); },
      findFirst: async ({ where }: { where: Rec }) => { const row = [...matches.values()].find(r => match(where, r)); return row ? structuredClone(row) : null; },
      findMany: async ({ where, take }: { where: Rec; take?: number }) => [...matches.values()].filter(r => match(where, r)).sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime()).slice(0, take ?? 100).map(r => structuredClone(r)),
      count: async ({ where }: { where: Rec }) => [...matches.values()].filter(r => match(where, r)).length,
      updateMany: async ({ where, data }: { where: Rec; data: Rec }) => { const row = matches.get(where.id as string); if (!row || !match(where, row)) return { count: 0 }; Object.assign(row, structuredClone(data)); return { count: 1 }; }
    },
    tcgPlayer: {
      findUnique: async ({ where }: { where: { discordUserId: string } }) => { const row = players.get(where.discordUserId); return row ? { ...row } : null; },
      upsert: async ({ where, create, update }: { where: { discordUserId: string }; create: Rec; update: Rec }) => { const row = players.get(where.discordUserId); if (row) Object.assign(row, update); else players.set(where.discordUserId, { ...create }); }
    },
    tcgDaily: {
      findUnique: async ({ where }: { where: { discordUserId_day: { discordUserId: string; day: string } } }) => { const row = dailies.get(`${where.discordUserId_day.discordUserId}|${where.discordUserId_day.day}`); return row ? structuredClone(row) : null; },
      upsert: async ({ where, create, update }: { where: { discordUserId_day: { discordUserId: string; day: string } }; create: Rec; update: Rec }) => { const key = `${where.discordUserId_day.discordUserId}|${where.discordUserId_day.day}`; const row = dailies.get(key); if (row) Object.assign(row, structuredClone(update)); else dailies.set(key, structuredClone(create)); }
    },
    tcgAccount: {
      findUnique: async ({ where }: { where: { discordUserId: string } }) => { const row = accounts.get(where.discordUserId); return row ? { ...row } : null; },
      create: async ({ data }: { data: Rec }) => { const row: Rec = { banked: 1, pityEpic: 0, pityLegendary: 0, dust: 0, packsOpened: 0, ...data }; accounts.set(row.discordUserId as string, row); return { ...row }; },
      updateMany: async ({ where, data }: { where: Rec; data: Rec }) => { const row = accounts.get(where.discordUserId as string); if (!row || !match(where, row)) return { count: 0 }; Object.assign(row, data); return { count: 1 }; }
    },
    tcgCard: {},
    tcgLog: { create: async ({ data }: { data: Rec }) => { logs.push(data); } }
  };
  const db = {
    ...tx,
    member: {}, guildSettings: {},
    $transaction: async <T>(fn: (t: typeof tx) => Promise<T>): Promise<T> => {
      const snap = { m: structuredClone([...matches]), p: structuredClone([...players]), d: structuredClone([...dailies]), a: structuredClone([...accounts]), l: logs.length };
      try { return await fn(tx); } catch (error) {
        matches.clear(); snap.m.forEach(([k, v]) => matches.set(k, v)); players.clear(); snap.p.forEach(([k, v]) => players.set(k, v)); dailies.clear(); snap.d.forEach(([k, v]) => dailies.set(k, v)); accounts.clear(); snap.a.forEach(([k, v]) => accounts.set(k, v)); logs.length = snap.l;
        throw error;
      }
    }
  };
  return { db: db as never, matches, players, dailies, accounts, logs };
}

const NOW = new Date(Date.UTC(2026, 10, 10, 12, 0, 0)); // week 1 of the featured rotation: boss-2 is the spotlight, so boss-1 pays plain dust
const USER = "user-1";

/** The member's simple policy: keep the opening hand, take the first Loot option, play what it can, attack, then end. */
function policy(state: MatchState): Action {
  const legal = legalActions(state);
  return legal.find(a => a.t === "mulligan") ?? legal.find(a => a.t === "choose") ?? legal.find(a => a.t === "play") ?? legal.find(a => a.t === "attack") ?? legal.find(a => a.t === "end")!;
}

async function playOut(h: ReturnType<typeof fakeDb>, id: string, now = NOW, limit = 800): Promise<MatchResponse> {
  let res = await getMatch(h.db, USER, id, now);
  for (let i = 0; i < limit && res.match.status === "active"; i++) res = await submitIntent(h.db, USER, id, policy(h.matches.get(id)!.state as MatchState), now);
  return res;
}

/** Plays until the member can hit the opponent's Champion, then leaves it on 1 Health so the next attack wins. Returns the winning move. */
async function setUpWin(h: ReturnType<typeof fakeDb>, id: string, now = NOW): Promise<Action> {
  for (let i = 0; i < 400; i++) {
    const state = h.matches.get(id)!.state as MatchState;
    const hit = legalActions(state).find(a => a.t === "attack" && "champ" in a.target && a.target.champ === 1);
    if (hit && actor(state) === 0) { state.players[1].hp = 1; state.players[1].armor = 0; return hit; }
    const res = await submitIntent(h.db, USER, id, policy(state), now);
    if (res.match.status !== "active") throw new Error("The match ended before a winning attack was available.");
  }
  throw new Error("No winning attack found.");
}

describe("starting a match", () => {
  it("creates an AI match, runs the AI to the member's turn and stores seed, decks and the action log", async () => {
    const h = fakeDb();
    const res = await startMatch(h.db, USER, { mode: "ai", cls: "warrior", level: "normal", opponentCls: "mage" }, NOW, 4242);
    expect(res.match.kind).toBe("ai");
    expect(res.match.status).toBe("active");
    expect(res.match.turnDeadlineAt).toBe(new Date(NOW.getTime() + TURN_SECONDS * 1000).toISOString());
    expect(res.view.yourTurn).toBe(true);
    const row = h.matches.get(res.match.id)!;
    expect(row.seed).toBe(4242);
    expect(stateHash(replayRow(row as never))).toBe(row.stateHash);
  });

  it("limits the matches in progress and refuses a locked boss", async () => {
    const h = fakeDb();
    await expect(startMatch(h.db, USER, { mode: "pve", cls: "rogue", boss: "boss-3" }, NOW, 1)).rejects.toMatchObject({ status: 409 });
    await expect(startMatch(h.db, USER, { mode: "pve", cls: "rogue", boss: "nope" }, NOW, 1)).rejects.toMatchObject({ status: 404 });
    for (let i = 0; i < MAX_ACTIVE_MATCHES; i++) await startMatch(h.db, USER, { mode: "ai", cls: "priest", level: "easy" }, NOW, 10 + i);
    await expect(startMatch(h.db, USER, { mode: "ai", cls: "priest" }, NOW, 99)).rejects.toMatchObject({ status: 409 });
  });
});

describe("the player view hides what the member must not see", () => {
  it("has no opponent hand, no deck orders and no random state, but shows the counts", async () => {
    const h = fakeDb();
    const res = await startMatch(h.db, USER, { mode: "ai", cls: "hunter", opponentCls: "druid" }, NOW, 777);
    const state = h.matches.get(res.match.id)!.state as MatchState;
    const text = JSON.stringify(res);
    expect(res.view.opponent).not.toHaveProperty("hand");
    expect(res.view.opponent).not.toHaveProperty("deck");
    expect(res.view.me).not.toHaveProperty("deck");
    expect(res.view).not.toHaveProperty("rng");
    expect(text).not.toContain('"rng"');
    expect(text).not.toContain('"deck"');
    expect(res.view.opponent.handCount).toBe(state.players[1].hand.length);
    expect(res.view.opponent.deckCount).toBe(state.players[1].deck.length);
    expect(res.view.me.hand).toEqual(state.players[0].hand);
    // The opponent's pending Loot choice is never shown; the member's own is.
    const looting: MatchState = { ...structuredClone(state), pending: [{ kind: "loot", p: 1, options: ["001", "002", "003"] }] };
    const theirs = playerView(looting);
    expect(theirs.pending).toBeNull();
    expect(theirs.opponentChoosing).toBe(true);
    expect(JSON.stringify(theirs)).not.toContain('"options"');
    const mine = playerView({ ...looting, pending: [{ kind: "loot", p: 0, options: ["001", "002", "003"] }] });
    expect(mine.pending?.options).toEqual(["001", "002", "003"]);
  });

  it("lists the legal moves only on the member's turn", async () => {
    const h = fakeDb();
    const res = await startMatch(h.db, USER, { mode: "ai", cls: "shaman", opponentCls: "rogue" }, NOW, 31);
    expect(res.view.legal.length).toBeGreaterThan(0);
    const state = h.matches.get(res.match.id)!.state as MatchState;
    expect(playerView({ ...structuredClone(state), phase: "over", winner: 0 }).legal).toEqual([]);
  });
});

describe("replays", () => {
  it("replaying the stored seed, decks and actions reproduces the final state, and the same inputs give the same match", async () => {
    const hashes: string[] = [];
    for (let run = 0; run < 2; run++) {
      const h = fakeDb();
      const start = await startMatch(h.db, USER, { mode: "ai", cls: "paladin", level: "easy", opponentCls: "warlock" }, NOW, 2026);
      const end = await playOut(h, start.match.id);
      expect(end.match.status).not.toBe("active");
      const row = h.matches.get(start.match.id)!;
      expect(stateHash(replayRow(row as never))).toBe(row.stateHash);
      expect((row.actions as Action[]).length).toBeGreaterThan(10);
      hashes.push(row.stateHash as string);
    }
    expect(hashes[0]).toBe(hashes[1]);
  });
});

describe("intents", () => {
  it("refuses an illegal move and changes nothing", async () => {
    const h = fakeDb();
    const res = await startMatch(h.db, USER, { mode: "ai", cls: "mage", opponentCls: "priest" }, NOW, 5);
    const before = structuredClone(h.matches.get(res.match.id)!);
    await expect(submitIntent(h.db, USER, res.match.id, { t: "attack", unit: 9999, target: { champ: 1 } }, NOW)).rejects.toMatchObject({ status: 400 });
    expect(h.matches.get(res.match.id)).toEqual(before);
  });

  it("is private to its owner and 404s for unknown matches", async () => {
    const h = fakeDb();
    const res = await startMatch(h.db, USER, { mode: "ai", cls: "mage" }, NOW, 6);
    await expect(getMatch(h.db, "someone-else", res.match.id, NOW)).rejects.toMatchObject({ status: 404 });
    await expect(submitIntent(h.db, "someone-else", res.match.id, { t: "end" }, NOW)).rejects.toMatchObject({ status: 404 });
    await expect(concedeMatch(h.db, "someone-else", res.match.id, NOW)).rejects.toMatchObject({ status: 404 });
    await expect(getMatch(h.db, USER, "missing", NOW)).rejects.toBeInstanceOf(TcgError);
  });

  it("parses only the five member moves from an untrusted body", () => {
    expect(parseIntent({ t: "end", extra: 1 })).toEqual({ t: "end" });
    expect(parseIntent({ t: "play", hand: 2, target: { unit: 4 }, mode: 1 })).toEqual({ t: "play", hand: 2, target: { unit: 4 }, mode: 1 });
    expect(parseIntent({ t: "attack", unit: 3, target: { champ: 1 } })).toEqual({ t: "attack", unit: 3, target: { champ: 1 } });
    expect(parseIntent({ t: "mulligan", replace: [0, 2] })).toEqual({ t: "mulligan", replace: [0, 2] });
    expect(parseIntent({ t: "power" })).toEqual({ t: "power" });
    expect(parseIntent({ t: "choose", index: 1 })).toEqual({ t: "choose", index: 1 });
    expect(parseIntent({ t: "concede", p: 0 })).toBeNull();
    expect(parseIntent({ t: "play", hand: -1 })).toBeNull();
    expect(parseIntent({ t: "play", hand: 1.5 })).toBeNull();
    expect(parseIntent({ t: "attack", unit: 1, target: { champ: 2 } })).toBeNull();
    expect(parseIntent({ t: "mulligan", replace: "all" })).toBeNull();
    expect(parseIntent(null)).toBeNull();
    expect(parseIntent("end")).toBeNull();
  });
});

describe("concede and timeout", () => {
  it("concede loses the match once, pays nothing and cannot be repeated", async () => {
    const h = fakeDb();
    const start = await startMatch(h.db, USER, { mode: "ai", cls: "warrior" }, NOW, 8);
    const res = await concedeMatch(h.db, USER, start.match.id, NOW);
    expect(res.match.status).toBe("lost");
    expect(res.match.reason).toBe("concede");
    expect(res.rewards).toMatchObject({ dust: 0, packs: 0, won: false });
    expect(res.view.legal).toEqual([]);
    expect(h.players.get(USER)).toMatchObject({ wins: 0, losses: 1 });
    await expect(concedeMatch(h.db, USER, start.match.id, NOW)).rejects.toMatchObject({ status: 409 });
    await expect(submitIntent(h.db, USER, start.match.id, { t: "end" }, NOW)).rejects.toMatchObject({ status: 409 });
    expect(h.players.get(USER)).toMatchObject({ losses: 1 });
    const row = h.matches.get(start.match.id)!;
    expect(stateHash(replayRow(row as never))).toBe(row.stateHash);
  });

  it("forfeits a match whose turn clock ran out, when it is read or played, and replays still match", async () => {
    const h = fakeDb();
    const a = await startMatch(h.db, USER, { mode: "ai", cls: "warrior" }, NOW, 11);
    const b = await startMatch(h.db, USER, { mode: "ai", cls: "warrior" }, NOW, 12);
    const late = new Date(NOW.getTime() + TURN_SECONDS * 1000 + 1);
    const read = await getMatch(h.db, USER, a.match.id, late);
    expect(read.match.status).toBe("lost");
    expect(read.match.reason).toBe("timeout");
    const played = await submitIntent(h.db, USER, b.match.id, { t: "end" }, late);
    expect(played.match.status).toBe("lost");
    expect(played.match.reason).toBe("timeout");
    for (const id of [a.match.id, b.match.id]) { const row = h.matches.get(id)!; expect(stateHash(replayRow(row as never))).toBe(row.stateHash); }
    // On time is fine.
    const c = await startMatch(h.db, USER, { mode: "ai", cls: "warrior" }, NOW, 13);
    expect((await getMatch(h.db, USER, c.match.id, new Date(NOW.getTime() + 1000))).match.status).toBe("active");
  });

  it("lists matches newest first and forfeits overdue ones", async () => {
    const h = fakeDb();
    await startMatch(h.db, USER, { mode: "ai", cls: "warrior" }, NOW, 21);
    await startMatch(h.db, USER, { mode: "ai", cls: "rogue" }, NOW, 22);
    const list = await listMatches(h.db, USER, new Date(NOW.getTime() + TURN_SECONDS * 1000 + 5));
    expect(list.matches).toHaveLength(2);
    expect(list.matches.every(m => m.status === "lost")).toBe(true);
    expect((await listMatches(h.db, "nobody", NOW)).matches).toEqual([]);
  });
});

describe("rewards are granted once", () => {
  it("a win against the AI (Normal) is one step toward a pack and pays no dust; the finished match cannot pay again", async () => {
    const h = fakeDb();
    const start = await startMatch(h.db, USER, { mode: "ai", cls: "warrior", level: "normal", opponentCls: "mage" }, NOW, 100);
    const win = await setUpWin(h, start.match.id);
    const res = await submitIntent(h.db, USER, start.match.id, win, NOW);
    expect(res.match.status).toBe("won");
    expect(res.rewards).toMatchObject({ won: true, dust: 0 });
    expect(h.players.get(USER)).toMatchObject({ wins: 1, losses: 0 });
    const player = { ...h.players.get(USER)! };
    const daily = structuredClone([...h.dailies.values()]);
    await expect(submitIntent(h.db, USER, start.match.id, win, NOW)).rejects.toMatchObject({ status: 409 });
    await expect(concedeMatch(h.db, USER, start.match.id, NOW)).rejects.toMatchObject({ status: 409 });
    expect(h.players.get(USER)).toEqual(player);
    expect([...h.dailies.values()]).toEqual(daily);
    expect((await getMatch(h.db, USER, start.match.id, NOW)).match.rewards).toEqual({ dust: 0, packs: 0 });
  });

  it("wins against Easy only count for quests, not for packs", async () => {
    const h = fakeDb();
    const start = await startMatch(h.db, USER, { mode: "ai", cls: "warrior", level: "easy", opponentCls: "mage" }, NOW, 101);
    const win = await setUpWin(h, start.match.id);
    const res = await submitIntent(h.db, USER, start.match.id, win, NOW);
    expect(res.match.status).toBe("won");
    // Win-a-match is a quest on most days; whatever the board, no win step is added for Easy.
    const quests = res.rewards!.questsCompleted;
    expect(h.players.get(USER)!.packProgress).toBe(quests.length);
  });

  it("a boss pays its reward once per day, advances the run, and later bosses unlock in order", async () => {
    const h = fakeDb();
    const first = await startMatch(h.db, USER, { mode: "pve", cls: "warrior", boss: "boss-1" }, NOW, 200);
    const win = await setUpWin(h, first.match.id);
    const res = await submitIntent(h.db, USER, first.match.id, win, NOW);
    expect(res.match.status).toBe("won");
    expect(res.rewards!.dust).toBe(20);
    expect(h.accounts.get(USER)!.dust).toBe(20);
    expect(h.players.get(USER)!.pveCleared).toBe(1);
    expect(h.logs.filter(l => l.kind === "match")).toHaveLength(1);
    // Beating it again the same day advances nothing and pays nothing more.
    const again = await startMatch(h.db, USER, { mode: "pve", cls: "warrior", boss: "boss-1" }, NOW, 201);
    const win2 = await setUpWin(h, again.match.id);
    const res2 = await submitIntent(h.db, USER, again.match.id, win2, NOW);
    expect(res2.match.status).toBe("won");
    expect(res2.rewards!.dust).toBe(0);
    expect(h.accounts.get(USER)!.dust).toBe(20);
    expect(h.players.get(USER)!.pveCleared).toBe(1);
    // Boss 2 is open, boss 3 is not.
    await expect(startMatch(h.db, USER, { mode: "pve", cls: "warrior", boss: "boss-3" }, NOW, 202)).rejects.toMatchObject({ status: 409 });
    const progress = await pveProgress(h.db, USER, "en", NOW);
    expect(progress.bosses.map(b => [b.cleared, b.unlocked])).toEqual([[true, true], [false, true], [false, false], [false, false], [false, false]]);
    expect(progress.bosses[0]!.paidToday).toBe(true);
    expect(progress.featured.boss).toBe("boss-2");
    expect(progress.daily.quests).toHaveLength(3);
    expect(progress.wins).toBe(2);
  });

  it("the next day pays the boss again", async () => {
    const h = fakeDb();
    const day2 = new Date(NOW.getTime() + 86_400_000);
    const a = await startMatch(h.db, USER, { mode: "pve", cls: "warrior", boss: "boss-1" }, NOW, 300);
    await submitIntent(h.db, USER, a.match.id, await setUpWin(h, a.match.id), NOW);
    const b = await startMatch(h.db, USER, { mode: "pve", cls: "warrior", boss: "boss-1" }, day2, 301);
    const res = await submitIntent(h.db, USER, b.match.id, await setUpWin(h, b.match.id, day2), day2);
    expect(res.rewards!.dust).toBe(20);
    expect(h.accounts.get(USER)!.dust).toBe(40);
  });

  it("a pack the full bank cannot hold is paid as dust", async () => {
    const h = fakeDb();
    h.accounts.set(USER, { discordUserId: USER, banked: 3, accruedAt: new Date(NOW.getTime() - ACCRUAL_MS), pityEpic: 0, pityLegendary: 0, dust: 5, packsOpened: 0 });
    h.players.set(USER, { discordUserId: USER, packProgress: 2, wins: 0, losses: 0, pveCleared: 0, pveRuns: 0 });
    const start = await startMatch(h.db, USER, { mode: "ai", cls: "warrior", level: "hard", opponentCls: "mage" }, NOW, 400);
    const res = await submitIntent(h.db, USER, start.match.id, await setUpWin(h, start.match.id), NOW);
    expect(res.rewards!.packs).toBe(0);
    expect(res.rewards!.overflowDust).toBeGreaterThanOrEqual(60);
    expect(h.accounts.get(USER)!.banked).toBe(3);
    expect(h.accounts.get(USER)!.dust).toBe(5 + res.rewards!.dust);
  });

  it("rolls the whole move back when the account changed under it", async () => {
    const h = fakeDb();
    h.players.set(USER, { discordUserId: USER, packProgress: 2, wins: 0, losses: 0, pveCleared: 0, pveRuns: 0 });
    const start = await startMatch(h.db, USER, { mode: "ai", cls: "warrior", level: "hard", opponentCls: "mage" }, NOW, 401);
    const win = await setUpWin(h, start.match.id);
    const real = (h.db as unknown as { tcgAccount: { updateMany: (...a: unknown[]) => Promise<{ count: number }> } }).tcgAccount;
    const original = real.updateMany;
    let fails = 3;
    real.updateMany = async (...args) => (fails-- > 0 ? { count: 0 } : original(...args));
    await expect(submitIntent(h.db, USER, start.match.id, win, NOW)).rejects.toMatchObject({ status: 409 });
    expect(h.matches.get(start.match.id)!.status).toBe("active");
    expect(h.matches.get(start.match.id)!.rewardedAt).toBeNull();
  });
});
