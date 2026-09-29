import { describe, expect, it } from "vitest";
import { standingsToLua } from "../companion/standings.mjs";
import { asLootMode, describeRules, effectiveRules, LOOT_MODES } from "../src/services/core-rules.js";
import { createItemValueService, describeValues, GUILD_DEFAULT, parseItemValues } from "../src/services/item-values.js";
import { describePriority, priorityFor, rankCandidates, type PriorityCandidate } from "../src/services/loot-priority.js";
import { lootRulesForAddon } from "../src/services/loot-rules-export.js";
import { itemKey } from "../src/services/wishlist.js";

describe("loot systems in the core rules", () => {
  it("knows four systems and falls back to GP bids for anything else", () => {
    expect(LOOT_MODES).toEqual(["EPGP", "COUNCIL", "RESERVE", "PRIORITY"]);
    expect(asLootMode("PRIORITY")).toBe("PRIORITY");
    expect(asLootMode("nonsense")).toBe("EPGP");
    expect(asLootMode(null)).toBe("EPGP");
  });

  it("a core follows the guild's system unless it picks its own", () => {
    expect(effectiveRules({ lootMode: "RESERVE" }, null).lootMode).toBe("RESERVE");
    expect(effectiveRules({ lootMode: "RESERVE" }, { lootMode: null }).lootMode).toBe("RESERVE");
    const own = effectiveRules({ lootMode: "RESERVE" }, { lootMode: "PRIORITY" });
    expect(own.lootMode).toBe("PRIORITY");
    expect(own.overridden).toContain("loot mode");
  });

  it("soft reserves per player: 1 by default, the core's own value up to 5", () => {
    expect(effectiveRules({}, null).reservesPerPlayer).toBe(1);
    expect(effectiveRules({}, { reservesPerPlayer: 3 }).reservesPerPlayer).toBe(3);
    expect(effectiveRules({}, { reservesPerPlayer: 99 }).reservesPerPlayer).toBe(5);
    const text = describeRules(effectiveRules({ lootMode: "RESERVE" }, { reservesPerPlayer: 2 }), "Tuesday");
    expect(text).toContain("Loot: soft reserves (default) · 2 reserve(s) per player (core)");
    expect(describeRules(effectiveRules({}, { lootMode: "PRIORITY" }), "Tuesday")).toContain("EPGP priority (set prices) (core)");
  });
});

describe("reading a price list", () => {
  it("understands the usual ways of writing 'item = price'", () => {
    const { values, problems } = parseItemValues([
      "Item,GP",
      "Sulfuras, Hand of Ragnaros = 250",
      "Bindings of the Windseeker;120",
      "\"Ashkandi, Greatsword of the Brotherhood\",300",
      "Onyxia Hide Backpack\t40 GP",
      "19019 = 90",
      "id:19364, 310",
      "Some Ring 55",
      ""
    ].join("\n"));
    expect(problems).toEqual([]);
    expect(values).toEqual([
      { name: "Sulfuras, Hand of Ragnaros", id: null, gp: 250 },
      { name: "Bindings of the Windseeker", id: null, gp: 120 },
      { name: "Ashkandi, Greatsword of the Brotherhood", id: null, gp: 300 },
      { name: "Onyxia Hide Backpack", id: null, gp: 40 },
      { name: null, id: 19019, gp: 90 },
      { name: null, id: 19364, gp: 310 },
      { name: "Some Ring", id: null, gp: 55 }
    ]);
  });

  it("reports lines it cannot use and prices that are too high", () => {
    const { values, problems } = parseItemValues("just words\nGood Item = 10\nHuge = 999999\nX = 5");
    expect(values.map((value) => value.name)).toEqual(["Good Item"]);
    expect(problems).toEqual(expect.arrayContaining([expect.stringContaining("Not understood: \"just words\""), expect.stringContaining("too high"), expect.stringContaining("Not understood: \"X = 5\"")]));
  });
});

