import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readAddonExport } from "../companion/lua-export.mjs";
import { parseAddonSnapshot } from "../src/integrations/addon.js";
import { applyRecipeData, describeCooldowns, describeCrafters, fallbackName, findCrafters, recipeNameSuggestions, runCooldownPings } from "../src/services/recipes.js";

// ---------- the companion's export of the addon's saved data ----------

const LUA = `
GuildedDB = {
  ["guildKey"] = "Quebec Gold-Forever",
  ["recipeBook"] = {
    ["people"] = {
      ["Ann"] = { ["Alchemy"] = { ["v"] = 1790000000, ["keys"] = { [1] = 1001, [2] = 1002 } } },
      ["Bob"] = { ["Enchanting"] = { ["v"] = 1790000100, ["keys"] = { [1] = -7418 } } },
    },
    ["names"] = { [1001] = "Elixir of X", [-7418] = "Enchant Bracer - Minor Health" },
    ["cooldowns"] = {
      ["Ann"] = { [1] = { ["prof"] = "Alchemy", ["name"] = "Transmute", ["readyAt"] = 1799990000 } },
      ["Cy"] = { [1] = { ["prof"] = "Tailoring", ["name"] = "Mooncloth", ["readyAt"] = 1000 } },
    },
    ["cooldownAt"] = { ["Ann"] = 1799900000 },
  },
  ["exports"] = { ["2026-10-01T19:00:00Z"] = true },
}
`;

describe("companion export of recipes and cooldowns", () => {
  let dir = "";
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });

  it("sends every list with its known names, recent cooldowns, and validates against the bot's schema", async () => {
    dir = await mkdtemp(join(tmpdir(), "qg-recipes-"));
    const file = join(dir, "Guilded.lua");
    await writeFile(file, LUA, "utf8");
    const snapshot = parseAddonSnapshot(await readAddonExport(file, "Forever"));
    expect(snapshot.recipes.map((set) => `${set.character}:${set.profession}:${set.keys.join("/")}`).sort()).toEqual(["Ann:Alchemy:1001/1002", "Bob:Enchanting:-7418"]);
    expect(snapshot.recipeNames).toEqual({ "1001": "Elixir of X", "-7418": "Enchant Bracer - Minor Health" });
    // Cy's cooldown ended long ago (year 1970): not sent.
    expect(snapshot.cooldowns.map((set) => set.character)).toEqual(["Ann"]);
    expect(snapshot.cooldowns[0]?.entries[0]).toMatchObject({ profession: "Alchemy", name: "Transmute" });
    expect(snapshot.cooldowns[0]?.entries[0]?.readyAt.getTime()).toBe(1799990000 * 1000);
  });
});

// ---------- a small in-memory stand-in for the tables ----------

type Recipe = { id: string; guildId: string; character: string; realm: string; profession: string; itemKey: number; itemName: string; scannedAt: Date };
type Cooldown = { id: string; guildId: string; character: string; realm: string; profession: string; name: string; readyAt: Date; scannedAt: Date; notifiedAt: Date | null };

