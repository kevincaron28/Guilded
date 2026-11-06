import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";
import { rosterPrelude } from "./roster-tools.test.js";
import { promotionForAddon } from "../../src/services/promotion-feed.js";
import { standingsToLua } from "../../companion/standings-format.mjs";

// End to end: the bot's rule -> the officer's standings download -> the companion's Lua file -> the in-game panel.
let s: LuaSession;
afterEach(() => s?.close());

const NOW = new Date("2026-11-20T12:00:00Z");
const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const character = (name: string, since: Date, over: Record<string, unknown> = {}) => ({ name, realm: "Realm", displayName: null, level: 30, guildRankName: "Initiate", guildRankAt: days(1), isMain: true, rankSeen: { since }, ...over });
const member = (id: string, characters: unknown[]) => ({ discordUserId: id, displayName: id.toUpperCase(), characters });
function fixtureDb(people: unknown[]) {
  return {
    guildSettings: { findUnique: async () => null },
    character: { findMany: async () => [] }, characterRankSeen: { upsert: async () => ({}) },
    member: { findMany: async () => people }, unclaimedCharacter: { findMany: async () => [] },
    guild: { findUnique: async () => ({ id: "g1", gameEdition: "forever" }) }
  } as never;
}
const discord = (inGuild: string[]) => ({ id: "d1", memberCount: inGuild.length, members: { cache: new Map(inGuild.map(id => [id, {}])), fetch: async () => undefined } }) as never;

function panelSession(luaFile: string) {
  s = newLuaSession();
  s.run(rosterPrelude);
  s.run(String.raw`
    DB = {}
    NS.getDb = function() return DB end
    NS.displayName = function(n) return n end
    NS.message = function(m) MESSAGES = MESSAGES or {}; MESSAGES[#MESSAGES + 1] = m end
    function GetGuildRosterInfo(i) READS = READS + 1; local r = ROWS[i]; return r.name, r.rankName or "Rank", r.rank, r.level or 60, "Mage", "Zone", r.public, r.officer, true, nil, "MAGE", 0, 0, false, false, 0, r.guid end
  `);
  s.load("Modules/RosterTools.lua");
  s.load("Modules/Promotion.lua");
  s.run('NS.util.gameEdition=function() return EDITION end; NS.util.address=function(n) return n end; ROWS[2].rankName="Initiate"; ROWS[3].rankName="Initiate"; fire_event("GUILD_ROSTER_UPDATE"); NS.promotion.observe()');
  s.run(luaFile);
  return s;
}

describe("promotion feed, end to end", () => {
  it("lists exactly the members the bot says are ready, each with one reviewed Promote click", async () => {
    // Amy: 9 days, in Discord. Bob: 20 days, in Discord. Cy: 2 days (not yet). Dee: 30 days but left Discord.
    const db = fixtureDb([member("amy", [character("Amy-Realm", days(9))]), member("bob", [character("Bob-Realm", days(20))]),
      member("cy", [character("Cy-Realm", days(2))]), member("dee", [character("Dee-Realm", days(30))])]);
    const feed = await promotionForAddon(db, discord(["amy", "bob", "cy"]), "g1", "forever", NOW);
    expect(feed).toEqual({ updatedAt: NOW.toISOString(), fromRank: "Initiate", minDays: 7, ready: ["Bob-Realm", "Amy-Realm"] });

    const file = standingsToLua({ updatedAt: NOW.toISOString(), standings: [], promotion: feed });
    panelSession(file);
    // The panel has no local history yet (a fresh roster view), so these two come only from the bot's list.
    // (Both are at 0 local days, so the panel orders them by name; Cy and Dee are not listed.)
    expect(s.run("local r=NS.promotion.ready(); return #r..':'..r[1].name..':'..r[2].name..':'..tostring(r[1].fromBot)..tostring(r[2].fromBot)")).toBe("2:Amy-Realm:Bob-Realm:truetrue");
    expect(s.run("return #CALLS")).toBe("0");
    // One click, one promotion; the second waits for the roster to confirm the first.
    expect(s.run('return tostring(NS.promotion.promote("Bob-Realm"))')).toBe("true");
    expect(s.run("return #CALLS")).toBe("1");
    expect(s.run('return tostring(NS.promotion.promote("Amy-Realm"))')).toBe("false");
    expect(s.run("return #CALLS")).toBe("1");
    expect(s.run("return NS.rosterTools.store().audit[1].action")).toBe("promote");
  });

  it("gives members and companions without the list an empty panel source", () => {
    const file = standingsToLua({ updatedAt: NOW.toISOString(), standings: [] });
    expect(file).toContain("GuildedPromotion = nil");
    panelSession(file);
    expect(s.run("local r=NS.promotion.ready(); return #r")).toBe("0");
  });

  it("stays out of the shared feed: only the officer-only part of the download carries it", async () => {
    const src = (await import("node:fs")).readFileSync(new URL("../../src/companion-api.ts", import.meta.url), "utf8");
    const shared = src.slice(src.indexOf("shared: {"), src.indexOf("personal: {"));
    expect(shared).not.toContain("promotion");
    expect(src).toMatch(/access\.officer && client \? await officerPromotionFeed/);
  });
});
