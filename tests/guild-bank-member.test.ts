import { describe, expect, it, vi } from "vitest";
import { bankForAddon, bankItems, itemMarkdown, lowStock, parseAddonBankRequests, requestCard, resolveBankItem, searchBankItems, searchReplyText,
  updateStockState } from "../src/services/guild-bank-member.js";
import { guildBankBody } from "../src/services/guild-bank-page.js";
import { weeklyBankText } from "../src/services/guild-bank.js";
import { createBankService } from "../src/services/bank.js";
import { exportGuildBank } from "../companion/lua-export-content.mjs";
import { guildBankToLua } from "../companion/standings-format.mjs";

// 9.1 guild bank additions (docs/plans/GUILD_BANK.md): member search, item links, requests, minimum stock.
const TABS = [
  { tab: 1, name: "Consumables", items: [{ id: 13444, name: "Major Mana Potion", count: 8, q: 1 }, { id: 13446, name: "Major Healing Potion", count: 3, q: 1 }] },
  { tab: 2, name: "Mats", items: [{ id: 12360, name: "Arcanite Bar", count: 2, q: 2 }, { id: 13444, name: "Major Mana Potion", count: 4, q: 1 }] }
];
const AT = new Date("2026-12-20T12:00:00Z");

describe("member bank search", () => {
  it("sums an item over its tabs and finds it by words, id or exact name", () => {
    const items = bankItems(TABS);
    expect(items.find((i) => i.id === 13444)).toMatchObject({ count: 12, tabs: [{ name: "Consumables", count: 8 }, { name: "Mats", count: 4 }] });
    expect(searchBankItems(items, "major potion").map((i) => i.id)).toEqual([13446, 13444]);
    expect(searchBankItems(items, "#12360").map((i) => i.name)).toEqual(["Arcanite Bar"]);
    expect(resolveBankItem(items, "major mana potion")?.id).toBe(13444);
    expect(resolveBankItem(items, "major")).toBeNull();
  });

  it("answers with Wowhead links, the tabs and how old the contents are, and never mentions anyone", () => {
    const text = searchReplyText(bankItems(TABS), "mana", AT, "en");
    expect(text).toContain("[Major Mana Potion](<https://www.wowhead.com/classic/item=13444>) ×12 — Consumables ×8, Mats ×4");
    expect(text).toContain(`<t:${AT.getTime() / 1000}:R>`);
    expect(searchReplyText([], "x", null, "fr")).toContain("Pas encore");
    expect(itemMarkdown(1, "[@everyone](evil)")).toBe("[everyoneevil](<https://www.wowhead.com/classic/item=1>)");
  });

  it("shows members the contents with links but never the ledger or gold chart", () => {
    const t = (en: string) => en;
    const bank = { contents: { observedAt: AT, money: 5_000_000n, tabs: TABS }, gold: [{ at: AT, money: 5_000_000n }],
      ledger: [{ at: AT, actor: "Walter Sobchak", kind: "item", type: "withdraw", itemId: 12360, itemName: "Arcanite Bar", count: 2, tab: 1, tab2: null, amount: null }] } as never;
    const member = guildBankBody(bank, t, { officer: false, query: "arcanite" });
    expect(member).toContain('href="https://www.wowhead.com/classic/item=12360"');
    expect(member).toContain("color:#1eff00");
    expect(member).not.toContain("Walter Sobchak");
    expect(member).not.toContain("Ledger");
    const officer = guildBankBody(bank, t, { officer: true, targets: [{ itemId: 13446, itemName: "Major Healing Potion", minCount: 10 }] });
    expect(officer).toContain("Walter Sobchak");
    expect(officer).toContain("Below minimum");
    expect(officer).toContain(": 3 / 10");
  });
});

describe("minimum stock", () => {
  it("lists what is below target, emptiest first, including items gone from the bank", () => {
    const low = lowStock(bankItems(TABS), [
      { itemId: 13444, itemName: "Major Mana Potion", minCount: 10 },
      { itemId: 13446, itemName: "Major Healing Potion", minCount: 10 },
      { itemId: 20007, itemName: "Mageblood Potion", minCount: 5 }
    ]);
    expect(low.map((r) => `${r.itemName} ${r.have}/${r.min}`)).toEqual(["Mageblood Potion 0/5", "Major Healing Potion 3/10"]);
  });

  it("alerts once when an item goes low and again only after it was back above", async () => {
    const targets = [{ id: "t1", itemId: 13446, itemName: "Major Healing Potion", minCount: 5, lowSince: null as Date | null }];
    let tabs: unknown = TABS;
    const db = {
      guildBankContents: { findUnique: async () => ({ tabs }) },
      guildBankTarget: { findMany: async () => targets, update: async ({ data }: { data: { lowSince: Date | null } }) => { targets[0]!.lowSince = data.lowSince; } }
    } as never;
    expect(await updateStockState(db, "g", AT)).toHaveLength(1);
    expect(await updateStockState(db, "g", AT)).toHaveLength(0);
    tabs = [{ tab: 1, name: "C", items: [{ id: 13446, name: "Major Healing Potion", count: 9 }] }];
    expect(await updateStockState(db, "g", AT)).toHaveLength(0);
    expect(targets[0]!.lowSince).toBeNull();
    tabs = TABS;
    expect(await updateStockState(db, "g", AT)).toHaveLength(1);
  });

  it("adds top depositors, low items and open requests to the weekly post", () => {
    const text = weeklyBankText([{ kind: "money", type: "deposit", actor: "Dude Lebowski", count: null, amount: 250_000n }], null, 5_000_000n, "en",
      { low: [{ itemId: 13446, itemName: "Major Healing Potion", have: 3, min: 10 }], openRequests: 2 });
    expect(text).toContain("Top depositors: **Dude Lebowski**");
    expect(text).toContain("Major Healing Potion](<https://www.wowhead.com/classic/item=13446>): 3 / 10");
    expect(text).toContain("Open bank requests: **2**");
  });
});

