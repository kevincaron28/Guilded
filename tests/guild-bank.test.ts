import { describe, expect, it } from "vitest";
import { applyGuildBank, goldText, summarizeLedger, weeklyBankText } from "../src/services/guild-bank.js";
import { guildBankBody } from "../src/services/guild-bank-page.js";
import { exportGuildBank } from "../companion/lua-export-content.mjs";

// 9.0 guild bank ledger: any member's upload, deduplicated across uploaders, read-only.
const NOW = new Date("2026-12-20T12:00:00Z");
const T = Math.floor(NOW.getTime() / 1000) - 3600;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;
function fakeDb() {
  const tables: { contents: Row[]; gold: Row[]; tx: Row[] } = { contents: [], gold: [], tx: [] };
  const since = (rows: Row[], where: { at?: { gte: Date } }) => rows.filter((r) => !where.at || r.at >= where.at.gte);
  const tx = {
    guildBankContents: {
      findUnique: async () => tables.contents[0] ?? null,
      upsert: async ({ create, update }: { create: Row; update: Row }) => { if (tables.contents[0]) Object.assign(tables.contents[0], update); else tables.contents.push({ ...create }); }
    },
    guildBankGold: {
      findMany: async ({ where }: { where: Row }) => since(tables.gold, where),
      create: async ({ data }: { data: Row }) => { tables.gold.push(data); }
    },
    guildBankTransaction: {
      findMany: async ({ where }: { where: Row }) => since(tables.tx, where),
      create: async ({ data }: { data: Row }) => { tables.tx.push(data); }
    }
  };
  return { tx: tx as never, tables };
}

const upload = (shift = 0, extra: Row = {}) => ({
  contents: { at: T + shift, money: 5_000_000, tabs: [{ tab: 1, name: "Mats", items: [{ id: 13444, name: "Major Mana Potion", count: 8 }] }] },
  gold: [{ at: T + shift, money: 5_000_000 }],
  itemLog: [
    { type: "deposit", name: "Dude Lebowski", itemId: 13444, itemName: "Major Mana Potion", count: 5, tab: 1, at: T - 26 * 3600 + shift },
    { type: "withdraw", name: "Walter Sobchak", itemId: 12360, itemName: "Arcanite Bar", count: 2, tab: 1, at: T - 3 * 3600 + shift }
  ],
  moneyLog: [{ type: "deposit", name: "Dude Lebowski", amount: 250_000, at: T - 5 * 3600 + shift }, { type: "repair", name: "Walter Sobchak", amount: 1_200, at: T - 3600 + shift }],
  ...extra
});

describe("guild bank import", () => {
  it("stores contents, a gold point and every log line", async () => {
    const db = fakeDb();
    expect(await applyGuildBank(db.tx, "g", "m-dude", upload(), NOW)).toEqual({ contents: true, gold: 1, items: 2, money: 2, duplicates: 0 });
    expect(db.tables.contents[0]).toMatchObject({ money: 5_000_000n, reportedById: "m-dude" });
    expect(db.tables.tx.find((r: Row) => r.kind === "money" && r.type === "deposit")).toMatchObject({ actor: "Dude Lebowski", amount: 250_000n });
  });

  it("the same lines from a second member an hour later are stored once; older contents never replace newer", async () => {
    const db = fakeDb();
    await applyGuildBank(db.tx, "g", "m-dude", upload(), NOW);
    const second = await applyGuildBank(db.tx, "g", "m-walter", upload(-3600 + 1800), NOW); // the game rounds ages to the hour
    expect(second).toMatchObject({ contents: false, items: 0, money: 0, duplicates: 4 });
    expect(db.tables.tx).toHaveLength(4);
    expect(db.tables.contents[0].reportedById).toBe("m-dude");
    // A real repeat later is a new line.
    const later = await applyGuildBank(db.tx, "g", "m-walter", upload(0, { itemLog: [{ type: "deposit", name: "Dude Lebowski", itemId: 13444, count: 5, tab: 1, at: T }], moneyLog: [] }), NOW);
    expect(later.items).toBe(1);
  });

  it("ignores lines from the future, malformed lines and bad names; a malformed block changes nothing", async () => {
    const db = fakeDb();
    const result = await applyGuildBank(db.tx, "g", null, upload(0, {
      itemLog: [{ type: "deposit", name: "Bad|Name", itemId: 1, count: 1, at: T }, { type: "deposit", name: "Dude Lebowski", itemId: 1, count: 1, at: T + 86400 }],
      moneyLog: [{ type: "deposit", name: "Dude Lebowski", amount: -5, at: T }]
    }), NOW);
    expect([result.items, result.money]).toEqual([0, 0]);
    expect(await applyGuildBank(db.tx, "g", null, { contents: "nope" }, NOW)).toEqual({ contents: false, gold: 0, items: 0, money: 0, duplicates: 0 });
  });
});