// ---------- an in-memory stand-in for the price table ----------

type Row = { id: string; guildId: string; coreId: string; itemKey: string; itemId: number | null; itemName: string; gp: number };

function fakeValues() {
  let rows: Row[] = [];
  let next = 1;
  const inWhere = (row: Row, where: Record<string, unknown>) => Object.entries(where).every(([key, value]) => {
    const actual = (row as never)[key];
    if (value && typeof value === "object" && "in" in (value as object)) return ((value as { in: unknown[] }).in).includes(actual);
    return actual === value;
  });
  const db = {
    coreItemValue: {
      upsert: async ({ where, create, update }: { where: { guildId_coreId_itemKey: { guildId: string; coreId: string; itemKey: string } }; create: Omit<Row, "id">; update: Partial<Row> }) => {
        const key = where.guildId_coreId_itemKey;
        const existing = rows.find((row) => row.guildId === key.guildId && row.coreId === key.coreId && row.itemKey === key.itemKey);
        if (existing) Object.assign(existing, update); else rows.push({ id: `v${next++}`, ...create });
      },
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => { const before = rows.length; rows = rows.filter((row) => !inWhere(row, where)); return { count: before - rows.length }; },
      findMany: async ({ where, orderBy }: { where: Record<string, unknown>; orderBy?: { itemName: "asc" } }) =>
        rows.filter((row) => inWhere(row, where)).sort((a, b) => (orderBy ? a.itemName.localeCompare(b.itemName) : 0))
    }
  };
  return { db, rows: () => rows };
}

describe("item prices per core", () => {
  const CORE = "core-1";

  it("stores a guild-wide list and a core's own list, and the core's price wins", async () => {
    const { db } = fakeValues();
    const values = createItemValueService(db as never);
    await values.setMany("g1", null, parseItemValues("Sulfuras, Hand of Ragnaros = 200\nRing of X = 40").values);
    await values.setMany("g1", CORE, parseItemValues("Sulfuras, Hand of Ragnaros = 250\nCore Only Cloak = 60").values);
    expect(await values.priceOf("g1", CORE, { name: "sulfuras, hand of ragnaros" })).toBe(250);
    expect(await values.priceOf("g1", null, { name: "Sulfuras, Hand of Ragnaros" })).toBe(200);
    expect(await values.priceOf("g1", CORE, { name: "Ring of X" })).toBe(40); // the guild price fills in
    expect(await values.priceOf("g1", null, { name: "Core Only Cloak" })).toBeNull();
    expect((await values.effective("g1", CORE)).map((row) => `${row.name}:${row.gp}`).sort()).toEqual(["Core Only Cloak:60", "Ring of X:40", "Sulfuras, Hand of Ragnaros:250"]);
  });

  it("finds a price by item id, and prefers a name match", async () => {
    const { db } = fakeValues();
    const values = createItemValueService(db as never);
    await values.setMany("g1", CORE, parseItemValues("19019 = 90\nThunderfury = 120").values);
    expect(await values.priceOf("g1", CORE, { id: 19019 })).toBe(90);
    expect(await values.priceOf("g1", CORE, { name: "Thunderfury", id: 19019 })).toBe(120);
    expect(await values.priceOf("g1", CORE, { name: "Nothing", id: null })).toBeNull();
  });

  it("changing a price updates it; remove and clear work; lists are separate", async () => {
    const { db, rows } = fakeValues();
    const values = createItemValueService(db as never);
    await values.setMany("g1", CORE, parseItemValues("Cloak = 60\nHelm = 70").values);
    await values.setMany("g1", CORE, parseItemValues("Cloak = 65").values);
    expect(rows()).toHaveLength(2);
    expect(await values.priceOf("g1", CORE, { name: "cloak" })).toBe(65);
    expect(await values.remove("g1", CORE, { name: "Cloak", id: null })).toBe(true);
    expect(await values.remove("g1", CORE, { name: "Cloak", id: null })).toBe(false);
    await values.setMany("g1", null, parseItemValues("Guild Item = 10").values);
    expect(await values.clear("g1", CORE)).toBe(1);
    expect((await values.list("g1", null)).map((row) => row.name)).toEqual(["Guild Item"]);
    expect(rows().every((row) => row.coreId === GUILD_DEFAULT)).toBe(true);
  });

  it("describes a list and shortens a very long one", () => {
    expect(describeValues("Prices", [])).toBe("Prices: no prices set yet.");
    const many = Array.from({ length: 200 }, (_, i) => ({ key: `item ${i}`, id: null, name: `A fairly long item name number ${i}`, gp: i }));
    const text = describeValues("Prices", many);
    expect(text.length).toBeLessThanOrEqual(1950);
    expect(text).toContain("more.");
  });
});

