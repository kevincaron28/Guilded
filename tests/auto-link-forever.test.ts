import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ pair: vi.fn(), autoLinkCalls: [] as unknown[][] }));
vi.mock("../src/services/character-pairing.js", () => ({ linkPairedCharacter: mocks.pair }));

import { linkSoleNewcomer, matchUnclaimed, nameCandidates } from "../src/services/character-autolink.js";
import { linkUploaderCharacters, repairMissingLinks } from "../src/services/upload-linking.js";

const char = (name: string, extra: Record<string, unknown> = {}) => ({ name, realm: "Forever", class: "PRIEST", level: 10, professions: [], gameEdition: "forever", ...extra });

describe("a signed-in companion links every character its PC reports", () => {
  beforeEach(() => mocks.pair.mockReset().mockResolvedValue("linked"));

  it("links the logged-in character and every alt for an officer's member too, with no code", async () => {
    const status = await linkUploaderCharacters({} as never, "g", "officer-member", { character: char("Lebowski") as never, alts: [char("Lebowski") as never, char("Walter") as never, char("Donny") as never] });
    expect(status).toBe("linked");
    expect(mocks.pair.mock.calls.map((call) => (call[3] as { name: string }).name)).toEqual(["Lebowski", "Walter", "Donny"]);
    expect(mocks.pair.mock.calls.every((call) => call[2] === "officer-member")).toBe(true);
  });

  it("keeps going when an alt fails, and reports a missing main character", async () => {
    mocks.pair.mockRejectedValueOnce(new Error("boom")).mockResolvedValue("owned-by-another");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const status = await linkUploaderCharacters({} as never, "g", "m", { alts: [char("A1") as never, char("B2") as never] });
    expect(status).toBe("missing-character");
    expect(mocks.pair).toHaveBeenCalledTimes(2);
  });
});

describe("a duplicate export still repairs missing links", () => {
  const guild = { members: { cache: new Map() } } as never;
  it("does nothing for a member who already has characters, or without a Discord guild", async () => {
    const database = { character: { count: vi.fn(async () => 2) }, unclaimedCharacter: { findMany: vi.fn(async () => []) } };
    expect(await repairMissingLinks(guild, database as never, "g", "m")).toEqual([]);
    expect(await repairMissingLinks(null, database as never, "g", "m")).toEqual([]);
    expect(database.unclaimedCharacter.findMany).not.toHaveBeenCalled();
  });
  it("runs the matching for a member with zero linked characters", async () => {
    const database = { character: { count: vi.fn(async () => 0) }, unclaimedCharacter: { findMany: vi.fn(async () => []) } };
    await repairMissingLinks(guild, database as never, "g", "m");
    expect(database.unclaimedCharacter.findMany).toHaveBeenCalledWith({ where: { guildId: "g" } });
  });
});

describe("matching a Forever full name", () => {
  const people = [
    { id: "d1", names: nameCandidates("Lebowski Holyroller") },
    { id: "d2", names: nameCandidates("Walter | Priest") },
    { id: "d3", names: nameCandidates("Walter") }
  ];
  it("matches first AND last name against the Discord display name", () => {
    expect(matchUnclaimed([{ id: "c1", name: "Lebowski", displayName: "Lebowski Holyroller" }], people)).toEqual([{ characterId: "c1", discordId: "d1" }]);
    // The two names as separate words in a longer nickname still fit.
    expect(matchUnclaimed([{ id: "c1", name: "Lebowski", displayName: "Lebowski Holyroller" }], [{ id: "d9", names: nameCandidates("[GOLD] Holyroller | Lebowski") }])).toEqual([{ characterId: "c1", discordId: "d9" }]);
  });
  it("leaves a first name shared by two members for /character claim", () => {
    expect(matchUnclaimed([{ id: "c2", name: "Walter", displayName: "Walter Sobchak" }], people)).toEqual([]);
  });
  it("lets the full name decide when it fits one member but the first name fits several", () => {
    const more = [...people, { id: "d4", names: nameCandidates("Walter Sobchak") }];
    expect(matchUnclaimed([{ id: "c2", name: "Walter", displayName: "Walter Sobchak" }], more)).toEqual([{ characterId: "c2", discordId: "d4" }]);
  });
  it("never links when the full name fits two members", () => {
    const twins = [{ id: "a", names: nameCandidates("Dude Lebowski") }, { id: "b", names: nameCandidates("Dude Lebowski") }];
    expect(matchUnclaimed([{ id: "c3", name: "Dude", displayName: "Dude Lebowski" }], twins)).toEqual([]);
  });
});

describe("one newcomer, one waiting member", () => {
  const row = (id: string, name: string) => ({ id, guildId: "g", name, nameKey: name.toLowerCase(), realm: "Forever", className: "Priest", gameEdition: "forever", displayName: null, spec: null, level: 5, race: null, professions: null, lastSeenAt: new Date(), professionsUpdatedAt: null });
  function db(arrived: unknown[], waiting: unknown[], opts: { taken?: boolean; declined?: boolean } = {}) {
    const added: unknown[] = [];
    const database = {
      unclaimedCharacter: { findMany: vi.fn(async () => arrived), delete: vi.fn(async () => ({})) },
      member: { findMany: vi.fn(async () => waiting) },
      character: {
        findFirst: vi.fn(async () => (opts.taken ? { id: "x" } : null)),
        count: vi.fn(async () => 0),
        update: vi.fn(async () => ({}))
      },
      characterVerifyClaim: { findFirst: vi.fn(async () => (opts.declined ? { id: "c" } : null)) },
      professionSkill: { upsert: vi.fn() },
      guild: { findUnique: vi.fn(async () => null) },
      $transaction: vi.fn(async () => { added.push(1); })
    };
    return { database, added };
  }
  const since = new Date(Date.now() - 1000);

  it("does nothing with two newcomers or two waiting members", async () => {
    expect(await linkSoleNewcomer(db([row("1", "Ray"), row("2", "Amy")], [{ id: "m", displayName: "M" }]).database as never, "g", since)).toBeNull();
    expect(await linkSoleNewcomer(db([row("1", "Ray")], [{ id: "m", displayName: "M" }, { id: "n", displayName: "N" }]).database as never, "g", since)).toBeNull();
    expect(await linkSoleNewcomer(db([row("1", "Ray")], []).database as never, "g", since)).toBeNull();
  });
  it("never steals a name that is already linked, and drops the stale row", async () => {
    const { database } = db([row("1", "Ray")], [{ id: "m", displayName: "M" }], { taken: true });
    expect(await linkSoleNewcomer(database as never, "g", since)).toBeNull();
    expect(database.unclaimedCharacter.delete).toHaveBeenCalledWith({ where: { id: "1" } });
  });
  it("respects an unlink or officer removal", async () => {
    const { database } = db([row("1", "Ray")], [{ id: "m", displayName: "M" }], { declined: true });
    expect(await linkSoleNewcomer(database as never, "g", since)).toBeNull();
    expect(database.unclaimedCharacter.delete).not.toHaveBeenCalled();
  });
  it("asks only for active members with a live companion credential and no characters", async () => {
    const { database } = db([row("1", "Ray")], []);
    await linkSoleNewcomer(database as never, "g", since);
    expect(database.member.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { guildId: "g", status: "ACTIVE", characters: { none: {} }, companionCredentials: { some: { revokedAt: null } } } }));
    expect(database.unclaimedCharacter.findMany).toHaveBeenCalledWith({ where: { guildId: "g", lastSeenAt: { gte: since }, gameEdition: "forever" } });
  });
});