describe("reading it back", () => {
  const rows = [
    { kind: "money", type: "deposit", actor: "Dude Lebowski", count: null, amount: 250_000n },
    { kind: "money", type: "repair", actor: "Walter Sobchak", count: null, amount: 1_200n },
    { kind: "item", type: "deposit", actor: "Dude Lebowski", count: 5, amount: null },
    { kind: "item", type: "withdraw", actor: "Walter Sobchak", count: 2, amount: null }
  ];

  it("sums per member: gold in and out (repairs are out), items in and out", () => {
    expect(summarizeLedger(rows)).toEqual([
      { actor: "Dude Lebowski", deposited: 250_000n, withdrawn: 0n, itemsIn: 5, itemsOut: 0 },
      { actor: "Walter Sobchak", deposited: 0n, withdrawn: 1_200n, itemsIn: 0, itemsOut: 2 }
    ]);
    expect(goldText(1_234_567n)).toBe("123g 45s 67c");
    expect(goldText(123_456_789_00n)).toBe("1,234,567g");
  });

  it("the weekly post says who moved what and the gold change, and nothing when the bank did not move", () => {
    const text = weeklyBankText(rows, 4_000_000n, 5_000_000n, "en")!;
    expect(text).toContain("Gold now: **500g 0s 0c** (+100g 0s 0c this week)");
    expect(text).toContain("• **Dude Lebowski**: +25g 0s 0c · 5 item(s) in");
    expect(text).toContain("• **Walter Sobchak**: −0g 12s 0c · 2 item(s) out");
    expect(weeklyBankText([], 1n, 2n, "en")).toBeNull();
  });

  it("the page shows contents, the gold chart and the ledger, escaped", () => {
    const html = guildBankBody({
      contents: { guildId: "g", observedAt: NOW, money: 5_000_000n, tabs: [{ tab: 1, name: "<Mats>", items: [{ id: 1, name: "Major Mana Potion", count: 8 }] }], reportedById: null, updatedAt: NOW },
      gold: [{ id: "1", guildId: "g", at: new Date(NOW.getTime() - 86400000), money: 4_000_000n }, { id: "2", guildId: "g", at: NOW, money: 5_000_000n }],
      ledger: [{ id: "x", guildId: "g", kind: "item", type: "deposit", actor: "Dude Lebowski", itemId: 13444, itemName: "Major Mana Potion", count: 5, tab: 1, tab2: null, amount: null, at: NOW, reportedById: null, createdAt: NOW }]
    } as never, (en) => en);
    expect(html).toContain("&lt;Mats&gt;");
    expect(html).toContain("<svg");
    expect(html).toContain("Dude Lebowski</td><td>deposited Major Mana Potion ×5 (tab 1)");
    expect(guildBankBody({ contents: null, gold: [], ledger: [] }, (en) => en)).toContain("Nothing yet");
  });

  it("the companion exports what the addon saved, field by field", () => {
    const out = exportGuildBank({
      guildBank: { at: "2026-12-20T11:00:00Z", by: "Dude Lebowski", money: 5000000, tabs: { 1: { name: "Mats", items: { 13444: { name: "Major Mana Potion", count: 8 } } } } },
      guildBankLog: {
        gold: [{ at: T, money: 5000000 }],
        items: [{ type: "deposit", name: "Dude Lebowski", item: 13444, itemName: "Major Mana Potion", count: 5, tab: 1, at: T }, { type: "deposit", name: "Bad|Name", item: 1, count: 1, at: T }],
        money: [{ type: "repair", name: "Walter Sobchak", amount: 1200, at: T }]
      }
    }) as Row;
    expect(out.guildBank.contents).toEqual({ at: Math.floor(Date.parse("2026-12-20T11:00:00Z") / 1000), money: 5000000, tabs: [{ tab: 1, name: "Mats", items: [{ id: 13444, name: "Major Mana Potion", count: 8 }] }] });
    expect(out.guildBank.itemLog).toEqual([{ type: "deposit", name: "Dude Lebowski", itemId: 13444, itemName: "Major Mana Potion", count: 5, tab: 1, at: T }]);
    expect(out.guildBank.moneyLog).toEqual([{ type: "repair", name: "Walter Sobchak", amount: 1200, at: T }]);
    expect(exportGuildBank({})).toEqual({});
  });
});