function fakeDb(characters: { name: string; realm: string; member: { displayName: string; guildId: string; discordUserId: string } }[] = []) {
  let recipes: Recipe[] = [];
  let cooldowns: Cooldown[] = [];
  let next = 1;
  const match = (row: Record<string, unknown>, where: Record<string, unknown>): boolean => Object.entries(where).every(([key, value]) => {
    if (key === "OR") return (value as Record<string, unknown>[]).some((option) => match(row, option));
    const actual = row[key];
    if (value && typeof value === "object" && !(value instanceof Date)) {
      const v = value as Record<string, unknown>;
      if ("contains" in v) return String(actual).toLowerCase().includes(String(v["contains"]).toLowerCase());
      if ("startsWith" in v) return String(actual).startsWith(String(v["startsWith"]));
      if ("in" in v) return (v["in"] as unknown[]).includes(actual);
      if ("lte" in v || "gt" in v) {
        const t = (actual as Date).getTime();
        return (!("lte" in v) || t <= (v["lte"] as Date).getTime()) && (!("gt" in v) || t > (v["gt"] as Date).getTime());
      }
    }
    return actual === value;
  });
  const table = <T extends { id: string }>(rows: () => T[], set: (r: T[]) => void) => ({
    findMany: async ({ where = {}, orderBy, take, distinct }: { where?: Record<string, unknown>; orderBy?: Record<string, "asc" | "desc"> | Record<string, "asc" | "desc">[]; take?: number; distinct?: string[] }) => {
      let out = rows().filter((row) => match(row as never, where));
      for (const order of [...(Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [])].reverse()) {
        const [key, dir] = Object.entries(order)[0] as [string, "asc" | "desc"];
        out = [...out].sort((a, b) => {
          const x = (a as never)[key] as string | number | Date, y = (b as never)[key] as string | number | Date;
          const cmp = x instanceof Date ? x.getTime() - (y as Date).getTime() : typeof x === "number" ? x - (y as number) : String(x).localeCompare(String(y));
          return dir === "desc" ? -cmp : cmp;
        });
      }
      if (distinct) { const seen = new Set<string>(); out = out.filter((row) => { const id = distinct.map((k) => String((row as never)[k])).join("|"); if (seen.has(id)) return false; seen.add(id); return true; }); }
      return out.slice(0, take ?? 1000);
    },
    deleteMany: async ({ where }: { where: Record<string, unknown> }) => { set(rows().filter((row) => !match(row as never, where))); },
    createMany: async ({ data, skipDuplicates }: { data: Record<string, unknown>[]; skipDuplicates?: boolean }) => {
      for (const item of data) {
        const keyOf = (r: Record<string, unknown>) => ["guildId", "character", "realm", "itemKey", "profession", "name"].map((k) => r[k]).join("|");
        if (skipDuplicates && rows().some((row) => keyOf(row as never) === keyOf(item))) continue;
        set([...rows(), { id: `r${next++}`, ...item } as unknown as T]);
      }
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      for (const row of rows()) if (match(row as never, where)) Object.assign(row, data);
    },
    aggregate: async ({ where }: { where: Record<string, unknown> }) => {
      const times = rows().filter((row) => match(row as never, where)).map((row) => (row as never as { scannedAt: Date }).scannedAt.getTime());
      return { _max: { scannedAt: times.length ? new Date(Math.max(...times)) : null } };
    }
  });
  const db = {
    recipeKnown: table(() => recipes, (r) => { recipes = r; }),
    professionCooldown: table(() => cooldowns, (r) => { cooldowns = r; }),
    unclaimedCharacter: { findMany: async () => [] },
    character: { findMany: async ({ where }: { where: { member: { cooldownPings?: boolean } } }) => characters.filter((c) => !where.member.cooldownPings || (c.member as { cooldownPings?: boolean }).cooldownPings) }
  };
  return { db, recipes: () => recipes, cooldowns: () => cooldowns };
}

const at = (iso: string) => new Date(iso);
const set = (character: string, profession: string, keys: number[], when = "2026-10-01T18:00:00Z") => ({ character, realm: "F", profession, at: at(when), keys });

