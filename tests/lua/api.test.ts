import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

function withApi(): LuaSession {
  session = newLuaSession();
  session.run(`
    DB = {
      roster = { Bob = {}, Amy = {} },
      readiness = { Bob = { status = "PARTIAL", itemLevel = 62, inspectedAt = "t1", findings = { { code = "NO_FOOD", severity = "WARNING", message = "No food buff active." } } } },
      peerRoster = { Amy = { status = "READY", updatedAt = "t2" } },
      attunements = { Bob = { ["Onyxia Key"] = { completed = true }, ["Molten Core"] = { completed = false } } }
    }
    NS = {
      normalizeName = function(n) return (string.gsub(n, "^%l", string.upper)) end,
      getDb = function() return DB end,
      getStanding = function(n) if NS.normalizeName(n) == "Bob" then return { ep = 100, gp = 50, pr = 2 } end end,
      getStandingsUpdatedAt = function() return "2026-09-26T00:00:00Z" end,
      getActiveRaid = function() return { title = "MC", startedAt = "t0", secret = "x" } end,
      compat = { addonVersion = function() return "2.0.0" end }
    }
  `);
  session.load("Modules/API.lua");
  return session;
}

describe("GuildedAPI (read only, v1)", () => {
  it("answers standings, readiness, attunements, roster and raid queries", () => {
    const s = withApi();
    expect(s.run(`local a = GuildedAPI; return a.GetAPIVersion() .. "|" .. a.GetAddonVersion() .. "|" .. tostring(a.IsReady())`)).toBe("1|2.0.0|true");
    expect(s.run(`local r = GuildedAPI.GetStanding("bob"); return r.ep .. "/" .. r.gp .. "/" .. r.pr`)).toBe("100/50/2");
    expect(s.run(`return tostring(GuildedAPI.GetStanding("Nobody"))`)).toBe("nil");
    expect(s.run(`local r = GuildedAPI.GetReadiness("Bob"); return r.status .. "|" .. r.source .. "|" .. r.findings[1].code`)).toBe("PARTIAL|self|NO_FOOD");
    expect(s.run(`local r = GuildedAPI.GetReadiness("Amy"); return r.status .. "|" .. r.source`)).toBe("READY|peer");
    expect(s.run(`local l = GuildedAPI.GetAttunements("Bob"); return #l .. l[1].name .. tostring(l[1].completed)`)).toBe("2Molten Corefalse");
    expect(s.run(`return table.concat(GuildedAPI.GetRosterNames(), ",")`)).toBe("Amy,Bob");
    expect(s.run(`local r = GuildedAPI.GetActiveRaid(); return r.title .. tostring(r.secret)`)).toBe("MCnil");
  });

  it("returns copies, so callers cannot change saved data", () => {
    const s = withApi();
    s.run(`local r = GuildedAPI.GetReadiness("Bob"); r.status = "HACKED"; r.findings[1].code = "X"`);
    expect(s.run(`return DB.readiness.Bob.status .. DB.readiness.Bob.findings[1].code`)).toBe("PARTIALNO_FOOD");
  });

  it("cannot be overwritten and never raises", () => {
    const s = withApi();
    s.run(`GuildedAPI.GetStanding = function() return "evil" end`);
    expect(s.run(`return GuildedAPI.GetStanding("Bob").ep`)).toBe("100");
    s.run(`DB = nil`);
    expect(s.run(`return tostring(GuildedAPI.GetReadiness("Bob")) .. tostring(GuildedAPI.IsReady())`)).toBe("nilfalse");
  });
});
