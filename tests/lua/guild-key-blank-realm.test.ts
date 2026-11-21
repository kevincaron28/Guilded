import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// Production incident, 21 Nov 2026 00:00 UTC (owner's PC). The game still ran addon 9.4.4 when Forever 1.60.1 blanked the
// realm: 9.4.4 built "Québec Gold-" and took it for a guild switch, parked the real data under "Québec Gold-CAMWOWUS2Realm2PvP"
// and started empty. 9.4.5 (#1202) then kept "Québec Gold-" because it was the loaded key. These tests start from a file
// shaped like that one and check that the real key comes back, the runs recorded meanwhile are kept once, and nothing is lost.
let s: LuaSession | undefined;
afterEach(() => { s?.close(); s = undefined; });

const GUILD = "Québec Gold";
const REAL = `${GUILD}-CAMWOWUS2Realm2PvP`;
const SPACED = `${GUILD}-CAMWOW US2 Realm 2 PvP`;
const BLANK = `${GUILD}-`;

function start(saved: string, guild: string | null = GUILD) {
  s = newLuaSession();
  const guildInfo = guild === null ? "function GetGuildInfo() return nil end; function IsInGuild() return false end"
    : `function GetGuildInfo() return ${JSON.stringify(guild)}, "Officer", 1, "" end; function IsInGuild() return true end`;
  s.run(`GuildedDB = ${saved}; NS = {}; MOCK_UNITS = { player = { name = "Lebowski Holyroller", buffs = {} } }
    NOW = 1800000000; GetServerTime = function() return NOW end; GUILDED_TEST_HOME_WAIT = 20
    CLOCK_TICKS = 0; function GetTime() CLOCK_TICKS = CLOCK_TICKS + 10; return CLOCK_TICKS end
    function GetBuildInfo() return "1.60.1", "70790", "Nov 1 2026", 16001 end
    function GetRealmName() return "" end
    function GetNormalizedRealmName() return "" end
    ${guildInfo}`);
  s.load("Core.lua"); s.load("Compat.lua");
  s.run(`fire_event("PLAYER_LOGIN"); fire_event("PLAYER_ENTERING_WORLD"); fire_event("GUILD_ROSTER_UPDATE")`);
  return s;
}

function relog(lua: LuaSession, guild: string | null) {
  // A fresh login on another character: same saved file, new session state.
  const saved = lua.run(`
    local function dump(v)
      if type(v) == "string" then return string.format("%q", v) end
      if type(v) ~= "table" then return tostring(v) end
      local out = {}
      for k, x in pairs(v) do out[#out + 1] = "[" .. dump(k) .. "] = " .. dump(x) end
      return "{" .. table.concat(out, ", ") .. "}"
    end
    return dump(GuildedDB)`);
  lua.close();
  return start(saved, guild);
}

const keys = (lua: LuaSession) => lua.run(`local t = {}; for k in pairs(GuildedDB.otherGuilds or {}) do t[#t + 1] = k end; table.sort(t); return table.concat(t, " | ")`);
const run = (id: string, synced: boolean) => `["${id}"] = { id = "${id}", state = "COMPLETED", endedAt = 1795212039, synced = ${synced} }`;

// The evidence file, reduced: loaded "Québec Gold-" with the runs recorded since 00:00, the real data parked, the old spaced
// spelling parked and already merged into the real key on 7 Nov.
const INCIDENT = `{ version = 4, guildKey = "${BLANK}", guildEdition = "forever", bridgeCompanionGuild = "${SPACED}",
  roster = { ["Kev"] = {} }, settings = { officers = {} }, epgp = {},
  dungeon = { schema = 2, runs = { ${run("QG-new-unsynced", false)}, ${run("QG-shared", true)} } },
  duels = { blank = true },
  otherGuilds = {
    ["${REAL}"] = { parkedAt = 1795219221, roster = { ["Kev"] = {}, ["Bob"] = {} }, settings = { officers = {}, keep = "real" }, epgp = { Bob = { ep = 9, gp = 1 } },
      dungeon = { schema = 2, runs = { ${run("QG-shared", false)}, ${run("QG-old", true)} } }, duels = { real = true } },
    ["${SPACED}"] = { parkedAt = 1794960988, mergedIntoHome = "${REAL}", roster = { ["Kev"] = {} }, epgp = {},
      dungeon = { schema = 2, runs = { ${run("QG-old", false)} } }, motd = { "old" } },
  } }`;

