import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { parseAddonSnapshot } from "../src/integrations/addon.js";
import {
  PROFESSION_IDENTITIES, canonicalProfessionName, mergeProfessionSkills, normalizeProfessionName, professionBySkillLine, professionSpellings
} from "../src/services/profession-names.js";
import { canonicalProfession, professionName, professionTitle } from "../src/services/profession-style.js";
import { syncProfessionSnapshot } from "../src/services/profession-snapshot.js";
import { applyRecipeData } from "../src/services/recipes.js";

// 9 November 2026 (owner report): French and English WoW Forever clients report "Cuisine" and "Cooking", and the
// guild saw two professions. One canonical identity now: the English name, with the skill line id behind it.

describe("canonical profession names", () => {
  it("maps every client language and every skill line to one profession, with no name shared between two", () => {
    const owners = new Map<string, string>();
    for (const [canonical, identity] of Object.entries(PROFESSION_IDENTITIES)) {
      expect(professionBySkillLine(identity.skillLine)).toBe(canonical);
      for (const names of Object.values(identity.names)) for (const name of names) {
        expect(canonicalProfessionName(name), name).toBe(canonical);
        expect(owners.get(name.toLowerCase()) ?? canonical, `${name} belongs to two professions`).toBe(canonical);
        owners.set(name.toLowerCase(), canonical);
      }
    }
  });

  it("joins Cooking with Cuisine, ignoring case, accents and spacing, and keeps names it does not know", () => {
    for (const same of ["Cooking", "Cuisine", " cuisine ", "CUISINE", "cooking"]) expect(normalizeProfessionName(same)).toBe("Cooking");
    expect(normalizeProfessionName("Secourisme")).toBe("First Aid");
    expect(normalizeProfessionName("Premiers soins")).toBe("First Aid");
    expect(normalizeProfessionName("Peche")).toBe("Fishing");
    expect(normalizeProfessionName("Pêche")).toBe("Fishing");
    expect(normalizeProfessionName("Depecage")).toBe("Skinning");
    expect(normalizeProfessionName("Travail du cuir")).toBe("Leatherworking");
    expect(normalizeProfessionName("  Lockpicking ")).toBe("Lockpicking");
    expect(canonicalProfession("Cuisine")).toBe("Cooking");
    expect(canonicalProfession("Lockpicking")).toBeUndefined();
  });

  it("merges a profession reported under two names, keeping the highest skill", () => {
    expect(mergeProfessionSkills([{ name: "Cuisine", skillLevel: 300 }, { name: "Cooking", skillLevel: 150 }, { name: "Pêche", skillLevel: 75 }]))
      .toEqual([{ name: "Cooking", skillLevel: 300 }, { name: "Fishing", skillLevel: 75 }]);
    expect(professionSpellings("Cooking")).toEqual(expect.arrayContaining(["Cooking", "Cuisine"]));
  });

  it("shows one name in the guild's language", () => {
    expect(professionName("Cuisine", "en")).toBe("Cooking");
    expect(professionName("Cooking", "en")).toBe("Cooking");
    expect(professionName("Cooking", "fr")).toBe("Cuisine");
    expect(professionName("Cuisine", "fr")).toBe("Cuisine");
    expect(professionName("Secourisme", "fr")).toBe("Premiers soins");
    expect(professionTitle("Cuisine", "en")).toBe("🍖 Cooking");
  });

  it("keeps the migration's name list equal to the table in code", () => {
    const sql = readFileSync("prisma/migrations/20270130000000_canonical_profession_names/migration.sql", "utf8");
    const rows = [...sql.matchAll(/^\s+\('((?:[^']|'')+)', '([^']+)'\),?$/gm)].map((m) => [m[1]!.replace(/''/g, "'"), m[2]!] as const);
    const expected = new Map<string, string>();
    for (const [canonical, identity] of Object.entries(PROFESSION_IDENTITIES)) for (const names of Object.values(identity.names)) for (const name of names) expected.set(name.toLowerCase(), canonical);
    expect(new Map(rows)).toEqual(expected);
    expect(rows.length).toBe(expected.size);
  });
});