describe("applyRecipeData", () => {
  it("does not resurrect stale recipes or cooldowns for a confirmed dropped profession", async () => {
    const { db, recipes, cooldowns } = fakeDb();
    db.character.findMany = async () => [{ name: "Ann", realm: "F", professionsUpdatedAt: at("2026-10-02T18:00:00Z"), professions: [{ profession: "Mining" }], member: { displayName: "Ann", guildId: "g1", discordUserId: "u1" } }];
    await applyRecipeData(db as never, "g1", { recipes: [set("Ann", "Alchemy", [1001])], recipeNames: {}, cooldowns: [{ character: "Ann", realm: "F", at: at("2026-10-01T18:00:00Z"), entries: [{ profession: "Alchemy", name: "Transmute", readyAt: at("2026-10-03T18:00:00Z") }] }] });
    expect(recipes()).toEqual([]);
    expect(cooldowns()).toEqual([]);
  });

  it("stores each list with names, using placeholders for names nobody knows yet", async () => {
    const { db, recipes } = fakeDb();
    const summary = await applyRecipeData(db as never, "g1", { recipes: [set("Ann", "Alchemy", [1001, 1002, -7418])], recipeNames: { "1001": "Elixir of X" }, cooldowns: [] });
    expect(summary).toEqual({ recipeSets: 1, recipes: 3, cooldownSets: 0 });
    expect(recipes().map((row) => row.itemName).sort()).toEqual(["Elixir of X", fallbackName(-7418), fallbackName(1002)].sort());
  });

  it("replaces a character's list only with a newer one, and keeps real names over placeholders", async () => {
    const { db, recipes } = fakeDb();
    await applyRecipeData(db as never, "g1", { recipes: [set("Ann", "Alchemy", [1001, 1002])], recipeNames: { "1001": "Elixir of X" }, cooldowns: [] });
    // Older list: ignored.
    expect((await applyRecipeData(db as never, "g1", { recipes: [set("Ann", "Alchemy", [5], "2026-10-01T17:00:00Z")], recipeNames: {}, cooldowns: [] })).recipeSets).toBe(0);
    // Newer list without names: the name learned before is kept.
    await applyRecipeData(db as never, "g1", { recipes: [set("Ann", "Alchemy", [1001, 1003], "2026-10-02T18:00:00Z")], recipeNames: {}, cooldowns: [] });
    expect(recipes().map((row) => `${row.itemKey}:${row.itemName}`).sort()).toEqual(["1001:Elixir of X", `1003:${fallbackName(1003)}`]);
  });

  it("fills in a placeholder when someone else later knows the name", async () => {
    const { db, recipes } = fakeDb();
    await applyRecipeData(db as never, "g1", { recipes: [set("Ann", "Alchemy", [1002])], recipeNames: {}, cooldowns: [] });
    await applyRecipeData(db as never, "g1", { recipes: [], recipeNames: { "1002": "Elixir of Y" }, cooldowns: [] });
    expect(recipes()[0]?.itemName).toBe("Elixir of Y");
  });

  it("stores cooldowns, and a rescan of the same cooldown keeps its 'already told' mark", async () => {
    const { db, cooldowns } = fakeDb();
    const entry = { profession: "Alchemy", name: "Transmute", readyAt: at("2026-10-01T20:00:00Z") };
    await applyRecipeData(db as never, "g1", { recipes: [], recipeNames: {}, cooldowns: [{ character: "Ann", realm: "F", at: at("2026-10-01T18:00:00Z"), entries: [entry] }] });
    cooldowns()[0]!.notifiedAt = at("2026-10-01T20:05:00Z");
    await applyRecipeData(db as never, "g1", { recipes: [], recipeNames: {}, cooldowns: [{ character: "Ann", realm: "F", at: at("2026-10-01T21:00:00Z"), entries: [{ ...entry, readyAt: at("2026-10-01T20:01:00Z") }] }] });
    expect(cooldowns()).toHaveLength(1);
    expect(cooldowns()[0]?.notifiedAt).toEqual(at("2026-10-01T20:05:00Z"));
    // A used-again cooldown (a day later) can be announced again.
    await applyRecipeData(db as never, "g1", { recipes: [], recipeNames: {}, cooldowns: [{ character: "Ann", realm: "F", at: at("2026-10-01T22:00:00Z"), entries: [{ ...entry, readyAt: at("2026-10-02T21:00:00Z") }] }] });
    expect(cooldowns()[0]?.notifiedAt).toBeNull();
  });
});

const CHARACTERS = [
  { name: "Ann", realm: "F", member: { displayName: "Annie", guildId: "g1", discordUserId: "u1", cooldownPings: true } },
  { name: "Bob", realm: "F", member: { displayName: "Bob", guildId: "g1", discordUserId: "u2", cooldownPings: false } }
];