describe("guild key with a blank realm: the incident repair", () => {
  it("makes the real key active again, keeps every run once and points where they were", () => {
    const lua = start(INCIDENT);
    expect(lua.run("return GuildedDB.guildKey")).toBe(REAL);
    // The real data is back: roster, settings and points.
    expect(lua.run("return tostring(GuildedDB.roster.Bob ~= nil)")).toBe("true");
    expect(lua.run("return GuildedDB.settings.keep")).toBe("real");
    expect(lua.run("return GuildedDB.epgp.Bob.ep")).toBe("9");
    // Runs: the new one moved in, the shared one once (confirmed by the bot in the blank copy), the old one untouched.
    expect(lua.run("local n = 0; for _ in pairs(GuildedDB.dungeon.runs) do n = n + 1 end; return n")).toBe("3");
    expect(lua.run(`return tostring(GuildedDB.dungeon.runs["QG-new-unsynced"].synced)`)).toBe("false");
    expect(lua.run(`return tostring(GuildedDB.dungeon.runs["QG-shared"].synced)`)).toBe("true");
    expect(lua.run(`return tostring(GuildedDB.dungeon.runs["QG-old"].synced)`)).toBe("true");
    // Sections both had stay the real ones; the blank leftover stays parked, marked merged, with no run left in it.
    expect(lua.run("return tostring(GuildedDB.duels.real)")).toBe("true");
    expect(keys(lua)).toBe(BLANK);
    expect(lua.run(`return GuildedDB.otherGuilds["${BLANK}"].mergedIntoHome`)).toBe(REAL);
    expect(lua.run(`return tostring(GuildedDB.otherGuilds["${BLANK}"].duels.blank)`)).toBe("true");
    expect(lua.run(`return tostring(next(GuildedDB.otherGuilds["${BLANK}"].dungeon.runs))`)).toBe("nil");
    expect(lua.run("return tostring(GuildedDB.mergedIntoHome)")).toBe("nil");
    expect(lua.run("return GuildedDB.bridgeCompanionGuild")).toBe(SPACED);
    // One chat line, then nothing more.
    const repaired = lua.chat().filter(line => line.includes("Guild data repaired"));
    expect(repaired).toHaveLength(1);
    expect(repaired[0]).toContain("1 dungeon runs");
    expect(lua.chat().some(line => line.includes("Guild changed"))).toBe(false);
    lua.run(`NOW = NOW + 60; fire_event("GUILD_ROSTER_UPDATE"); fire_event("PLAYER_GUILD_UPDATE")`);
    expect(lua.run("return GuildedDB.guildKey")).toBe(REAL);
    const again = relog(lua, GUILD);
    expect(again.run("return GuildedDB.guildKey")).toBe(REAL);
    expect(again.chat().some(line => line.includes("Guild data repaired") || line.includes("Guild changed"))).toBe(false);
  });

  it("keeps a spaced alias that still holds points or a run only it has", () => {
    const lua = start(`{ version = 4, guildKey = "${BLANK}", guildEdition = "forever", roster = {}, settings = { officers = {} },
      otherGuilds = {
        ["${REAL}"] = { roster = { Bob = {} }, settings = { officers = {} }, dungeon = { runs = {} } },
        ["${SPACED}"] = { mergedIntoHome = "${REAL}", epgp = { Bob = { ep = 3, gp = 0 } }, dungeon = { runs = { ${run("QG-alias-only", false)} } } },
      } }`);
    expect(lua.run("return GuildedDB.guildKey")).toBe(REAL);
    // The alias's own run moved into the loaded data; its points keep it parked.
    expect(lua.run(`return tostring(GuildedDB.dungeon.runs["QG-alias-only"] ~= nil)`)).toBe("true");
    expect(lua.run(`return GuildedDB.otherGuilds["${SPACED}"].epgp.Bob.ep`)).toBe("3");
    expect(lua.run(`return tostring(next(GuildedDB.otherGuilds["${SPACED}"].dungeon.runs))`)).toBe("nil");
  });

  it("repairs a loaded old spaced spelling while the real data is parked", () => {
    const lua = start(`{ version = 4, guildKey = "${SPACED}", guildEdition = "forever", mergedIntoHome = "${REAL}", roster = { Kev = {} }, settings = { officers = {} },
      dungeon = { runs = { ${run("QG-spaced", false)} } },
      otherGuilds = { ["${REAL}"] = { roster = { Bob = {} }, settings = { officers = {} }, dungeon = { runs = { ${run("QG-old", true)} } } } } }`);
    expect(lua.run("return GuildedDB.guildKey")).toBe(REAL);
    expect(lua.run("return tostring(GuildedDB.roster.Bob ~= nil)")).toBe("true");
    expect(lua.run(`return tostring(GuildedDB.dungeon.runs["QG-spaced"] ~= nil and GuildedDB.dungeon.runs["QG-old"] ~= nil)`)).toBe("true");
    // The spaced leftover had nothing left that is not in the real data: dropped.
    expect(keys(lua)).toBe("");
  });
});

