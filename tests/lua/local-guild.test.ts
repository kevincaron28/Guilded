import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";
let s: LuaSession;
afterEach(() => s?.close());
function setup() {
  s = newLuaSession(); s.run(`NS={}; GuildedDB=nil; MOCK_UNITS={player={name="Host"}}`);
  for (const f of ["Core.lua","Compat.lua","Modules/Sync.lua","Modules/Loot.lua","Modules/LocalGuild.lua","Modules/Backup.lua","Modules/Options.lua"]) s.load(f);
  s.run(`fire_event("PLAYER_LOGIN"); fire_event("PLAYER_ENTERING_WORLD"); NS.options.chooseSetup("local")`);
}
describe("addon-only guild administration", () => {
  it("creates/selects local cores and edits loot rules and main/bench rosters without companion data", () => {
    setup();
    s.run(`NS.localGuild.create("Tuesday raid"); NS.localGuild.configure("Tuesday raid","RESERVE",2)
      NS.localGuild.member("Tuesday raid","Amy","TANK","main")
      NS.localGuild.member("Tuesday raid","Bob","HEALER","bench")`);
    expect(s.run(`return NS.loot.core().id..":"..NS.loot.mode()..":"..NS.loot.reserveLimit()`)).toBe("local:1:RESERVE:2");
    expect(s.run(`local check=NS.loot.rosterCheck(NS.loot.core(),{"Amy"}); return #check.present..":"..#check.bench`)).toBe("1:1");
    s.run(`NS.localGuild.member("Tuesday raid","Amy","DPS","bench")`);
    expect(s.run(`return #NS.loot.core().roster..":"..NS.loot.core().roster[1].role`)).toBe("2:DPS");
    expect(s.run(`return tostring(NS.localGuild.remove("Tuesday raid","Amy",false))`)).toBe("false");
    s.run(`NS.localGuild.remove("Tuesday raid","Amy",true)`);
    expect(s.run(`return #NS.loot.core().roster`)).toBe("1");
  });
  it("keeps connected rules and core choices intact when switching modes", () => {
    setup(); s.run(`NS.localGuild.create("Local team"); NS.options.chooseSetup("connected")
      GuildedDB.lootRules={cores={{id="online",name="Online",mode="PRIORITY",roster={}}}}
      GuildedDB.settings.activeCore="online"; NS.options.chooseSetup("local")`);
    expect(s.run(`return NS.loot.core().name`)).toBe("Local team");
    s.run(`NS.options.chooseSetup("connected")`);
    expect(s.run(`return NS.loot.core().id`)).toBe("online");
    expect(s.run(`return tostring(NS.localGuild.create("Forbidden"))`)).toBe("false");
  });
  it("requires an officer and rejects malformed or duplicate core/member input", () => {
    setup();
    expect(s.run(`return tostring(NS.localGuild.create("|Hbad"))`)).toBe("false");
    s.run(`NS.localGuild.create("Team")`);
    expect(s.run(`return tostring(NS.localGuild.create("team"))`)).toBe("false");
    expect(s.run(`return tostring(NS.localGuild.member("Team","Amy","INVALID","main"))`)).toBe("false");
    s.run(`NS.isOfficer=function() return false end`);
    expect(s.run(`return tostring(NS.localGuild.member("Team","Amy","DPS","main"))`)).toBe("false");
    expect(s.run(`return #NS.loot.core().roster`)).toBe("0");
  });
  it("backs up local cores, prices and balances, previews restore and supports undo", () => {
    setup(); s.run(`NS.localGuild.create("Team"); NS.localGuild.member("Team","Amy","TANK","main")
      NS.loot.setPrice("Sword",25); NS.runCommand("award Amy 100 Attendance")
      CODE=NS.backup.build(); INFO=NS.backup.inspect(CODE)
      NS.localGuild.member("Team","Bob","DPS","main")
      GuildedDB.standings={updatedAt="later",players={Amy={ep=999,gp=0}}}; NS.backup.restore(CODE)`);
    expect(s.run(`return #NS.loot.core().roster..":"..NS.loot.priceOf("Sword")..":"..NS.effectiveStanding("Amy").ep`)).toBe("1:25:100");
    s.run(`NS.commandHandlers.restore({"undo"})`);
    expect(s.run(`return #NS.loot.core().roster`)).toBe("2");
    expect(s.run(`return GuildedDB.standings.players.Amy.ep`)).toBe("999");
  });
  it("does not follow a stale connected next raid in local mode", () => {
    setup(); s.run(`GuildedNextRaid={core="Connected",coreId="remote"}`);
    expect(s.run(`return tostring(NS.loot.coreName())`)).toBe("nil");
  });
});
