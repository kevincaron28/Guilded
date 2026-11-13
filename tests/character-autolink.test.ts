import { describe, expect, it, vi } from "vitest";
import { matchUnclaimed, nameCandidates } from "../src/services/character-autolink.js";
import { applyDiscoveredCharacters } from "../src/services/roster-discovery.js";

describe("Discord name to character name", () => {
  it("finds the character name inside a nickname, ignoring tags and accents", () => {
    expect(nameCandidates("Ray")).toEqual(["ray"]);
    expect(nameCandidates("[GOLD] Ray")).toEqual(["ray"]);
    expect(nameCandidates("Ray | Priest")).toEqual(expect.arrayContaining(["ray", "priest"]));
    expect(nameCandidates("Émile (he/him)")).toEqual(["emile"]);
    expect(nameCandidates("xX")).toEqual([]);
  });

  it("links only when exactly one Discord member fits", () => {
    const people = [
      { id: "d1", names: ["ray", "priest"] },
      { id: "d2", names: ["amy"] },
      { id: "d3", names: ["bob"] },
      { id: "d4", names: ["bob"] }
    ];
    const matches = matchUnclaimed([{ id: "c1", name: "Ray" }, { id: "c2", name: "Amy" }, { id: "c3", name: "Bob" }, { id: "c4", name: "Zed" }, { id: "c5", name: "Al" }], people);
    // Bob fits two members and Zed nobody; two-letter names are never guessed.
    expect(matches).toEqual([{ characterId: "c1", discordId: "d1" }, { characterId: "c2", discordId: "d2" }]);
  });
});

describe("discovering characters from the guild digests", () => {
  function tx() {
    const upserts: Record<string, unknown>[] = [];
    return {
      upserts,
      client: {
        character: { findUnique: vi.fn(async () => null), update: vi.fn(async () => ({})) },
        professionSkill: { upsert: vi.fn(async () => ({})) },
        unclaimedCharacter: {
          findUnique: vi.fn(async ({ where }: { where: { guildId_nameKey: { nameKey: string } } }) => (where.guildId_nameKey.nameKey === "known" ? { id: "u" } : null)),
          upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => { upserts.push(create); return create; })
        }
      }
    };
  }
  const entry = (name: string, extra: Record<string, unknown> = {}) => ({ name, realm: "Classic Beta PvP", class: "PRIEST", race: "Scourge", level: 6, spec: "", professions: [{ name: "Skinning", skillLevel: 3 }], ...extra });

  it("refreshes a linked character and remembers everyone else as unclaimed", async () => {
    const { client, upserts } = tx();
    const result = await applyDiscoveredCharacters(client as never, "g", [entry("Ray"), entry("Amy", { class: "MAGE" }), entry("Known")], [{ id: "c1", name: "Ray", realm: "Classic Beta PvP" }]);
    expect(result).toEqual({ refreshed: 1, discovered: 1 });
    expect(client.character.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "c1" }, data: expect.objectContaining({ className: "Priest", race: "Undead", level: 6 }) }));
    expect(client.professionSkill.upsert).toHaveBeenCalledTimes(1);
    expect(upserts.map((row) => [row["nameKey"], row["className"]])).toEqual([["amy", "Mage"], ["known", "Priest"]]);
  });

  it("ignores duplicates and entries without a class", async () => {
    const { client, upserts } = tx();
    const result = await applyDiscoveredCharacters(client as never, "g", [entry("Amy"), entry("amy"), entry("Nobody", { class: "" })], []);
    expect(result.discovered).toBe(1);
    expect(upserts).toHaveLength(1);
  });
});