describe("guild key with a blank realm: guild switches", () => {
  it("an alt of another guild, then a Québec Gold character: the compact real key, never the spaced alias or a new key", () => {
    // Before this fix the blank-realm path returned the alphabetical first parked key (the space sorts first: the old alias)
    // or, with the loaded key not matching, the stored key; a never-matching guild made "Guild-".
    let lua = start(`{ version = 4, guildKey = "${REAL}", guildEdition = "forever", roster = { Bob = {} }, settings = { officers = {} },
      dungeon = { runs = { ${run("QG-old", true)} } },
      otherGuilds = { ["${SPACED}"] = { mergedIntoHome = "${REAL}", roster = { Kev = {} }, settings = { officers = {} } } } }`, "Lebowski Guild");
    expect(lua.run("return GuildedDB.guildKey")).toBe("Lebowski Guild-");
    expect(keys(lua)).toBe(`${SPACED} | ${REAL}`);
    lua = relog(lua, null);
    expect(lua.run("return GuildedDB.guildKey")).toBe("Lebowski Guild-");
    lua = relog(lua, GUILD);
    expect(lua.run("return GuildedDB.guildKey")).toBe(REAL);
    expect(lua.run("return tostring(GuildedDB.roster.Bob ~= nil)")).toBe("true");
    expect(lua.run(`return tostring(GuildedDB.dungeon.runs["QG-old"] ~= nil)`)).toBe("true");
    // The alias held nothing unsynced: dropped once the real key was loaded again.
    expect(keys(lua)).toBe("Lebowski Guild-");
    lua = relog(lua, "Lebowski Guild");
    expect(lua.run("return GuildedDB.guildKey")).toBe("Lebowski Guild-");
    expect(keys(lua)).toBe(REAL);
  });

  it("prefers the key holding the guild's data when two realm keys exist", () => {
    const lua = start(`{ version = 4, guildKey = "Other-", guildEdition = "forever", roster = {}, settings = { officers = {} },
      otherGuilds = {
        ["${GUILD}-ARealm"] = { roster = { A = {} }, settings = { officers = {} } },
        ["${GUILD}-ZRealm"] = { roster = { A = {}, B = {}, C = {} }, settings = { officers = {} } },
      } }`);
    expect(lua.run("return GuildedDB.guildKey")).toBe(`${GUILD}-ZRealm`);
  });

  it("only a guild never stored gets 'Guild-'", () => {
    const lua = start(`{ version = 4, guildKey = "${REAL}", guildEdition = "forever", roster = { Bob = {} }, settings = { officers = {} } }`, "Brand New");
    expect(lua.run("return GuildedDB.guildKey")).toBe("Brand New-");
    expect(keys(lua)).toBe(REAL);
  });
});
