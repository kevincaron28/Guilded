import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { findCharacter, ledgerOwner } from "../src/services/character-match.js";
import { foreverNameMatches, foreverSameName } from "../companion/character-identity.mjs";
import { personalSnapshot } from "../src/services/companion-access.js";
import { parseAddonSnapshot, type AddonCharacter } from "../src/integrations/addon.js";
import { relayableDungeonRuns } from "../src/services/guildmate-relay.js";
import { applyForeverNames, describePlan, planForeverNames } from "../src/services/forever-names.js";
import { importDuelResults } from "../src/services/duels.js";
import { planRosterGaps } from "../src/services/roster-gaps.js";
import { loadRaceBoardData } from "../src/services/race-board.js";
import { linkPairedCharacter } from "../src/services/character-pairing.js";

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
    expect(findCharacter([row("Lebowski", { displayName: "Lebowski Greenleaf" })], "Lebowski Holyroller", "Forever", "forever")).toBeUndefined();
    expect(findCharacter([row("Lebowski", { displayName: "Lebowski Greenleaf" })], "Lebowski Greenleaf", "Forever", "forever")?.id).toBe("Lebowski");
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
});

describe("ledger: EP/GP rows from an 8.4 addon (first name only)", () => {
  it("go to the member when every character with that first name is theirs, are held when several members share it", () => {
    const sameMember = [row("Lebowski Holyroller"), row("Lebowski Greenleaf")];
    expect(ledgerOwner(sameMember, "Lebowski", "Forever", "forever")).toMatchObject({ memberId: "m" });
    const twoMembers = [row("Lebowski Holyroller"), row("Lebowski Smith", { memberId: "other" })];
    expect(ledgerOwner(twoMembers, "Lebowski", "Forever", "forever")).toBe("shared");
    // A full name always goes to its own character, whoever else shares the first name.
    expect(ledgerOwner(twoMembers, "Lebowski Smith", "Forever", "forever")).toMatchObject({ memberId: "other" });
    expect(ledgerOwner(twoMembers, "Walter", "Forever", "forever")).toBeUndefined();
    expect(ledgerOwner([row("Amy", { gameEdition: "retail", realm: "area52" })], "Amy-Illidan", "", "retail")).toBeUndefined();
  });
});

describe("duels with alts sharing a first name", () => {
  function duelTx() {
    const created: Record<string, unknown>[] = [];
    return { created, tx: { duelResult: {
      findFirst: async () => null, count: async () => 0,
      createMany: async ({ data }: { data: Record<string, unknown>[] }) => { created.push(...data); return { count: data.length }; }
    } } };
  }
  const now = new Date("2026-12-20T12:00:00Z");
  const at = Math.floor(now.getTime() / 1000) - 60;
  const characters = [
    { name: "Lebowski Holyroller", memberId: "dude" }, { name: "Lebowski Greenleaf", memberId: "dude" },
    { name: "Lebowski Smith", memberId: "maude" }, { name: "Walter Sobchak", memberId: "walter" }
  ];

  it("credits the exact alt by full name", async () => {
    const { tx, created } = duelTx();
    const result = await importDuelResults(tx as never, "g", "forever", "dude", characters as never,
      [{ winner: "Lebowski Greenleaf", loser: "Lebowski Smith", at, reason: "knockout" }], now);
    expect(result.recorded).toBe(1);
    expect(created[0]).toMatchObject({ winnerId: "dude", loserId: "maude", winnerCharacter: "Lebowski Greenleaf", loserCharacter: "Lebowski Smith" });
  });

  it("refuses a first name shared by two members (8.4 reporter) instead of guessing", async () => {
    const { tx } = duelTx();
    const result = await importDuelResults(tx as never, "g", "forever", "walter", characters as never,
      [{ winner: "Walter", loser: "Lebowski", at, reason: "knockout" }], now);
    expect(result).toMatchObject({ recorded: 0, rejected: 1 });
  });
});