describe("discovery of a whole guild's roster writes only what changed", () => {
  const COUNT = 120;
  const recent = () => new Date(Date.now() - 10 * 60_000);
  const entry = (name: string, extra: Record<string, unknown> = {}) => ({ name, realm: "Classic Beta PvP", class: "PRIEST", race: "Scourge", level: 6, spec: "", professions: [], ...extra });
  const names = Array.from({ length: COUNT }, (_, i) => `Person${i}`);

  function world() {
    const characterReads = vi.fn(async () => null);
    const update = vi.fn(async () => ({}));
    const unclaimedRows = names.slice(COUNT / 2).map((name, i) => ({ id: `u${i}`, nameKey: name.toLowerCase(), professionsUpdatedAt: new Date("2026-11-01T00:00:00Z"), lastSeenAt: recent(),
      className: "Priest", race: "Undead", level: 6, spec: null, displayName: null, guildRankName: null }));
    const findMany = vi.fn(async () => unclaimedRows);
    const upsert = vi.fn(async () => ({}));
    const updateMany = vi.fn(async () => ({}));
    const client = { character: { findUnique: characterReads, update }, professionSkill: { upsert: vi.fn() }, unclaimedCharacter: { findMany, findUnique: vi.fn(async () => null), upsert, updateMany }, recipeKnown: { deleteMany: vi.fn() }, professionCooldown: { deleteMany: vi.fn() } };
    const linked = names.slice(0, COUNT / 2).map((name, i) => ({ id: `c${i}`, name, realm: "Classic Beta PvP", className: "Priest", race: "Undead", level: 6, spec: null, displayName: null,
      guildRankName: null, guildRankIndex: null, lastSeenAt: recent(), professionsUpdatedAt: new Date("2026-11-01T00:00:00Z") }));
    return { client, linked, characterReads, update, findMany, upsert, updateMany };
  }

  it("an unchanged roster seen within the hour: no character update, no per-row reads, no unclaimed upsert", async () => {
    const { client, linked, characterReads, update, findMany, upsert, updateMany } = world();
    const result = await applyDiscoveredCharacters(client as never, "g", names.map((name) => entry(name)), linked);
    expect(result).toEqual({ refreshed: COUNT / 2, discovered: 0 });
    expect(update).not.toHaveBeenCalled();
    expect(characterReads).not.toHaveBeenCalled();
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(client.unclaimedCharacter.findUnique).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    // Their last seen is still refreshed, for all remembered unclaimed characters of the upload, in one statement.
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect((updateMany.mock.calls[0] as unknown as [{ where: { id: { in: string[] } } }])[0].where.id.in).toHaveLength(COUNT / 2);
  });

  it("a changed level, a new person and an hour-old sighting still write", async () => {
    const { client, linked, update, upsert } = world();
    linked[1]!.lastSeenAt = new Date(Date.now() - 2 * 3_600_000);
    const result = await applyDiscoveredCharacters(client as never, "g", [...names.map((name) => entry(name, name === "Person0" ? { level: 7 } : {})), entry("Newcomer")], linked);
    expect(update.mock.calls.map((call) => (call as unknown as [{ where: { id: string } }])[0].where.id).sort()).toEqual(["c0", "c1"]);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(result.discovered).toBe(1);
  });
});

describe("sole-newcomer auto-link counts every character an upload brought, remembered or new", () => {
  it("remembered unclaimed A plus brand-new B: two arrived, so nobody is linked", async () => {
    const hourAgo = new Date(Date.now() - 20 * 60_000);
    type Row = { id: string; guildId: string; nameKey: string; name: string; realm: string; className: string; race: string | null; level: number | null; spec: string | null; displayName: string | null; guildRankName: string | null;
      professionsUpdatedAt: Date | null; lastSeenAt: Date; gameEdition: string };
    const rows: Row[] = [{ id: "uA", guildId: "g", nameKey: "alpha", name: "Alpha", realm: "R", className: "Priest", race: "Undead", level: 6, spec: null, displayName: null, guildRankName: null,
      professionsUpdatedAt: new Date("2026-11-01T00:00:00Z"), lastSeenAt: hourAgo, gameEdition: "forever" }];
    const member = { id: "m1", displayName: "Newbie" };
    const linkedTo: string[] = [];
    const db = {
      character: { findFirst: vi.fn(async () => null), findUnique: vi.fn(async () => null), update: vi.fn() },
      professionSkill: { upsert: vi.fn() }, recipeKnown: { deleteMany: vi.fn() }, professionCooldown: { deleteMany: vi.fn() },
      unclaimedCharacter: {
        findMany: vi.fn(async ({ where }: { where: { nameKey?: { in: string[] }; lastSeenAt?: { gte: Date }; gameEdition?: string } }) => rows.filter((row) =>
          (!where.nameKey || where.nameKey.in.includes(row.nameKey)) && (!where.lastSeenAt || row.lastSeenAt >= where.lastSeenAt.gte) && (!where.gameEdition || row.gameEdition === where.gameEdition))),
        findUnique: vi.fn(async () => null),
        upsert: vi.fn(async ({ create }: { create: Omit<Row, "id" | "lastSeenAt"> & { lastSeenAt: Date } }) => { rows.push({ ...create, id: `u${rows.length}` } as Row); return create; }),
        updateMany: vi.fn(async ({ where, data }: { where: { id: { in: string[] } }; data: { lastSeenAt: Date } }) => { for (const row of rows) if (where.id.in.includes(row.id)) row.lastSeenAt = data.lastSeenAt; return {}; }),
        delete: vi.fn()
      },
      member: { findMany: vi.fn(async () => [member]) }
    };
    const since = new Date(Date.now() - 1_000);
    const entry = (name: string) => ({ name, realm: "R", class: "PRIEST", race: "Scourge", level: 6, spec: "", professions: [] });
    await applyDiscoveredCharacters(db as never, "g", [entry("Alpha"), entry("Beta")], []);
    const arrived = await db.unclaimedCharacter.findMany({ where: { lastSeenAt: { gte: since }, gameEdition: "forever" } });
    expect(arrived.map((row) => row.name).sort()).toEqual(["Alpha", "Beta"]);
    const { linkSoleNewcomer } = await import("../src/services/character-autolink.js");
    expect(await linkSoleNewcomer(db as never, "g", since)).toBeNull();
    expect(linkedTo).toEqual([]);
    expect(db.member.findMany).not.toHaveBeenCalled();
  });
});
