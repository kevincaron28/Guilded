import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";
let s: LuaSession | undefined;
afterEach(() => s?.close());
function setup() {
  s = newLuaSession();
  s.run(`DB = {}; EDITION = "forever"; HARDCORE = false; ACTIVE = true; COMPLETE = false; DURATION = 0; MAP = 489; CLOCK = 1800000000
    function GetServerTime() return CLOCK end
    function UnitName() return "Kev" end; function GetRealmName() return "Realm" end
    function GetBattlefieldArenaFaction() return 1 end
    C_GameRules = { IsHardcoreActive = function() return HARDCORE end }
    C_PvP = { IsMatchActive = function() return ACTIVE end, IsMatchComplete = function() return COMPLETE end,
      GetActiveMatchDuration = function() return DURATION end, GetActiveMatchBracket = function() return 6 end,
      GetActiveMatchWinner = function() return 1 end, IsRatedMap = function() return false end,
      IsRatedSoloRBG = function() return false end, IsBrawlSoloRBG = function() return false end }
    NS = { getDb = function() return DB end, util = { gameEdition = function() return EDITION end },
      compat = { instance = function() if MAP then return { id = MAP, type = "pvp" } end end },
      commandHandlers = {}, commandHelp = {}, message = function() end,
      isSecret = function(v) return v == "SECRET" end }
  `);
  s.load("Modules/Battleground.lua");
  // The harness supplies the real namespace on load; make the client edition selectable per test.
  s.run(`NS.util.gameEdition = function() return EDITION end`);
  return s;
}
const count = `local n = 0; for _ in pairs(DB.battleground.reports) do n = n + 1 end; return tostring(n)`;
describe("provisional own-character BG capture", () => {
  it("consumes an explicit case-sensitive premade hint on the next successful capture only", () => {
    const lua = setup();
    lua.run(`NS.commandHandlers.bgcapture("on normal"); NS.commandHandlers.bgcapture("premade Shared:Code_123"); fire_event("PVP_MATCH_ACTIVE"); fire_event("PVP_MATCH_COMPLETE"); COMPLETE = true; fire_event("PVP_MATCH_COMPLETE")`);
    expect(lua.run(`for _,r in pairs(DB.battleground.reports) do return r.premadeNonce end`)).toBe("Shared:Code_123");
    lua.run(`COMPLETE = false; fire_event("PVP_MATCH_ACTIVE"); NEXT_ID = DB.battleground.active["Kev-Realm"].reportId; COMPLETE = true; fire_event("PVP_MATCH_COMPLETE")`);
    expect(lua.run(`return tostring(DB.battleground.reports[NEXT_ID].premadeNonce)`)).toBe("nil");
  });
  it.each(["off", "reload", "invalid", "disabled"])("does not attach a premade hint after %s", scenario => {
    const lua = setup();
    if (scenario !== "disabled") lua.run(`NS.commandHandlers.bgcapture("on normal")`);
    const code = scenario === "invalid" ? "bad/code" : "Shared:Code_123";
    lua.run(`NS.commandHandlers.bgcapture("premade ${code}")`);
    if (scenario === "off") lua.run(`NS.commandHandlers.bgcapture("off")`);
    if (scenario === "reload") lua.run(`fire_event("PLAYER_LOGIN")`);
    lua.run(`NS.commandHandlers.bgcapture("on normal"); fire_event("PVP_MATCH_ACTIVE"); COMPLETE = true; fire_event("PVP_MATCH_COMPLETE")`);
    expect(lua.run(`for _,r in pairs(DB.battleground.reports) do return tostring(r.premadeNonce) end`)).toBe("nil");
  });
  it.each(["short", "x".repeat(101), "two codes", ""])("rejects an invalid premade code %s", code => {
    const lua = setup();
    lua.run(`NS.commandHandlers.bgcapture("on normal"); NS.commandHandlers.bgcapture("premade ${code}"); fire_event("PVP_MATCH_ACTIVE"); COMPLETE = true; fire_event("PVP_MATCH_COMPLETE")`);
    expect(lua.run(`for _,r in pairs(DB.battleground.reports) do return tostring(r.premadeNonce) end`)).toBe("nil");
  });

  it("defaults off, requires normal consent, and never captures an active match", () => {
    const lua = setup();
    lua.run(`fire_event("PVP_MATCH_ACTIVE"); fire_event("PVP_MATCH_COMPLETE")`);
    expect(lua.run(count)).toBe("0");
    lua.run(`NS.commandHandlers.bgcapture({"on", "normal"}); fire_event("PVP_MATCH_ACTIVE"); fire_event("PVP_MATCH_COMPLETE")`);
    expect(lua.run(count)).toBe("0");
    lua.run(`COMPLETE = true; ACTIVE = false; DURATION = 600; CLOCK = CLOCK + 600; fire_event("PVP_MATCH_COMPLETE"); fire_event("PVP_MATCH_COMPLETE")`);
    expect(lua.run(count)).toBe("1");
    expect(lua.run(`for _,r in pairs(DB.battleground.reports) do return r.presence end`)).toBe("complete");
  });
  it("keeps report ID across reload and marks incomplete presence conservatively", () => {
    const lua = setup();
    lua.run(`NS.commandHandlers.bgcapture("on normal"); fire_event("PVP_MATCH_ACTIVE"); OLD_ID = DB.battleground.active["Kev-Realm"].reportId; fire_event("PLAYER_LOGIN"); COMPLETE = true; DURATION = 600; fire_event("PVP_MATCH_COMPLETE")`);
    expect(lua.run(`return DB.battleground.reports[OLD_ID].presence`)).toBe("unknown");
    lua.run(`fire_event("PLAYER_LOGIN"); fire_event("PVP_MATCH_COMPLETE")`);
    expect(lua.run(count)).toBe("1");
  });
  it("blocks Hardcore, unsupported editions, missing APIs and secret postmatch values", () => {
    const lua = setup();
    // Each condition is checked on its own: reset to a supported client first.
    for (const condition of [`HARDCORE = true`, `EDITION = "unknown"`, `C_GameRules = nil`, `C_PvP.IsRatedMap = nil`]) {
      lua.run(`EDITION = "forever"; HARDCORE = false; C_GameRules = { IsHardcoreActive = function() return HARDCORE end }; DB.battleground = nil; ${condition}; NS.commandHandlers.bgcapture("on normal")`);
      expect(lua.run(`return tostring(DB.battleground.consents["Kev-Realm"])`)).toBe("nil");
    }
    lua.run(`C_PvP.IsRatedMap = function() return false end`);
    // Hardcore exists on Era: unknown Hardcore status is never assumed normal there, but is on clients without Hardcore.
    lua.run(`EDITION = "classic-era"; C_GameRules = nil; DB.battleground = nil; NS.commandHandlers.bgcapture("on normal")`);
    expect(lua.run(`return tostring(DB.battleground.consents["Kev-Realm"])`)).toBe("nil");
    lua.run(`EDITION = "retail"; HARDCORE = true; C_GameRules = { IsHardcoreActive = function() return HARDCORE end }; NS.commandHandlers.bgcapture("on normal")`);
    expect(lua.run(`return tostring(DB.battleground.consents["Kev-Realm"])`)).toBe("nil");
    lua.run(`EDITION = "forever"; C_GameRules = {IsHardcoreActive = function() return false end}; NS.commandHandlers.bgcapture("on normal"); fire_event("PVP_MATCH_ACTIVE"); COMPLETE = true; DURATION = "SECRET"; fire_event("PVP_MATCH_COMPLETE")`);
    expect(lua.run(count)).toBe("0");
  });
  it.each(["forever", "classic-era", "classic-tbc", "classic-mists", "retail"])("captures its own report on %s with that edition's adapter", edition => {
    const lua = setup();
    lua.run(`EDITION = "${edition}"; ${edition === "classic-tbc" || edition === "classic-mists" || edition === "retail" ? "C_GameRules = nil;" : ""} NS.commandHandlers.bgcapture("on normal"); fire_event("PVP_MATCH_ACTIVE"); COMPLETE = true; ACTIVE = false; DURATION = 600; CLOCK = CLOCK + 600; fire_event("PVP_MATCH_COMPLETE")`);
    expect(lua.run(count)).toBe("1");
    expect(lua.run(`for _,r in pairs(DB.battleground.reports) do return r.edition .. "|" .. r.adapter end`)).toBe(`${edition}|${edition}-postmatch-v1`);
  });
  it("revocation prevents completion and backfill remains labelled", () => {
    const lua = setup();
    lua.run(`NS.commandHandlers.bgcapture("on normal"); fire_event("PLAYER_ENTERING_WORLD"); COMPLETE = true; DURATION = 90; fire_event("PVP_MATCH_COMPLETE")`);
    expect(lua.run(`for _,r in pairs(DB.battleground.reports) do return r.presence end`)).toBe("backfill");
    lua.run(`NS.commandHandlers.bgcapture("off"); fire_event("PVP_MATCH_ACTIVE"); fire_event("PVP_MATCH_COMPLETE")`);
    expect(lua.run(count)).toBe("1");
  });
});