describe("a French and an English client arriving at the bot", () => {
  it("stores one profession row when Cooking and Cuisine both arrive for a character", async () => {
    const db = {
      character: { findUnique: vi.fn(async () => ({ professionsUpdatedAt: null })), update: vi.fn() },
      professionSkill: { deleteMany: vi.fn(), upsert: vi.fn() },
      recipeKnown: { deleteMany: vi.fn() }, professionCooldown: { deleteMany: vi.fn() }
    };
    await syncProfessionSnapshot(db as never, "g", { id: "c", name: "Ray", realm: "R" },
      [{ name: "Cuisine", skillLevel: 300 }, { name: "Cooking", skillLevel: 150 }, { name: "Pêche", skillLevel: 75 }], true, new Date("2026-11-09T10:00:00Z"));
    expect(db.professionSkill.deleteMany).toHaveBeenCalledWith({ where: { characterId: "c", profession: { notIn: ["Cooking", "Fishing"] } } });
    expect(db.professionSkill.upsert).toHaveBeenCalledTimes(2);
    expect(db.professionSkill.upsert.mock.calls.map(([arg]) => `${arg.create.profession}:${arg.create.skillLevel}`)).toEqual(["Cooking:300", "Fishing:75"]);
  });

  it("normalises professions, recipe sets and cooldowns of an upload from an older French addon", () => {
    const snapshot = parseAddonSnapshot({
      source: "Guilded", exportedAt: "2026-11-09T10:00:00.000Z",
      characters: [{ name: "Ray", realm: "WoW Forever", class: "MAGE", level: 20, professions: [{ name: "Cuisine", skillLevel: 120 }, { name: "Cooking", skillLevel: 100 }, { name: "Secourisme", skillLevel: 50 }] }],
      readiness: [{ character: "Ray", realm: "WoW Forever", professions: [{ name: "Cuisine", skillLevel: 120 }] }],
      recipes: [{ character: "Ray", realm: "WoW Forever", profession: "Cuisine", at: "2026-11-09T10:00:00Z", keys: [1] }],
      cooldowns: [{ character: "Ray", realm: "WoW Forever", at: "2026-11-09T10:00:00Z", entries: [{ profession: "Alchimie", name: "Transmute", readyAt: "2026-11-10T10:00:00Z" }] }]
    });
    expect(snapshot.characters[0]!.professions).toEqual([{ name: "Cooking", skillLevel: 120 }, { name: "First Aid", skillLevel: 50 }]);
    expect(snapshot.readiness[0]!.professions).toEqual([{ name: "Cooking", skillLevel: 120 }]);
    expect(snapshot.recipes[0]!.profession).toBe("Cooking");
    expect(snapshot.cooldowns[0]!.entries[0]!.profession).toBe("Alchemy");
  });

  it("keeps a French client's recipes and an English client's under the same profession", async () => {
    const created: { profession: string }[] = [];
    const recipe = { aggregate: vi.fn(async () => ({ _max: { scannedAt: null } })), findMany: vi.fn(async () => []), deleteMany: vi.fn(), updateMany: vi.fn(),
      createMany: vi.fn(async ({ data }: { data: { profession: string }[] }) => { created.push(...data); }) };
    const cooldown = { aggregate: vi.fn(async () => ({ _max: { scannedAt: null } })), findMany: vi.fn(async () => []), deleteMany: vi.fn(), createMany: vi.fn() };
    const tx = { recipeKnown: recipe, professionCooldown: cooldown, character: { findMany: async () => [] }, unclaimedCharacter: { findMany: async () => [] } };
    const at = new Date("2026-11-09T10:00:00Z");
    await applyRecipeData(tx as never, "g", {
      recipes: [{ character: "Amelie", realm: "F", profession: "Cuisine", at, keys: [555] }, { character: "Bob", realm: "F", profession: "Cooking", at, keys: [555] }],
      recipeNames: {},
      cooldowns: [{ character: "Amelie", realm: "F", at, entries: [{ profession: "Cuisine", name: "Pot", readyAt: at }] }]
    });
    expect(created.map((row) => row.profession)).toEqual(["Cooking", "Cooking"]);
    expect(cooldown.createMany.mock.calls[0]![0].data[0].profession).toBe("Cooking");
  });
});