describe("bank requests", () => {
  const request = { id: "r1", guildId: "g", memberId: "m", item: "Major Mana Potion", itemId: 13444, quantity: 4, note: "MC", status: "PENDING", handledBy: null, handledAt: null,
    reply: null, source: "addon", clientRef: "1800000000-123456", channelId: null, messageId: null, createdAt: AT, updatedAt: AT, member: { displayName: "Dude", discordUserId: "42" } } as never;

  it("gives officers a card with buttons while open, none once closed, and no pings", () => {
    const open = requestCard(request, "en", 12);
    expect(open.components).toHaveLength(1);
    expect(JSON.stringify(open.components[0]!.toJSON())).toContain("bankreq:r1:FULFILLED");
    expect(open.embeds[0]!.data.description).toContain("In the bank: 12");
    expect(open.embeds[0]!.data.description).toContain("Asked in game.");
    expect(open.allowedMentions.parse).toEqual([]);
    expect(requestCard({ ...(request as object), status: "FULFILLED" } as never, "fr").components).toHaveLength(0);
  });

  it("takes in-game requests once per ref and skips bad rows", async () => {
    expect(parseAddonBankRequests([{ ref: "1800000000-123456", item: "Major Mana Potion", itemId: 13444, count: 4 }, { ref: "x", item: "A", count: 0 }, null])).toHaveLength(1);
    const created: unknown[] = [];
    const db = { bankRequest: {
      findFirst: vi.fn().mockImplementation(async ({ where }) => created.some((r) => (r as { clientRef: string }).clientRef === where.clientRef) ? { id: "x" } : null),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockImplementation(async ({ data }) => { created.push(data); return data; })
    } } as never;
    const service = createBankService(db);
    const rows = [{ ref: "1800000000-123456", item: "Major Mana Potion", itemId: 13444, count: 4 }];
    expect(await service.fromAddon("g", "m", rows)).toHaveLength(1);
    expect(await service.fromAddon("g", "m", rows)).toHaveLength(0);
    expect(created[0]).toMatchObject({ source: "addon", clientRef: "1800000000-123456", itemId: 13444 });
  });

  it("sends the addon the contents, the low list and the member's own requests; no contents when member search is off", async () => {
    const db = (memberSearch: boolean) => ({
      guildSettings: { findUnique: async () => ({ guildBankMemberSearch: memberSearch }) },
      guildBankContents: { findUnique: async () => ({ observedAt: AT, money: 5_000_000n, tabs: TABS }) },
      guildBankTarget: { findMany: async () => [{ itemId: 13446, itemName: "Major Healing Potion", minCount: 10 }] },
      bankRequest: { findMany: async () => [{ clientRef: "1800000000-123456", item: "Major Mana Potion", quantity: 4, status: "APPROVED", createdAt: AT }], count: async () => 3 }
    }) as never;
    const on = await bankForAddon(db(true), "g", "m", false);
    expect(on).toMatchObject({ at: AT.getTime() / 1000, money: 5_000_000, low: [{ itemId: 13446, have: 3 }], requests: [{ ref: "1800000000-123456", status: "APPROVED" }] });
    expect(on).not.toHaveProperty("open");
    const off = await bankForAddon(db(false), "g", "m", false);
    expect(off).not.toHaveProperty("items");
    expect(off.low).toEqual([]);
    expect(await bankForAddon(db(false), "g", "m", true)).toMatchObject({ open: 3, items: expect.any(Array) });
  });
});

describe("companion", () => {
  it("uploads the item quality and in-game requests, whitelisted", () => {
    const out = exportGuildBank({
      guildBank: { at: "2026-12-20T12:00:00Z", tabs: { 1: { name: "C", items: { 13444: { name: "Major Mana Potion", count: 8, q: 1 }, 1: { name: "X", count: 1, q: 99 } } } } },
      bankRequests: { a: { ref: "1800000000-123456", item: "Major Mana Potion", itemId: 13444, count: 4000, at: 1 }, b: { ref: "bad ref", item: "X" } }
    });
    expect(out.guildBank?.contents?.tabs[0]?.items).toEqual([{ id: 1, name: "X", count: 1 }, { id: 13444, name: "Major Mana Potion", count: 8, q: 1 }]);
    expect(out.bankRequests).toEqual([{ ref: "1800000000-123456", item: "Major Mana Potion", itemId: 13444, count: 1000 }]);
  });

  it("writes GuildedBank for the addon, or nil", () => {
    expect(guildBankToLua(undefined)).toEqual(["GuildedBank = nil"]);
    const lua = guildBankToLua({ at: 1800000000, money: 5, items: [{ id: 13444, name: 'Say "hi"', count: 8, tab: "C", q: 1 }],
      low: [{ itemId: 1, itemName: "L", have: 0, min: 2 }], requests: [{ ref: "r-123456", item: "I", count: 1, status: "FULFILLED", at: 3 }] }).join("\n");
    expect(lua).toContain('{ id = 13444, name = "Say \\"hi\\"", count = 8, tab = "C", q = 1 }');
    expect(lua).toContain('status = "FULFILLED"');
    expect(lua).toContain("open = nil");
  });
});
