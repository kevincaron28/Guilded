import { afterEach, describe, expect, it } from "vitest";
import { promotionForAddon } from "../src/services/promotion-feed.js";
import { promotionToLua, standingsToLua } from "../companion/standings-format.mjs";

const NOW = new Date("2026-11-20T12:00:00Z");
const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const row = (name: string, since: Date, over: Record<string, unknown> = {}) => ({ name, realm: "Realm", displayName: null, level: 30, guildRankName: "Initiate", guildRankAt: days(1), isMain: true, rankSeen: { since }, ...over });
const db = (people: unknown[], settings: unknown = null) => ({
  guildSettings: { findUnique: async () => settings }, character: { findMany: async () => [] }, characterRankSeen: { upsert: async () => ({}) },
  member: { findMany: async () => people }, unclaimedCharacter: { findMany: async () => [] }
}) as never;
const discord = (id: string, inGuild: string[]) => ({ id, memberCount: inGuild.length, members: { cache: new Map(inGuild.map(u => [u, {}])), fetch: async () => undefined } }) as never;
const person = (id: string, characters: unknown[]) => ({ discordUserId: id, displayName: id, characters });

const saved = process.env["FEATURE_PREVIEW_GUILD_IDS"];
afterEach(() => { if (saved === undefined) delete process.env["FEATURE_PREVIEW_GUILD_IDS"]; else process.env["FEATURE_PREVIEW_GUILD_IDS"] = saved; });

describe("promotionForAddon", () => {
  it("lists in-game names of members in Discord who held the rank long enough, longest first", async () => {
    delete process.env["FEATURE_PREVIEW_GUILD_IDS"];
    const feed = await promotionForAddon(db([person("a", [row("Amy Smith", days(8))]), person("b", [row("Bob Jones", days(30))]), person("c", [row("Cy", days(3))]), person("gone", [row("Dee", days(40))])]),
      discord("d1", ["a", "b", "c"]), "g1", "forever", NOW);
    expect(feed?.ready).toEqual(["Bob Jones", "Amy Smith"]);
    expect(feed).toMatchObject({ fromRank: "Initiate", minDays: 7 });
  });
  it("follows the officers' rule and goes quiet when they switched promotion off", async () => {
    delete process.env["FEATURE_PREVIEW_GUILD_IDS"];
    const people = [person("a", [row("Amy", days(8))])];
    const strict = await promotionForAddon(db(people, { promotionMinDays: 14 }), discord("d1", ["a"]), "g1", "forever", NOW);
    expect(strict?.ready).toEqual([]);
    expect(await promotionForAddon(db(people, { promotionEnabled: false }), discord("d1", ["a"]), "g1", "forever", NOW)).toBeNull();
  });
  it("is limited to the preview servers while the preview switch is set", async () => {
    process.env["FEATURE_PREVIEW_GUILD_IDS"] = "other";
    expect(await promotionForAddon(db([person("a", [row("Amy", days(8))])]), discord("d1", ["a"]), "g1", "forever", NOW)).toBeNull();
    process.env["FEATURE_PREVIEW_GUILD_IDS"] = "d1";
    expect((await promotionForAddon(db([person("a", [row("Amy", days(8))])]), discord("d1", ["a"]), "g1", "forever", NOW))?.ready).toEqual(["Amy"]);
  });
});

describe("the companion's GuildedPromotion", () => {
  it("writes a plain Lua table, escapes names and drops anything that could break a row", () => {
    const text = promotionToLua({ updatedAt: NOW.toISOString(), fromRank: 'Init"iate', minDays: 7, ready: ['Amy "A"', "Bad\nName", "Tab\tName", "Bob\\", 7] }).join("\n");
    expect(text).toContain('"Amy \\"A\\""');
    expect(text).toContain('"Bob\\\\"');
    expect(text).not.toContain("Bad");
    expect(text).not.toContain("Tab");
    expect(text).toContain('fromRank = "Init\\"iate"');
  });
  it("writes nil when there is no list, and is part of the standings file", () => {
    expect(promotionToLua(undefined)).toEqual(["GuildedPromotion = nil"]);
    expect(promotionToLua({ ready: "no" })).toEqual(["GuildedPromotion = nil"]);
    expect(standingsToLua({ updatedAt: "x", standings: [] })).toContain("GuildedPromotion = nil");
    expect(standingsToLua({ updatedAt: "x", standings: [], promotion: { ready: ["Amy"], updatedAt: NOW.toISOString(), minDays: 7, fromRank: "Initiate" } })).toContain("GuildedPromotion = {");
  });
});
