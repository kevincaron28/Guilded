import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findCharacter } from "../src/services/character-match.js";
import { foreverNameMatches, foreverSameName } from "../companion/character-identity.mjs";
import { personalSnapshot } from "../src/services/companion-access.js";
import { parseAddonSnapshot } from "../src/integrations/addon.js";
import { relayableDungeonRuns } from "../src/services/guildmate-relay.js";

// WoW Forever, 8.5: characters are keyed by "First Last". One player's alts often share the first
// name ("Lebowski Holyroller", "Lebowski Greenleaf"); before, they all collapsed into "Lebowski".

const row = (name: string, extra: Record<string, unknown> = {}) => ({ id: name, name, realm: "Forever", gameEdition: "forever", memberId: "m", ...extra });

describe("Forever name matching during the move to full names", () => {
  it("keeps two alts that share a first name apart", () => {
    const rows = [row("Lebowski Holyroller"), row("Lebowski Greenleaf")];
    expect(findCharacter(rows, "Lebowski Holyroller", "Forever", "forever")?.id).toBe("Lebowski Holyroller");
    expect(findCharacter(rows, "lebowski greenleaf", "Other", "forever")?.id).toBe("Lebowski Greenleaf");
    // A bare first name from an older addon is ambiguous here: no guess.
    expect(findCharacter(rows, "Lebowski", "Forever", "forever")).toBeUndefined();
  });

  it("matches a row stored before 8.5 (first name only) while it is the only candidate", () => {
    expect(findCharacter([row("Halidor")], "Halidor Galemorne", "Forever", "forever")?.id).toBe("Halidor");
    expect(findCharacter([row("Halidor Galemorne")], "Halidor", "Forever", "forever")?.id).toBe("Halidor Galemorne");
    // The old row is known to be another alt: not this one.
    expect(findCharacter([row("Lebowski", { displayName: "Lebowski Greenleaf" })], "Lebowski Holyroller", "Forever", "forever")).toBeUndefined();
    expect(findCharacter([row("Lebowski", { displayName: "Lebowski Greenleaf" })], "Lebowski Greenleaf", "Forever", "forever")?.id).toBe("Lebowski");
    // Never across editions, never for Blizzard realms.
    expect(findCharacter([row("Halidor", { gameEdition: "retail", realm: "area52" })], "Halidor Galemorne", "Forever", "forever")).toBeUndefined();
    expect(findCharacter([row("Amy", { gameEdition: "retail", realm: "area52" })], "Amy-Illidan", "", "retail")).toBeUndefined();
  });

  it("the shared helpers agree", () => {
    expect(foreverSameName("Lebowski", "lebowski holyroller")).toBe(true);
    expect(foreverSameName("Lebowski Holyroller", "Lebowski Greenleaf")).toBe(false);
    expect(foreverSameName("Leb", "Lebowski Holyroller")).toBe(false);
    expect(foreverNameMatches([{ name: "Lebowski Holyroller" }, { name: "Lebowski Greenleaf" }], "Lebowski")).toEqual([]);
    expect(foreverNameMatches([{ name: "Lebowski" }, { name: "Dude" }], "Lebowski Holyroller")).toEqual([{ name: "Lebowski" }]);
  });

  it("a member's own upload keeps both alts and still trusts the old first-name row for their own character", () => {
    const now = Math.floor(Date.now() / 1000);
    const snapshot = parseAddonSnapshot({ source: "Guilded", exportedAt: new Date(), gameEdition: "forever",
      character: { name: "Lebowski Holyroller", realm: "Forever", class: "PRIEST" },
      alts: [{ name: "Lebowski Greenleaf", realm: "Forever", class: "DRUID" }],
      readiness: [{ character: "Lebowski Holyroller", realm: "Forever" }, { character: "Lebowski Stranger", realm: "Forever" }],
      milestones: [{ character: "Lebowski Holyroller", realm: "Forever", kind: "level", ref: "level:10", value: 10, at: now }],
      dungeonRuns: [{ id: "run", endedAt: now - 60, players: [{ character: "Lebowski Holyroller", realm: "Forever" }] }] });
    const result = personalSnapshot(snapshot, [{ name: "Lebowski", realm: "Forever" }]);
    expect(result.character?.name).toBe("Lebowski Holyroller");
    expect(result.readiness.map((r) => r.character)).toEqual(["Lebowski Holyroller"]); // never a guildmate's "Lebowski"
    expect(result.milestones).toHaveLength(1);
    expect(result.dungeonRuns).toHaveLength(1);
  });

  it("a relayed run's reporter may be named either way", () => {
    const now = Math.floor(Date.now() / 1000);
    const run = { id: "r", endedAt: now - 60, reporterNames: ["Donny"], players: [{ character: "Donny Kerabatsos", realm: "Forever" }] };
    expect(relayableDungeonRuns([run], new Set(["walter sobchak"]), now)).toHaveLength(1);
  });
});

