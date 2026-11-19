import { describe, expect, it } from "vitest";
import { promotionForAddon } from "../src/services/promotion-feed.js";
import { describeReason } from "../src/services/promotion.js";
import { promotionToLua, standingsToLua } from "../companion/standings-format.mjs";

const NOW = new Date("2026-11-20T12:00:00Z");
const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const row = (name: string, since: Date, over: Record<string, unknown> = {}) => ({ name, realm: "Realm", displayName: null, level: 30, guildRankName: "Initiate", guildRankAt: days(1), isMain: true, rankSeen: { since }, ...over });
// Voice seconds per Discord user over the last 7 days; everybody has plenty unless a test says otherwise.
const db = (people: unknown[], settings: unknown = null, voiceSeconds: Record<string, number> = {}, unclaimed: unknown[] = []) => ({
  memberVoiceHour: { groupBy: async () => (people as { discordUserId: string }[]).map(p => ({ userId: p.discordUserId, _sum: { seconds: voiceSeconds[p.discordUserId] ?? 10 * 3600 } })) },
  guildSettings: { findUnique: async () => settings }, character: { findMany: async () => [] }, characterRankSeen: { upsert: async () => ({}) },
  member: { findMany: async () => people }, unclaimedCharacter: { findMany: async () => unclaimed }
}) as never;
const discord = (id: string, inGuild: string[]) => ({ id, memberCount: inGuild.length, members: { cache: new Map(inGuild.map(u => [u, {}])), fetch: async () => undefined } }) as never;
const person = (id: string, characters: unknown[]) => ({ discordUserId: id, displayName: id, characters });

describe("promotionForAddon", () => {
  it("lists in-game names of members in Discord who held the rank long enough, longest first", async () => {
    const feed = await promotionForAddon(db([person("a", [row("Amy Smith", days(8))]), person("b", [row("Bob Jones", days(30))]), person("c", [row("Cy", days(3))]), person("gone", [row("Dee", days(40))])]),
      discord("d1", ["a", "b", "c"]), "g1", "forever", NOW);
    expect(feed?.ready).toEqual(["Bob Jones", "Amy Smith"]);
    expect(feed).toMatchObject({ fromRank: "Initiate", minDays: 7 });
  });
  it("follows the officers' rule and goes quiet when they switched promotion off", async () => {
    const people = [person("a", [row("Amy", days(8))])];
    const strict = await promotionForAddon(db(people, { promotionMinDays: 14 }), discord("d1", ["a"]), "g1", "forever", NOW);
    expect(strict?.ready).toEqual([]);
    expect(await promotionForAddon(db(people, { promotionEnabled: false }), discord("d1", ["a"]), "g1", "forever", NOW)).toBeNull();
  });
});

describe("waiting members and the level rule for the panel", () => {
  it("lists members at the starting rank that are not ready yet, with the days left, and the minimum level", async () => {
    const feed = await promotionForAddon(db([person("a", [row("Amy Smith", days(8))]), person("c", [row("Cy Fresh", days(1))]), person("gone", [row("Dee Gone", days(40))])], { promotionMinLevel: 20 }),
      discord("d1", ["a", "c"]), "g1", "forever", NOW);
    expect(feed?.ready).toEqual(["Amy Smith"]);
    expect(feed?.waiting).toEqual([{ name: "Cy Fresh", daysLeft: 6 }]);
    expect(feed?.minLevel).toBe(20);
    expect(feed).not.toHaveProperty("linked"); // the officer client never promotes from "linked"
    const lua = promotionToLua(feed).join(" ");
    expect(lua).toContain('{ name = "Cy Fresh", daysLeft = 6 }');
    expect(lua).toContain("minLevel = 20");
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

describe("link and voice conditions", () => {
  const people = [person("a", [row("Amy Smith", days(8))])];
  const inGuild = discord("d1", ["a"]);
  it("a linked member with 3 h of voice (solo time included) after 7 days is ready", async () => {
    const feed = await promotionForAddon(db(people, null, { a: 3 * 3600 }), inGuild, "g1", "forever", NOW);
    expect(feed?.ready).toEqual(["Amy Smith"]);
  });
  it("2 h 59 of voice waits with the voice reason", async () => {
    const feed = await promotionForAddon(db(people, null, { a: 179 * 60 }), inGuild, "g1", "forever", NOW);
    expect(feed?.ready).toEqual([]);
    expect(feed?.waiting).toEqual([{ name: "Amy Smith", daysLeft: 0, reason: "voice:179:180" }]);
    expect(promotionToLua(feed).join(" ")).toContain('reason = "voice:179:180"');
    expect(describeReason("voice:179:180", "en")).toBe("voice 2 h 59 / 3 h");
  });
  it("a character nobody linked waits with needs link", async () => {
    const unclaimed = [{ name: "Zed Free", realm: "Realm", displayName: null, level: 12, guildRankName: "Initiate", guildRankAt: days(1) }];
    const feed = await promotionForAddon(db([], null, {}, unclaimed), inGuild, "g1", "forever", NOW);
    expect(feed?.ready).toEqual([]);
    expect(feed?.waiting).toEqual([{ name: "Zed Free", daysLeft: 0, reason: "link" }]);
    expect(describeReason("link", "en")).toBe("needs link");
    const off = await promotionForAddon(db([], { promotionRequireLink: false }, {}, unclaimed), inGuild, "g1", "forever", NOW);
    expect(off?.waiting).toEqual([]);
  });
  it("with the voice condition off (0 minutes) the old behaviour applies", async () => {
    const feed = await promotionForAddon(db(people, { promotionMinVoiceMinutes: 0 }, { a: 0 }), inGuild, "g1", "forever", NOW);
    expect(feed?.ready).toEqual(["Amy Smith"]);
    expect(feed?.waiting).toEqual([]);
  });
});
