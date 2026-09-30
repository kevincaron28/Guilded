// @ts-expect-error luaparse ships no type declarations
import luaparse from "luaparse";
import { describe, expect, it } from "vitest";
import { resolveStandingsPath, standingsToLua } from "../companion/standings.mjs";
import { createEpgpService } from "../src/services/epgp.js";

describe("companion standings file", () => {
  it("finds the addon folder next to the WTF folder", () => {
    const path = resolveStandingsPath({
      watchFile: "C:\\Games\\World of Warcraft\\_forever_\\WTF\\Account\\ME\\SavedVariables\\Guilded.lua"
    });
    expect(path?.replace(/\\/g, "/")).toBe("C:/Games/World of Warcraft/_forever_/Interface/AddOns/Guilded/Standings.lua");
  });

  it("writes valid Lua even for awkward names", () => {
    const lua = standingsToLua({
      updatedAt: "2026-09-24T00:00:00.000Z",
      standings: [
        { character: "Kévin", main: true, ep: 100, gp: 50, pr: 2 },
        { character: "Bad\"Name\\", main: false, ep: -3, gp: 0, pr: 0 }
      ]
    });
    expect(() => luaparse.parse(lua)).not.toThrow();
    expect(lua).toContain('name = "Kévin", ep = 100, gp = 50, main = true');
  });

  it("carries accepted dungeon runs and the season's dungeon board", () => {
    const lua = standingsToLua({
      updatedAt: "2026-09-24T00:00:00.000Z", standings: [],
      acceptedRunRefs: ["QG-20260925-120000-Kev"],
      dungeonBoard: { season: "Season \"1\"", rows: [{ name: "Kev", points: 240.7 }] }
    });
    expect(() => luaparse.parse(lua)).not.toThrow();
    expect(lua).toContain('"QG-20260925-120000-Kev",');
    expect(lua).toContain('GuildedDungeonBoard = { season = "Season \\"1\\"", status = "ACTIVE", updatedAt = "2026-09-24T00:00:00.000Z", rows = {');
    expect(lua).toContain('{ name = "Kev", points = 240 },');
    expect(standingsToLua({ updatedAt: "x", standings: [] })).toContain("GuildedDungeonBoard = nil");
  });
});

describe("guild standings", () => {
  it("gives every linked character its member's EP/GP/PR", async () => {
    const database = {
      epgpTransaction: {
        groupBy: async () => [{ memberId: "m1", _sum: { epAmount: 100, gpAmount: 40 } }]
      },
      character: {
        findMany: async () => [
          { name: "Main", memberId: "m1", isMain: true },
          { name: "Alt", memberId: "m1", isMain: false },
          { name: "Newbie", memberId: "m2", isMain: true }
        ]
      }
    };
    const standings = await createEpgpService(database as never).getGuildStandings("g1");
    expect(standings).toEqual([
      { character: "Main", main: true, ep: 100, gp: 40, pr: 2.5 },
      { character: "Alt", main: false, ep: 100, gp: 40, pr: 2.5 },
      { character: "Newbie", main: true, ep: 0, gp: 0, pr: 0 }
    ]);
  });
});

describe("item tooltip data in the standings file", () => {
  it("writes valid Lua for items, even with awkward names and no GP history", () => {
    const lua = standingsToLua({
      updatedAt: "2026-09-24T00:00:00.000Z", standings: [],
      items: [
        { key: "thunderfury blessed blade", gp: 120.4, awards: 3, wishTotal: 5, wish: [{ name: "Amy", priority: 1 }, { name: "Bad\"Name", priority: 3 }] },
        { key: "some ring", gp: null, awards: 0, wishTotal: 1, wish: [{ name: "Cy", priority: 2 }] }
      ]
    });
    expect(() => luaparse.parse(lua)).not.toThrow();
    expect(lua).toContain('["thunderfury blessed blade"] = { gp = 120, n = 3, wn = 5, wish = { { "Amy", 1 }, { "Bad\\"Name", 3 } } },');
    expect(lua).toContain('["some ring"] = { gp = nil, n = 0, wn = 1, wish = { { "Cy", 2 } } },');
    expect(standingsToLua({ updatedAt: "x", standings: [] })).toContain("GuildedItems = nil");
  });
});
