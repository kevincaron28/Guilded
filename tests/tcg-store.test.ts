import { describe, expect, it, vi } from "vitest";

const album = vi.hoisted(() => ({ cards: [] as { id: string; earnedAt: string | null }[] }));
vi.mock("../src/services/companion-album.js", () => ({ albumFor: async () => ({ cards: album.cards }) }));

import { CARDS } from "../src/services/tcg-catalogue.js";
import { ACCRUAL_MS, CRAFT_COST, seededRng } from "../src/services/tcg.js";
import { TcgError, collectionFor, craftCard, openPack, tcgAllowed } from "../src/services/tcg-store.js";

interface Account { discordUserId: string; banked: number; accruedAt: Date; pityEpic: number; pityLegendary: number; dust: number; packsOpened: number }

function fakeDb() {
  const accounts = new Map<string, Account>();
  const cards = new Map<string, { discordUserId: string; cardKey: string; count: number; firstSeenAt: Date }>();
  const logs: unknown[] = [];
  const tx = {
    tcgAccount: {
      findUnique: async ({ where }: { where: { discordUserId: string } }) => accounts.get(where.discordUserId) ?? null,
      create: async ({ data }: { data: Partial<Account> & { discordUserId: string } }) => { const row = { banked: 1, accruedAt: new Date(), pityEpic: 0, pityLegendary: 0, dust: 0, packsOpened: 0, ...data } as Account; accounts.set(row.discordUserId, row); return row; },
      updateMany: async ({ where, data }: { where: Partial<Account>; data: Partial<Account> }) => {
        const row = accounts.get(where.discordUserId!);
        if (!row || (where.packsOpened !== undefined && row.packsOpened !== where.packsOpened) || (where.banked !== undefined && row.banked !== where.banked) || (where.dust !== undefined && row.dust !== where.dust)) return { count: 0 };
        Object.assign(row, data); return { count: 1 };
      }
    },
    tcgCard: {
      findMany: async ({ where }: { where: { discordUserId: string; cardKey?: { startsWith: string } } }) => [...cards.values()].filter(c => c.discordUserId === where.discordUserId && (!where.cardKey || c.cardKey.startsWith(where.cardKey.startsWith))),
      upsert: async ({ where, update, create }: { where: { discordUserId_cardKey: { discordUserId: string; cardKey: string } }; update: { count?: { increment: number } }; create: { discordUserId: string; cardKey: string; count: number; firstSeenAt: Date } }) => {
        const key = `${where.discordUserId_cardKey.discordUserId}|${where.discordUserId_cardKey.cardKey}`;
        const row = cards.get(key);
        if (row) row.count += update.count?.increment ?? 0; else cards.set(key, { ...create });
      },
      create: async ({ data }: { data: { discordUserId: string; cardKey: string; count: number; firstSeenAt: Date } }) => { cards.set(`${data.discordUserId}|${data.cardKey}`, { ...data }); }
    },
    tcgLog: { create: async ({ data }: { data: unknown }) => { logs.push(data); } }
  };
  const db = { ...tx, $transaction: async <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx) } as never;
  return { db, accounts, cards, logs };
}

const allows = () => true;
const t0 = new Date("2026-11-08T12:00:00Z");

