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
    const client = { character: { findUnique: characterReads, update }, professionSkill: { upsert: vi.fn() }, unclaimedCharacter: { findMany, findUnique: vi.fn(async () => null), upsert }, recipeKnown: { deleteMany: vi.fn() }, professionCooldown: { deleteMany: vi.fn() } };
    const linked = names.slice(0, COUNT / 2).map((name, i) => ({ id: `c${i}`, name, realm: "Classic Beta PvP", className: "Priest", race: "Undead", level: 6, spec: null, displayName: null,
      guildRankName: null, guildRankIndex: null, lastSeenAt: recent(), professionsUpdatedAt: new Date("2026-11-01T00:00:00Z") }));
    return { client, linked, characterReads, update, findMany, upsert };
  }

  it("an unchanged roster seen within the hour: no character update, no per-row reads, no unclaimed upsert", async () => {
    const { client, linked, characterReads, update, findMany, upsert } = world();
    const result = await applyDiscoveredCharacters(client as never, "g", names.map((name) => entry(name)), linked);
    expect(result).toEqual({ refreshed: COUNT / 2, discovered: 0 });
    expect(update).not.toHaveBeenCalled();
    expect(characterReads).not.toHaveBeenCalled();
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(client.unclaimedCharacter.findUnique).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
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