// ---------- priority ranking ----------

const cand = (name: string, pr: number, over: Partial<PriorityCandidate> = {}): PriorityCandidate => ({
  memberId: name, displayName: name, character: `${name}-char`, wishPriority: 2, wishedAt: new Date("2026-10-01T00:00:00Z"), ep: 0, gp: 0, pr, ...over
});

describe("EPGP priority: who gets it", () => {
  it("highest PR first; ties go to the higher wishlist priority, then the earlier wish", () => {
    const ranked = rankCandidates([
      cand("low", 1), cand("tieLate", 4, { wishedAt: new Date("2026-10-03T00:00:00Z") }),
      cand("tieHigh", 4, { wishPriority: 1 }), cand("top", 9), cand("tieEarly", 4)
    ]);
    expect(ranked.map((row) => row.displayName)).toEqual(["top", "tieHigh", "tieEarly", "tieLate", "low"]);
  });

  function fakeDb(options: { roster?: string[] | null } = {}) {
    const wishes = [
      { itemKey: itemKey("Sulfuras, Hand of Ragnaros"), priority: 2, createdAt: new Date("2026-10-01T00:00:00Z"), character: { name: "Annchar", member: { id: "m1", displayName: "Ann" } } },
      { itemKey: itemKey("Sulfuras, Hand of Ragnaros"), priority: 1, createdAt: new Date("2026-10-02T00:00:00Z"), character: { name: "Bobchar", member: { id: "m2", displayName: "Bob" } } },
      { itemKey: itemKey("Sulfuras, Hand of Ragnaros"), priority: 3, createdAt: new Date("2026-10-02T00:00:00Z"), character: { name: "Bobalt", member: { id: "m2", displayName: "Bob" } } },
      { itemKey: itemKey("Sulfuras, Hand of Ragnaros"), priority: 2, createdAt: new Date("2026-10-02T00:00:00Z"), character: { name: "Outsider", member: { id: "m9", displayName: "Outsider" } } }
    ];
    const sums: Record<string, Record<string, { ep: number; gp: number }>> = {
      guild: { m1: { ep: 300, gp: 100 }, m2: { ep: 100, gp: 100 }, m9: { ep: 900, gp: 10 } },
      core: { m1: { ep: 50, gp: 0 }, m2: { ep: 10, gp: 40 }, m9: { ep: 900, gp: 10 } }
    };
    const { db: valueDb } = fakeValues();
    void createItemValueService(valueDb as never).setMany("g1", "core-1", [{ name: "Sulfuras, Hand of Ragnaros", id: null, gp: 250 }]);
    return {
      ...valueDb,
      wishlistEntry: { findMany: async () => wishes },
      epgpTransaction: { aggregate: async ({ where }: { where: { memberId: string; coreId: string | null } }) => {
        const row = sums[where.coreId ? "core" : "guild"]![where.memberId] ?? { ep: 0, gp: 0 };
        return { _sum: { epAmount: row.ep, gpAmount: row.gp } };
      } },
      raidCoreMember: { findMany: async () => (options.roster === undefined ? ["m1", "m2"] : options.roster ?? []).map((memberId) => ({ memberId })) }
    };
  }

  it("ranks the wishers of an item by PR, once per player, and leaves out people outside the core", async () => {
    const db = fakeDb();
    const result = await priorityFor(db as never, "g1", "Sulfuras, Hand of Ragnaros", { coreId: "core-1", separatePool: false, baseGp: 0 });
    expect(result.price).toBe(250);
    expect(result.outsideCore).toBe(1);
    expect(result.ranking.map((row) => `${row.displayName}:${row.character}:${row.pr}`)).toEqual(["Ann:Annchar:3", "Bob:Bobchar:1"]);
    const text = describePriority("Sulfuras", "Tuesday MC", result);
    expect(text).toContain("**Sulfuras** — 250 GP · Tuesday MC");
    expect(text).toContain("1. **Annchar** (Ann) — PR 3.00 (EP 300 / GP 100)");
    expect(text).toContain("Goes to **Annchar** for 250 GP");
    expect(text).toContain("1 wisher(s) are not in this core");
  });

  it("uses the core's own pool when it has one, and the base GP", async () => {
    const db = fakeDb();
    const result = await priorityFor(db as never, "g1", "Sulfuras, Hand of Ragnaros", { coreId: "core-1", separatePool: true, baseGp: 10 });
    expect(result.ranking.map((row) => `${row.displayName}:${row.pr}`)).toEqual(["Ann:5", "Bob:0.2"]); // 50/(0+10), 10/(40+10)
  });

  it("without a core everyone counts, and says so when nobody wants it or there is no price", async () => {
    const db = fakeDb();
    const all = await priorityFor(db as never, "g1", "Sulfuras, Hand of Ragnaros", { coreId: null, separatePool: false, baseGp: 0 });
    expect(all.ranking[0]?.displayName).toBe("Outsider");
    expect(all.price).toBeNull();
    expect(describePriority("Sulfuras", null, all)).toContain("no price set");
    const none = { price: 100, ranking: [], outsideCore: 0 };
    expect(describePriority("Cloak", null, none)).toContain("Nobody eligible wants it yet");
  });
});