describe("dungeon runs and personal uploads", () => {
  it("a run's players map to each alt by full name", () => {
    const rows = [row("Lebowski Holyroller"), row("Lebowski Greenleaf", { memberId: "m2" })];
    const players = ["Lebowski Greenleaf", "Lebowski Holyroller"].map((name) => findCharacter(rows, name, "Forever", "forever")?.memberId);
    expect(players).toEqual(["m2", "m"]);
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

describe("linking a member's own alts", () => {
  function linkDb(rows: Record<string, unknown>[]) {
    const tx = {
      character: {
        findMany: async () => rows.map((r) => ({ ...r, member: { discordUserId: "u" } })),
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(rows.find((r) => r["id"] === where.id)!, data),
        count: async () => 1,
        create: async ({ data }: { data: Record<string, unknown> }) => { const created = { id: `new-${rows.length}`, ...data }; rows.push(created); return created; }
      },
      characterVerifyClaim: { findFirst: async () => null },
      professionSkill: { upsert: async () => ({}) },
      unclaimedCharacter: { deleteMany: async () => ({ count: 0 }) }
    };
    return { $transaction: async (fn: (client: typeof tx) => unknown) => fn(tx) } as never;
  }
  const alt = (name: string): AddonCharacter => ({ name, realm: "Forever", class: "PRIEST", race: "Human", level: 20, spec: "", professions: [], gameEdition: "forever" } as AddonCharacter);

  it("the first upload renames the old first-name row; the next alt with that first name gets its own row", async () => {
    const rows: Record<string, unknown>[] = [{ id: "c1", name: "Lebowski", realm: "Forever", gameEdition: "forever", memberId: "m", displayName: null }];
    const db = linkDb(rows);
    expect(await linkPairedCharacter(db, "g", "m", alt("Lebowski Holyroller"))).toBe("already-linked");
    expect(rows[0]).toMatchObject({ name: "Lebowski Holyroller", legacyName: "Lebowski" });
    expect(await linkPairedCharacter(db, "g", "m", alt("Lebowski Greenleaf"))).toBe("linked");
    expect(rows.map((r) => r["name"])).toEqual(["Lebowski Holyroller", "Lebowski Greenleaf"]);
  });
});

describe("roster gaps and the race board", () => {
  it("/ginvite lines name each alt in full", () => {
    const gaps = planRosterGaps({ syncFresh: true, members: [{ discordUserId: "u", displayName: "Dude", isBot: false, roleIds: [] }],
      characters: [{ discordUserId: "u", name: "Lebowski Holyroller", isMain: true, guildRankAt: null }, { discordUserId: "u", name: "Lebowski Greenleaf", isMain: false, guildRankAt: null }],
      unclaimed: [] });
    expect(gaps.notInGuild[0]).toMatchObject({ inviteName: "Lebowski Holyroller", others: ["Lebowski Greenleaf"] });
  });

  it("two alts are two race rows", async () => {
    const stored: { nameKey: string }[] = [];
    const db = {
      character: { findMany: async ({ where }: { where: { member?: { raceHidden?: boolean } } }) => where.member?.raceHidden ? [] : [
        { name: "Lebowski Holyroller", realm: "Forever", className: "Priest", race: "Human", level: 30, memberId: "m", lastSeenAt: null, member: { discordUserId: "u" }, professions: [] },
        { name: "Lebowski Greenleaf", realm: "Forever", className: "Druid", race: "Human", level: 25, memberId: "m", lastSeenAt: null, member: { discordUserId: "u" }, professions: [] }] },
      unclaimedCharacter: { findMany: async () => [] },
      levelRaceEntry: { findMany: async () => stored, upsert: async ({ create }: { create: { nameKey: string } }) => { stored.push(create); return create; } }
    };
    await loadRaceBoardData(db as never, "g", "forever", new Date("2026-12-20T12:00:00Z"));
    expect(stored.map((entry) => entry.nameKey).sort()).toEqual(["lebowski greenleaf", "lebowski holyroller"]);
  });
});

describe("owner backfill (scripts/forever-names.ts)", () => {
  const characters = [
    { id: "halidor", guildId: "g", name: "Halidor", displayName: "Halidor  Galemorne" },
    { id: "naomine", guildId: "g", name: "Naomine", displayName: null },
    { id: "leb", guildId: "g", name: "Lebowski", displayName: "Lebowski Greenleaf" },
    { id: "leb2", guildId: "g", name: "Lebowski Holyroller", displayName: "Lebowski Holyroller" },
    { id: "other", guildId: "h", name: "Halidor", displayName: "Halidor Other" }
  ];
  const unclaimed = [{ id: "u1", guildId: "g", name: "Dude", displayName: "Dude Lebowski" }, { id: "u2", guildId: "g", name: "Walter", displayName: null }];

  it("plans renames only for unambiguous rows, and lists the rest for an officer", () => {
    const plan = planForeverNames(characters, unclaimed);
    expect(plan.renames.map((r) => `${r.id}:${r.to}`)).toEqual(["halidor:Halidor Galemorne", "other:Halidor Other", "u1:Dude Lebowski"]);
    expect(plan.review.map((r) => `${r.id}:${r.reason}`)).toEqual(["naomine:no full name known", "leb:shared first name"]);
    const text = describePlan(plan, new Map([["g", "Achievers"], ["h", "Other"]])).join("\n");
    expect(text).toContain("Achievers: 2 to rename, 1 sharing a first name (left as is), 1 with no full name yet");
    expect(text).toContain("REVIEW character Lebowski");
  });

  it("applies them without deleting or merging, keeping the old name and moving its keys", async () => {
    const rows = characters.map((c) => ({ ...c, gameEdition: "forever", realm: "Forever", legacyName: null as string | null }));
    const unclaimedRows = unclaimed.map((u) => ({ ...u, nameKey: u.name.toLowerCase(), legacyName: null as string | null }));
    const claims = [{ id: "c1", guildId: "g", memberId: "m", nameKey: "halidor" }];
    const race = [{ id: "r1", guildId: "g", nameKey: "halidor", name: "Halidor" }, { id: "r2", guildId: "g", nameKey: "dude", name: "Dude" }];
    const find = <T extends Record<string, unknown>>(list: T[], where: Record<string, unknown>) => list.find((item) => Object.entries(where).every(([k, v]) => item[k] === v));
    const tx = {
      character: { findUnique: async ({ where }: { where: { id: string } }) => find(rows, where) ?? null,
        findFirst: async ({ where }: { where: Record<string, unknown> }) => find(rows, where) ?? null,
        update: async ({ where, data }: { where: { id: string }; data: object }) => Object.assign(find(rows, where)!, data) },
      unclaimedCharacter: { findUnique: async ({ where }: { where: { id: string } }) => find(unclaimedRows, where) ?? null,
        findFirst: async ({ where }: { where: Record<string, unknown> }) => find(unclaimedRows, where) ?? null,
        update: async ({ where, data }: { where: { id: string }; data: object }) => Object.assign(find(unclaimedRows, where)!, data) },
      characterVerifyClaim: { findMany: async ({ where }: { where: Record<string, unknown> }) => claims.filter((c) => c.guildId === where["guildId"] && c.nameKey === where["nameKey"]),
        findFirst: async ({ where }: { where: Record<string, unknown> }) => find(claims, where) ?? null,
        update: async ({ where, data }: { where: { id: string }; data: object }) => Object.assign(find(claims, where)!, data) },
      levelRaceEntry: { findFirst: async ({ where }: { where: Record<string, unknown> }) => find(race, where) ?? null,
        update: async ({ where, data }: { where: { id: string }; data: object }) => Object.assign(find(race, where)!, data) },
      raceHallEntry: { findFirst: async () => null, update: async () => ({}) }
    };
    const result = await applyForeverNames(tx as never, planForeverNames(characters, unclaimed).renames);
    expect(result).toEqual({ renamed: 3, keysMoved: 3, keysKept: 0 });
    expect(rows.map((r) => [r.name, r.legacyName])).toEqual([["Halidor Galemorne", "Halidor"], ["Naomine", null], ["Lebowski", null],
      ["Lebowski Holyroller", null], ["Halidor Other", "Halidor"]]);
    expect(unclaimedRows[0]).toMatchObject({ name: "Dude Lebowski", nameKey: "dude lebowski", legacyName: "Dude" });
    expect(claims[0]!.nameKey).toBe("halidor galemorne");
    expect(race.map((r) => r.nameKey)).toEqual(["halidor galemorne", "dude lebowski"]);
    // Running it again changes nothing.
    expect(await applyForeverNames(tx as never, planForeverNames(rows, unclaimedRows).renames)).toEqual({ renamed: 0, keysMoved: 0, keysKept: 0 });
  });
});

describe("migration 20261226000000_forever_full_names", () => {
  const db = new PGlite();
  beforeAll(async () => {
    await db.exec(`CREATE TABLE "Character" (id TEXT PRIMARY KEY, name TEXT); CREATE TABLE "UnclaimedCharacter" (id TEXT PRIMARY KEY, name TEXT);
      INSERT INTO "Character" VALUES ('c', 'Lebowski'); INSERT INTO "UnclaimedCharacter" VALUES ('u', 'Dude');`);
    await db.exec(readFileSync(new URL("../prisma/migrations/20261226000000_forever_full_names/migration.sql", import.meta.url), "utf8"));
  });
  afterAll(() => db.close());

  it("only adds a nullable column; existing rows are untouched", async () => {
    expect((await db.query(`SELECT * FROM "Character"`)).rows).toEqual([{ id: "c", name: "Lebowski", legacyName: null }]);
    expect((await db.query(`SELECT * FROM "UnclaimedCharacter"`)).rows).toEqual([{ id: "u", name: "Dude", legacyName: null }]);
  });
});

describe("race to 60 key cleanup", () => {
  const level = (id: string, nameKey: string, name = nameKey) => ({ id, guildId: "g1", nameKey, name });
  it("merges a first-name key into the one full name that extends it, and moves a lone one", async () => {
    const { planRaceKeyMerges } = await import("../src/services/forever-names.js");
    const plan = planRaceKeyMerges("level", [level("a", "chad", "Chad"), level("b", "chad ho", "Chad Ho"), level("c", "hulke", "Hulke"), level("d", "sam"), level("e", "sam a"), level("f", "sam b")],
      new Map([["g1\nhulke hogan", "Hulke Hogan"]]));
    expect(plan.map(m => [m.fromId, m.toId, m.toKey])).toEqual([["a", "b", "chad ho"], ["c", null, "hulke hogan"]]);
  });
  it("applies a merge keeping the highest level and earliest dates, and deletes the first-name row", async () => {
    const { applyRaceKeyMerges } = await import("../src/services/forever-names.js");
    const from = { id: "a", level: 50, reachedMaxAt: null, firstSeenAt: new Date("2026-11-04T00:00:00Z") };
    const to = { id: "b", level: 44, reachedMaxAt: null, firstSeenAt: new Date("2026-11-07T00:00:00Z") };
    const store = { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => where.id === "a" ? from : to), update: vi.fn(), delete: vi.fn() };
    const result = await applyRaceKeyMerges({ levelRaceEntry: store, raceHallEntry: store } as never, [{ store: "level", guildId: "g1", fromId: "a", toId: "b", toKey: "chad ho", toName: "Chad Ho" }]);
    expect(result).toEqual({ merged: 1, moved: 0 });
    expect(store.update).toHaveBeenCalledWith({ where: { id: "b" }, data: expect.objectContaining({ level: 50, firstSeenAt: from.firstSeenAt, name: "Chad Ho" }) });
    expect(store.delete).toHaveBeenCalledWith({ where: { id: "a" } });
  });
});