describe("collection store", () => {
  it("gives a new collector one pack, then enforces the 20 hour limit", async () => {
    const { db } = fakeDb();
    expect((await collectionFor(db, "u1", "en", allows, t0)).packs.ready).toBe(1);
    const opened = await openPack(db, "u1", "en", allows, t0, seededRng(1));
    expect(opened.cards).toHaveLength(5);
    expect(opened.collection.packs.ready).toBe(0);
    await expect(openPack(db, "u1", "en", allows, new Date(t0.getTime() + ACCRUAL_MS - 1), seededRng(2))).rejects.toMatchObject({ status: 409 });
    const next = await openPack(db, "u1", "en", allows, new Date(t0.getTime() + ACCRUAL_MS), seededRng(2));
    expect(next.cards).toHaveLength(5);
  });

  it("stores the pulled cards and turns duplicates into dust", async () => {
    const { db, cards, accounts } = fakeDb();
    const first = await openPack(db, "u1", "en", allows, t0, seededRng(5));
    expect(first.collection.owned).toBe(new Set(first.cards.map(c => c.key)).size);
    expect(cards.size).toBe(5);
    // Own everything, then every pull is a duplicate worth dust.
    for (const card of CARDS) cards.set(`u1|${card.key}`, { discordUserId: "u1", cardKey: card.key, count: 1, firstSeenAt: t0 });
    accounts.get("u1")!.banked = 1;
    const dupes = await openPack(db, "u1", "en", allows, t0, seededRng(6));
    expect(dupes.dustGained).toBeGreaterThan(0);
    expect(dupes.collection.dust).toBe(dupes.dustGained);
  });

  it("refuses a second open when a concurrent open already spent the pack", async () => {
    const { db, accounts } = fakeDb();
    await collectionFor(db, "u1", "en", allows, t0);
    const real = (db as { $transaction: <T>(fn: (t: unknown) => Promise<T>) => Promise<T> }).$transaction;
    // Another request spends the pack between this request's read and its write.
    (db as { $transaction: unknown }).$transaction = async (fn: (t: unknown) => Promise<unknown>) => real(async (t) => {
      const wrapped = { ...(t as object), tcgAccount: { ...(t as { tcgAccount: object }).tcgAccount, updateMany: async (args: never) => { const row = accounts.get("u1")!; row.packsOpened += 1; return (t as { tcgAccount: { updateMany: (a: never) => Promise<unknown> } }).tcgAccount.updateMany(args); } } };
      return fn(wrapped);
    });
    await expect(openPack(db, "u1", "en", allows, t0, seededRng(1))).rejects.toBeInstanceOf(TcgError);
  });

  it("grants the matching badge card for an earned achievement, once", async () => {
    const { db, cards } = fakeDb();
    const badge = CARDS.find(c => c.family === "badge")!;
    album.cards = [{ id: badge.achievementId!, earnedAt: "2026-11-01T00:00:00Z" }];
    const view = await collectionFor(db, "u1", "en", allows, t0);
    expect(view.cards.find(c => c.key === badge.key)?.owned).toBe(true);
    await collectionFor(db, "u1", "en", allows, t0);
    expect(cards.get(`u1|${badge.key}`)?.count).toBe(1);
    album.cards = [];
  });

  it("crafts with dust, and refuses when short, owned or Epic", async () => {
    const { db, accounts, cards } = fakeDb();
    await collectionFor(db, "u1", "en", allows, t0);
    const common = CARDS.find(c => c.rarity === "common")!.key;
    await expect(craftCard(db, "u1", common, "en", allows, t0)).rejects.toMatchObject({ status: 409 });
    accounts.get("u1")!.dust = 500;
    const view = await craftCard(db, "u1", common, "en", allows, t0);
    expect(view.dust).toBe(500 - CRAFT_COST.common!);
    expect(cards.has(`u1|${common}`)).toBe(true);
    await expect(craftCard(db, "u1", common, "en", allows, t0)).rejects.toMatchObject({ status: 409 });
    await expect(craftCard(db, "u1", CARDS.find(c => c.rarity === "epic")!.key, "en", allows, t0)).rejects.toMatchObject({ status: 409 });
    await expect(craftCard(db, "u1", "nope", "en", allows, t0)).rejects.toMatchObject({ status: 404 });
  });
});

describe("officer switch", () => {
  const db = (off: string[]) => ({
    member: { findMany: async () => [{ guildId: "g1", guild: { discordId: "d1" } }, { guildId: "g2", guild: { discordId: "d2" } }] },
    guildSettings: { findMany: async ({ where }: { where: { guildId: { in: string[] } } }) => where.guildId.in.filter(id => off.includes(id)).map(guildId => ({ guildId })) }
  }) as never;
  it("is on unless every served server turned it off", async () => {
    expect(await tcgAllowed(db([]), "u", allows)).toBe(true);
    expect(await tcgAllowed(db(["g1"]), "u", allows)).toBe(true);
    expect(await tcgAllowed(db(["g1", "g2"]), "u", allows)).toBe(false);
  });
  it("is off for someone in no served server", async () => {
    expect(await tcgAllowed(db([]), "u", () => false)).toBe(false);
  });
});
