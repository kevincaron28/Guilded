import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

function beforeFirstRun(): LuaSession {
  session = newLuaSession();
  session.run(`NS = {}; GuildedDB = nil; MOCK_UNITS = { player = { name = "Host" } }`);
  for (const file of ["Core.lua", "Compat.lua", "Modules/Sync.lua", "Modules/Loot.lua", "Modules/LocalGuild.lua", "Modules/Options.lua"]) {
    session.load(file);
  }
  session.run(`fire_event("PLAYER_LOGIN")`);
  return session;
}

describe("first-run connection detection", () => {
  it("keeps officer-shared standings in addon-only mode with local core tools available", () => {
    const s = beforeFirstRun();
    s.run(`
      NS.isOfficerName = function(name) return name == "Officer" end
      fire_event("CHAT_MSG_ADDON", "GuildedSync", "STAND|2026-10-14T12:00:00Z|0|1|1|Amy:100:10", "GUILD", "Officer-TestRealm")
    `);
    // Exercise the real receiver: peer snapshots do not carry localPublish.
    expect(s.run(`return NS.getDb().standings.from`)).toBe("Officer");
    expect(s.run(`return tostring(NS.getDb().standings.localPublish)`)).toBe("nil");
    s.run(`fire_event("PLAYER_ENTERING_WORLD")`);
    expect(s.run(`return NS.getSettings().setupMode`)).toBe("local");
    expect(s.run(`return tostring(NS.localGuild.create("Tuesday raid"))`)).toBe("true");
    expect(s.run(`return NS.loot.core().name`)).toBe("Tuesday raid");
    expect(s.run(`return NS.getDb().standings.players.Amy.ep`)).toBe("100");
  });

  it("recognizes a cached companion snapshot without the original file", () => {
    const s = beforeFirstRun();
    s.run(`
      NS.getDb().standings = { updatedAt = "2026-10-14T12:00:00Z", from = "companion", players = {} }
      fire_event("PLAYER_ENTERING_WORLD")
    `);
    expect(s.run(`return NS.getSettings().setupMode`)).toBe("connected");
  });

  it("does not infer a connection from legacy standings with an unknown source", () => {
    const s = beforeFirstRun();
    s.run(`
      NS.getDb().standings = { updatedAt = "2026-10-14T12:00:00Z", players = {} }
      fire_event("PLAYER_ENTERING_WORLD")
    `);
    expect(s.run(`return NS.getSettings().setupMode`)).toBe("local");
  });

  it.each(["local", "connected"])("preserves an explicit %s choice regardless of available companion data", (mode) => {
    const s = beforeFirstRun();
    s.run(`
      NS.getSettings().setupMode = "${mode}"
      GuildedStandings = ${mode === "local" ? '{ updatedAt = "2026-10-14T12:00:00Z", players = {} }' : "nil"}
      fire_event("PLAYER_ENTERING_WORLD")
    `);
    expect(s.run(`return NS.getSettings().setupMode`)).toBe(mode);
  });
});
