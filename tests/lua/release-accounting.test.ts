import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";
let s: LuaSession;
afterEach(() => s?.close());
function setup() {
  s = newLuaSession();
  s.run('GuildedDB=nil; NS={}; MOCK_UNITS={player={name="Kev"}}');
  s.load("Core.lua"); s.load("Modules/Sync.lua"); s.load("Modules/Loot.lua");
  s.run('fire_event("PLAYER_LOGIN")');
  return s;
}
describe("release accounting: real Lua modules together", () => {
  it("finds guild prices with no selected core", () => {
    setup().run('NS.getLootRules=function() return {default="PRIORITY", values={["test sword"]=30}, cores={}} end');
    expect(s.run('return NS.loot.priceOf("Test Sword")')).toBe("30");
  });
  it("updates priority immediately, shares alt balances, then acknowledges without double-counting", () => {
    setup().run(`GuildedDB.standings={updatedAt="2026-09-29T00:00:00Z",from="companion",baseGp=0,
      players={Ann={ep=100,gp=10,pr=10,account="m1"},Alt={ep=100,gp=10,pr=10,account="m1"}}}
      SlashCmdList.GUILDED("gp Alt 10 Test loot")`);
    expect(s.run('return NS.loot.prFor("Ann")')).toBe("5.0");
    s.run(`local e=GuildedDB.epgp.Alt.ledger[1]
      GuildedDB.acceptedLedgerRefs={["addon:qg:"..e.id]=true}
      GuildedDB.standings.players.Ann.gp=20
      GuildedDB.standings.players.Alt.gp=20`);
    expect(s.run('return NS.loot.prFor("Ann")')).toBe("5.0");
  });
  it("keeps separate pools isolated and deducts against the synced balance", () => {
    setup().run(`GuildedDB.lootRules={default="PRIORITY",values={},cores={
      {id="a",name="A",pool=true,baseGp=0,players={Ann={ep=100,gp=10,pr=10}}},
      {id="b",name="B",pool=true,baseGp=0,players={Ann={ep=200,gp=10,pr=20}}}}}
      NS.getSettings().activeCore="a"
      SlashCmdList.GUILDED("gp Ann 10 Test loot")`);
    expect(s.run('return GuildedDB.epgp.Ann.ledger[1].coreId')).toBe("a");
    expect(s.run('return NS.effectiveStanding("Ann", "a").gp')).toBe("20");
    expect(s.run('return NS.effectiveStanding("Ann", "b").gp')).toBe("10");
    expect(s.run('return GuildedDB.epgp.Ann.gp')).toBe("0");
    s.run('SlashCmdList.GUILDED("gpdeduct Ann 100 Returned item")');
    expect(s.run('return NS.effectiveStanding("Ann", "a").gp')).toBe("0");
    expect(s.run('return GuildedDB.epgp.Ann.ledger[2].gpAmount')).toBe("-20");
  });
  it("preserves old standalone balances and never overlays an already published local ledger", () => {
    setup().run('SlashCmdList.GUILDED("award Ann 100 Raid attendance"); SlashCmdList.GUILDED("gp Ann 10 Test loot")');
    expect(s.run('return NS.loot.prFor("Ann")')).toBe("10.0");
    s.run('NS.publishLocalStandings()');
    expect(s.run('return NS.loot.prFor("Ann")')).toBe("10.0");
    s.run('SlashCmdList.GUILDED("gp Ann 10 Second loot")');
    expect(s.run('return NS.loot.prFor("Ann")')).toBe("5.0");
  });
});