// ---------- what the addon receives ----------

describe("the loot block written for the addon", () => {
  const LOOT = {
    default: "EPGP", minimumBid: 15,
    values: [{ key: "ring of x", id: null, gp: 40 }],
    cores: [
      { id: "c1", name: 'Tuesday "MC"', mode: "PRIORITY", separatePool: true, reserves: 1, baseGp: 10,
        values: [{ key: "sulfuras hand of ragnaros", id: 17182, gp: 250 }, { key: "#19019", id: 19019, gp: 90 }],
        standings: [{ character: "Ann", main: true, ep: 300, gp: 90 }],
        roster: [{ name: "Jaina", member: "Kev", role: "TANK", spot: "main", backup: false }, { name: "Anduin", member: "Kev", role: "HEALER", spot: "bench", backup: true }] }
    ]
  };
  const BASE = { updatedAt: "2026-10-01T00:00:00Z", baseGp: 0, standings: [], nextRaid: null };

  it("writes the system, prices (by name and by id) and own-pool standings", () => {
    const lua = standingsToLua({ ...BASE, loot: LOOT });
    expect(lua).toContain('GuildedLoot = {');
    expect(lua).toContain('default = "EPGP",');
    expect(lua).toContain("minimumBid = 15,");
    expect(lua).toContain('["ring of x"] = 40,');
    expect(lua).toContain('name = "Tuesday \\"MC\\"", mode = "PRIORITY", pool = true,');
    expect(lua).toContain('["sulfuras hand of ragnaros"] = 250,');
    expect(lua).toContain('["#17182"] = 250,');
    expect(lua).toContain('["#19019"] = 90,'); // not written twice
    expect(lua.match(/\["#19019"\]/g)).toHaveLength(1);
    expect(lua).toContain('{ name = "Ann", ep = 300, gp = 90 },');
    expect(lua).toContain('{ name = "Jaina", member = "Kev", role = "TANK", spot = "main", backup = false },');
    expect(lua).toContain('{ name = "Anduin", member = "Kev", role = "HEALER", spot = "bench", backup = true },');
  });

  it("writes nil when the bot sent no rules", () => {
    expect(standingsToLua({ ...BASE, loot: null })).toContain("GuildedLoot = nil");
  });

  it("collects each core's mode, prices and pool from the database", async () => {
    const { db: valueDb } = fakeValues();
    await createItemValueService(valueDb as never).setMany("g1", null, [{ name: "Guild Ring", id: null, gp: 40 }]);
    await createItemValueService(valueDb as never).setMany("g1", "c1", [{ name: "Sulfuras", id: null, gp: 250 }]);
    const database = {
      ...valueDb,
      guildSettings: { findUnique: async () => ({ lootMode: "COUNCIL", minimumBid: 20, baseGp: 5, attendanceDkp: 10, lateAttendanceDkp: 5, bossKillDkp: 5, epCompletionBonus: 0, epgpDecayPercent: 0.1 }) },
      raidCore: { findMany: async () => [
        { id: "c1", name: "Priority Core", lootMode: "PRIORITY", separatePool: true, reservesPerPlayer: null, baseGp: 10, members: [
          { role: "TANK", bench: false, trial: false, member: { displayName: "Kev", characters: [{ name: "Thrall" }] }, character: { name: "Jaina" }, backups: [{ role: "HEALER", character: { name: "Anduin" } }] },
          { role: "DPS", bench: true, trial: false, member: { displayName: "Amy", characters: [{ name: "Amyx" }] }, character: null, backups: [] },
          { role: "DPS", bench: false, trial: true, member: { displayName: "New", characters: [] }, character: null, backups: [] }
        ] },
        { id: "c2", name: "Follows Guild", lootMode: null, separatePool: false, reservesPerPlayer: null, members: [] },
        { id: "c3", name: "Reserve Core", lootMode: "RESERVE", separatePool: false, reservesPerPlayer: 2, members: [] }
      ] }
    };
    const rules = await lootRulesForAddon(database as never, "g1", async (coreId, baseGp) => [{ character: `pool-${coreId}-${baseGp}`, main: true, ep: 1, gp: 2 }]);
    expect(rules.default).toBe("COUNCIL");
    expect(rules.minimumBid).toBe(20);
    expect(rules.values.map((row) => row.key)).toEqual(["guild ring"]);
    expect(rules.cores.map((core) => `${core.name}:${core.mode}:${core.reserves}`)).toEqual(["Priority Core:PRIORITY:1", "Follows Guild:COUNCIL:1", "Reserve Core:RESERVE:2"]);
    // Prices only matter for priority cores; the guild-wide ones come along with them.
    expect(rules.cores[0]?.values.map((row) => `${row.key}=${row.gp}`).sort()).toEqual(["guild ring=40", "sulfuras=250"]);
    expect(rules.cores[1]?.values).toEqual([]);
    expect(rules.cores[0]?.standings).toEqual([{ character: "pool-c1-10", main: true, ep: 1, gp: 2 }]);
    expect(rules.cores[1]?.standings).toEqual([]);
    // The roster by in-game character: the character brought to the core, else the main; backups
    // as their own rows; nobody without a linked character.
    expect(rules.cores[0]?.roster).toEqual([
      { name: "Jaina", member: "Kev", role: "TANK", spot: "main", backup: false },
      { name: "Anduin", member: "Kev", role: "HEALER", spot: "main", backup: true },
      { name: "Amyx", member: "Amy", role: "DPS", spot: "bench", backup: false }
    ]);
    expect(rules.cores[1]?.roster).toEqual([]);
  });
});
