import { describe, expect, it, vi } from "vitest";
import { characterFaction, factionTag, guildFactions } from "../src/services/guild-faction.js";
import { notifyInviters, onlineInviters } from "../src/services/invite-notify.js";
import { prismaGuildDirectoryStore, createGuildDirectory } from "../src/services/guild-directory.js";
import { createWebApp } from "../src/services/web-app.js";
import { memoryWebStore } from "./helpers/memory-web-store.js";
import type { PrismaClient } from "../src/generated/prisma/client.js";

const now = new Date("2026-11-19T12:00:00Z");

/** A database holding a Horde guild g1: five roster rows, races known for most; "Suce Mafleche" is a known Human (Alliance). */
function world(opts: { requested?: { race?: string; faction?: string } | null; listing?: string | null } = {}) {
  const roster = ["Thorius Durohan", "Rosenoire Blackrose", "Assabim Lepoq", "Gruk Hammer", "Ghost Walker"];
  const races: Record<string, string> = { "thorius durohan": "Orc", "rosenoire blackrose": "Undead", "assabim lepoq": "Tauren", "gruk hammer": "Troll" };
  const requestedRace = opts.requested === undefined ? { race: "Human" } : opts.requested;
  const send = vi.fn(async (options: unknown) => { void options; return { id: "note1" }; });
  const database = {
    guildSettings: { findUnique: vi.fn(async () => ({ inviteNotifyEnabled: true, language: "fr" })) },
    inviteRequest: { updateMany: vi.fn(async () => ({ count: 1 })) },
    guildRosterEntry: { findMany: vi.fn(async (args: { where: { guildId: unknown } }) => typeof args.where.guildId === "string"
      ? roster.map((name, rankIndex) => ({ name, rankIndex })) : roster.map((name) => ({ guildId: "g1", name }))) },
    character: { findMany: vi.fn(async (args: { where: { member?: { guildId?: unknown } } }) => {
      if (args.where.member && typeof args.where.member.guildId === "string") return roster.slice(0, 3).map((name, i) => ({ name, member: { discordUserId: `u${i + 1}` } }));
      const rows = Object.entries(races).map(([name, race]) => ({ name, race, member: { guildId: "g1" } }));
      if (requestedRace?.race) rows.push({ name: "suce mafleche", race: requestedRace.race, member: { guildId: "g9" } });
      return rows;
    }) },
    deviceCharacter: { findMany: vi.fn(async () => []) },
    publicRunPlayer: { findMany: vi.fn(async () => requestedRace?.faction ? [{ character: "Suce Mafleche", faction: requestedRace.faction }] : []) },
    recruitmentListing: { findMany: vi.fn(async () => opts.listing ? [{ guildId: "g1", faction: opts.listing }] : []) }
  };
  const run = () => notifyInviters(database as never, { guildId: "g1", discordGuild: { roles: { fetch: async () => new Map() } } as never, channel: { send }, requestMessageId: "m1", requesterId: "req", displayName: "Suce Mafleche", now });
  return { database, send, run };
}

describe("faction of a character and of a guild", () => {
  it("reads a character's faction from its race, or from the faction a client reported", async () => {
    expect(await characterFaction(world().database as never, "Suce Mafleche")).toBe("ALLIANCE");
    expect(await characterFaction(world({ requested: { faction: "HORDE" } }).database as never, "Suce Mafleche")).toBe("HORDE");
    expect(await characterFaction(world({ requested: null }).database as never, "Suce Mafleche")).toBeNull();
  });
  it("derives a guild's faction from the races of its known players (majority, at least three known), a listing wins", async () => {
    expect((await guildFactions(world().database as never, ["g1"])).get("g1")).toBe("HORDE");
    expect((await guildFactions(world({ listing: "ALLIANCE" }).database as never, ["g1"])).get("g1")).toBe("ALLIANCE");
    const thin = { character: { findMany: async () => [{ name: "a b", race: "Orc", member: { guildId: "g2" } }, { name: "c d", race: "Troll", member: { guildId: "g2" } }] } };
    expect((await guildFactions(thin as never, ["g2"])).has("g2")).toBe(false);
    const mixed = { character: { findMany: async () => ["Orc", "Human", "Orc", "Dwarf"].map((race, i) => ({ name: `n${i} x`, race, member: { guildId: "g3" } })) } };
    expect((await guildFactions(mixed as never, ["g3"])).has("g3")).toBe(false);
  });
  it("renders the faction in its colour, empty when unknown", () => {
    expect(factionTag("HORDE", "en")).toContain("Horde");
    expect(factionTag("ALLIANCE", "fr")).toContain("fac-alliance");
    expect(factionTag(null, "en")).toBe("");
  });
});

describe("invite tagging respects the faction", () => {
  it("tags nobody and tells the requester when the character is of the other faction", async () => {
    const { run, send } = world();
    expect(await run()).toBe("wrong-faction");
    expect(send).toHaveBeenCalledTimes(1);
    const call = send.mock.calls[0]![0] as { content: string; allowedMentions: { users: string[] } };
    expect(call.content).toContain("Horde");
    expect(call.content).toContain("Suce Mafleche");
    expect(call.allowedMentions.users).toEqual(["req"]);
  });
  it("tags the same-guild online members when the faction matches or is unknown", async () => {
    const unknown = world({ requested: null });
    expect(await unknown.run()).toBe("people");
    expect((unknown.send.mock.calls[0]![0] as { allowedMentions: { users: string[] } }).allowedMentions.users).toEqual(["u1", "u2", "u3"]);
    const same = world({ requested: { race: "Orc" } });
    expect(await same.run()).toBe("people");
  });
  it("only ever reads the roster of the request's own guild, and skips an inviter known to be of the other faction", async () => {
    const { database } = world();
    const ids = await onlineInviters(database as never, "g1", "req", now, "ALLIANCE");
    expect(ids).toEqual([]); // every online guildmate is Horde
    const rosterWhere = (database.guildRosterEntry.findMany.mock.calls[0] as unknown as [{ where: { guildId: string } }])[0].where;
    expect(rosterWhere.guildId).toBe("g1");
    expect(await onlineInviters(database as never, "g1", "req", now, "HORDE")).toEqual(["u1", "u2", "u3"]);
  });
});

describe("faction on the website", () => {
  it("the guild directory shows the derived faction beside the name and filters by it", async () => {
    const findMany = vi.fn(async () => [{ id: "g1", name: "QG", discordId: "ok", gameEdition: "forever", settings: null, page: { slug: "qg", published: true }, raidCores: [], recruitmentListings: [] }]);
    const database = { ...world().database, guild: { findMany } };
    const store = prismaGuildDirectoryStore(database as unknown as PrismaClient, () => true);
    const guilds = await store.guilds("forever");
    expect(guilds[0]!.faction).toBe("HORDE");
    const web = createWebApp({ auth: null, store: memoryWebStore().store, allows: () => true, postApplication: async () => null, routes: [createGuildDirectory(store).route] });
    const page = (await web.respond({ method: "GET", path: "/recruitment/guilds/", query: new URLSearchParams("faction=HORDE&lang=fr"), headers: {} }))!;
    expect(page.status).toBe(200);
    expect(page.body).toContain("fac-horde");
    expect(page.body).toContain(">QG</a>");
    const other = (await web.respond({ method: "GET", path: "/recruitment/guilds/", query: new URLSearchParams("faction=ALLIANCE"), headers: {} }))!;
    expect(other.body).not.toContain(">QG</a>");
  });
});