describe("migration 20261226000000_forever_full_names", () => {
  const db = new PGlite();
  beforeAll(async () => {
    await db.exec(`
      CREATE TABLE "Character" (id TEXT PRIMARY KEY, "guildId" TEXT, "gameEdition" TEXT, realm TEXT, name TEXT, "displayName" TEXT, UNIQUE ("guildId", "gameEdition", realm, name));
      CREATE TABLE "UnclaimedCharacter" (id TEXT PRIMARY KEY, "guildId" TEXT, "gameEdition" TEXT, "nameKey" TEXT, name TEXT, "displayName" TEXT, UNIQUE ("guildId", "nameKey"));
      CREATE TABLE "CharacterVerifyClaim" (id TEXT PRIMARY KEY, "guildId" TEXT, "memberId" TEXT, "nameKey" TEXT, status TEXT, UNIQUE ("guildId", "memberId", "nameKey"));
      CREATE TABLE "LevelRaceEntry" (id TEXT PRIMARY KEY, "guildId" TEXT, "nameKey" TEXT, name TEXT, UNIQUE ("guildId", "nameKey"));
      CREATE TABLE "RaceHallEntry" (id TEXT PRIMARY KEY, "guildId" TEXT, "nameKey" TEXT, name TEXT, UNIQUE ("guildId", "nameKey"));
      INSERT INTO "Character" VALUES
        ('halidor', 'g', 'forever', 'Forever', 'Halidor', 'Halidor  Galemorne'),
        ('noname', 'g', 'forever', 'Forever', 'Naomine', NULL),
        ('lebowski', 'g', 'forever', 'Forever', 'Lebowski', 'Lebowski Greenleaf'),
        ('lebowski2', 'g', 'forever', 'Forever', 'Lebowski Holyroller', 'Lebowski Holyroller'),
        ('retail', 'g', 'retail', 'area52', 'Amy', 'Amy Something'),
        ('other-guild', 'h', 'forever', 'Forever', 'Halidor', 'Halidor Other');
      INSERT INTO "UnclaimedCharacter" VALUES ('u1', 'g', 'forever', 'dude', 'Dude', 'Dude Lebowski'), ('u2', 'g', 'forever', 'walter', 'Walter', NULL);
      INSERT INTO "CharacterVerifyClaim" VALUES ('c1', 'g', 'm', 'halidor', 'REMOVED'), ('c2', 'g', 'm', 'lebowski', 'BLOCKED');
      INSERT INTO "LevelRaceEntry" VALUES ('l1', 'g', 'halidor', 'Halidor'), ('l2', 'g', 'dude', 'Dude'), ('l3', 'g', 'lebowski', 'Lebowski');
      INSERT INTO "RaceHallEntry" VALUES ('h1', 'g', 'halidor', 'Halidor');`);
    await db.exec(readFileSync(new URL("../prisma/migrations/20261226000000_forever_full_names/migration.sql", import.meta.url), "utf8"));
  });
  afterAll(() => db.close());

  it("renames a first-name row to the full name it already carries, with its keys", async () => {
    const names = (await db.query<{ id: string; name: string }>(`SELECT id, name FROM "Character" ORDER BY id`)).rows;
    expect(Object.fromEntries(names.map((r) => [r.id, r.name]))).toEqual({
      halidor: "Halidor Galemorne", // unique first name, full name known
      noname: "Naomine", // no full name known: left for the member's own upload
      lebowski: "Lebowski", // shares a first name with another character: left as is
      lebowski2: "Lebowski Holyroller",
      retail: "Amy", // Blizzard editions untouched
      "other-guild": "Halidor Other"
    });
    expect((await db.query(`SELECT "nameKey" FROM "CharacterVerifyClaim" ORDER BY id`)).rows).toEqual([{ nameKey: "halidor galemorne" }, { nameKey: "lebowski" }]);
    expect((await db.query(`SELECT "nameKey", name FROM "LevelRaceEntry" ORDER BY id`)).rows).toEqual([
      { nameKey: "halidor galemorne", name: "Halidor Galemorne" }, { nameKey: "dude lebowski", name: "Dude Lebowski" }, { nameKey: "lebowski", name: "Lebowski" }]);
    expect((await db.query(`SELECT "nameKey" FROM "RaceHallEntry"`)).rows).toEqual([{ nameKey: "halidor galemorne" }]);
    expect((await db.query(`SELECT "nameKey", name FROM "UnclaimedCharacter" ORDER BY id`)).rows).toEqual([
      { nameKey: "dude lebowski", name: "Dude Lebowski" }, { nameKey: "walter", name: "Walter" }]);
    expect((await db.query(`SELECT count(*)::int AS n FROM "Character"`)).rows).toEqual([{ n: 6 }]);
  });
});