describe("/craft who", () => {
  it("finds crafters by name or by id, with the Discord member when linked", async () => {
    const { db } = fakeDb(CHARACTERS);
    await applyRecipeData(db as never, "g1", {
      recipes: [set("Ann", "Alchemy", [1001]), set("Bob", "Alchemy", [1001, 1002]), set("Zed", "Tailoring", [1001])],
      recipeNames: { "1001": "Elixir of X", "1002": "Elixir of Y" }, cooldowns: []
    });
    const byName = await findCrafters(db as never, "g1", "elixir of x");
    expect(byName).toHaveLength(1);
    expect(byName[0]?.crafters.map((c) => `${c.character}:${c.member}`)).toEqual(["Ann:Annie", "Bob:Bob", "Zed:null"]);
    expect(await findCrafters(db as never, "g1", "1002")).toHaveLength(1);
    const text = describeCrafters("elixir", await findCrafters(db as never, "g1", "elixir"));
    expect(text).toContain("• **Elixir of X** — Ann (Annie) · Alchemy, Bob · Alchemy, Zed · Tailoring");
    expect(text).toContain("• **Elixir of Y** — Bob · Alchemy");
  });

  it("says so when nobody is known, and suggests names for autocomplete", async () => {
    const { db } = fakeDb();
    expect(describeCrafters("nothing", await findCrafters(db as never, "g1", "nothing"))).toMatch(/Nobody is known to craft "nothing"/);
    await applyRecipeData(db as never, "g1", { recipes: [set("Ann", "Alchemy", [1001, 1002])], recipeNames: { "1001": "Elixir of X", "1002": "Elixir of Y" }, cooldowns: [] });
    expect((await recipeNameSuggestions(db as never, "g1", "of y")).map((s) => s.value)).toEqual(["Elixir of Y"]);
  });
});

describe("cooldown list and pings", () => {
  const NOW = new Date("2026-10-01T20:30:00Z");
  const load = async (db: ReturnType<typeof fakeDb>["db"]) => applyRecipeData(db as never, "g1", {
    recipes: [], recipeNames: {},
    cooldowns: [
      { character: "Ann", realm: "F", at: at("2026-10-01T19:00:00Z"), entries: [{ profession: "Alchemy", name: "Transmute", readyAt: at("2026-10-01T20:00:00Z") }] },
      { character: "Bob", realm: "F", at: at("2026-10-01T19:00:00Z"), entries: [{ profession: "Tailoring", name: "Mooncloth", readyAt: at("2026-10-02T02:00:00Z") }] },
      { character: "Old", realm: "F", at: at("2026-10-01T19:00:00Z"), entries: [{ profession: "Alchemy", name: "Transmute", readyAt: at("2026-09-01T02:00:00Z") }] }
    ]
  });

  it("lists ready ones and upcoming ones (with a Discord countdown), skipping very old ones", async () => {
    const { db } = fakeDb(CHARACTERS);
    await load(db);
    const text = await describeCooldowns(db as never, "g1", { now: NOW });
    expect(text).toContain("• Ann — Transmute (Alchemy): **ready**");
    expect(text).toContain(`• Bob — Mooncloth (Tailoring): <t:${Math.floor(at("2026-10-02T02:00:00Z").getTime() / 1000)}:R>`);
    expect(text).not.toContain("Old");
    expect(await describeCooldowns(db as never, "g1", { now: NOW, characters: ["Bob"] })).not.toContain("Ann");
    expect(await describeCooldowns(db as never, "g1", { now: NOW, characters: ["Nobody"] })).toMatch(/None of your characters/);
  });

  it("DMs members who asked, once, and nobody else", async () => {
    const { db, cooldowns } = fakeDb(CHARACTERS);
    await load(db);
    const send = vi.fn(async () => undefined);
    const client = { users: { send } };
    expect(await runCooldownPings(client as never, db as never, NOW)).toBe(1);
    expect(send).toHaveBeenCalledWith("u1", expect.stringContaining("Ann — Transmute (Alchemy) is ready"));
    expect(cooldowns().find((row) => row.character === "Ann")?.notifiedAt).toEqual(NOW);
    expect(cooldowns().find((row) => row.character === "Bob")?.notifiedAt).toBeNull(); // not ready yet
    expect(await runCooldownPings(client as never, db as never, NOW)).toBe(0); // only once
    expect(send).toHaveBeenCalledTimes(1);
  });
});
