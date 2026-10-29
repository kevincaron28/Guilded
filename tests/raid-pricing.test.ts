import { afterEach, describe, expect, it, vi } from "vitest";
import { decemberPricing, EQUIPMENT_SLOTS, pricingForAddon, quoteRaidItem } from "../src/services/raid-pricing.js";
import { keyOf, parseItemValues } from "../src/services/item-values.js";
import { addonLootSchema } from "../src/integrations/addon.js";
import { standingsToLua } from "../companion/standings-format.mjs";
import { newLuaSession, type LuaSession } from "./lua/harness.js";
import { runAutoDecay } from "../src/services/auto-decay.js";
import * as epgp from "../src/services/epgp.js";
import { describePriority } from "../src/services/loot-priority.js";

let lua: LuaSession | undefined;
afterEach(() => { lua?.close(); lua = undefined; vi.restoreAllMocks(); });
function addon(values: { key: string; id: number; gp: number }[] = []) {
  lua = newLuaSession();
  lua.run(standingsToLua({ standings: [], loot: { default: "PRIORITY", coreOnly: true, values: [{ key: "#12345", id: 12345, gp: 999 }], cores: [{
    id: "core", name: "December", mode: "PRIORITY", separatePool: true, baseGp: 100, offspecPercent: 50,
    pricing: pricingForAddon(decemberPricing("classic-era"), 3), values
  }] } }));
  lua.run(`RAID={coreId="core"}; DB={}; SETTINGS={activeCore="core"}; NS={
    getLootRules=function() return GuildedLoot end, getSettings=function() return SETTINGS end,
    getDb=function() return DB end, getActiveRaid=function() return RAID end,
    isOfficer=function() return true end, commandHandlers={}, commandHelp={}, message=function() end
  }`);
  lua.load("Modules/Loot.lua");
  lua.run('NS.util.gameEdition=function() return "classic-era" end');
  return lua;
}

describe("December prices: shared TypeScript policy and actual Lua quotes", () => {
  it("quotes every equipment category identically through the companion feed", () => {
    const s=addon();
    for (const equipLoc of Object.keys(EQUIPMENT_SLOTS)) {
      s.run(`function GetItemInfo() return "Item",nil,4,100,nil,nil,nil,nil,"${equipLoc}",nil,nil,nil,0 end`);
      const quote=quoteRaidItem(decemberPricing("classic-era"),{edition:"classic-era",equipLoc,quality:4});
      expect(s.run('return NS.loot.quoteFor("item:12345").baseGp'), equipLoc).toBe(String(quote!.baseGp));
    }
    s.run('function GetItemInfo() return "Wand",nil,4,100,nil,nil,nil,nil,"INVTYPE_RANGEDRIGHT",nil,nil,nil,19 end');
    expect(s.run('return NS.loot.quoteFor("item:12345").baseGp')).toBe("25");
    expect(quoteRaidItem(decemberPricing("classic-era"),{edition:"classic-era",equipLoc:"INVTYPE_HAND"},50)?.gp).toBe(38);
    expect(quoteRaidItem(decemberPricing("classic-era"),{edition:"classic-era",equipLoc:"INVTYPE_RELIC"},50)?.gp).toBe(13);
  });
  it("requires confirmation for uncached items and never leaks another edition's preset", () => {
    const s=addon();
    expect(s.run('return tostring(NS.loot.quoteFor("item:12345").provisional)')).toBe("true");
    expect(s.run('return tostring(NS.loot.priceOf("item:12345"))')).toBe("nil");
    s.run('NS.util.gameEdition=function() return "retail" end');
    expect(s.run('return tostring(NS.loot.quoteFor("item:12345"))')).toBe("nil");
    expect(quoteRaidItem(decemberPricing("classic-era"),{edition:"retail",equipLoc:"INVTYPE_HEAD"})).toBeNull();
  });
  it("keeps variant overrides specific and pins prices across refresh and reload", () => {
    const s=addon([{key:"#12345@ilvl:100",id:12345,gp:175}]);
    s.run('LEVEL=100; function GetItemInfo() return "Sword",nil,4,LEVEL,nil,nil,nil,nil,"INVTYPE_WEAPON" end');
    expect(s.run('return NS.loot.priceOf("item:12345")')).toBe("175");
    s.run('LEVEL=101; GuildedLoot.cores[1].pricing.slots.oneHand=777; GuildedLoot.cores[1].pricing.revision=4');
    s.run('GuildedLoot.cores[1].pool=false');
    expect(s.run('return tostring(NS.loot.core().pool)')).toBe("true");
    expect(s.run('return NS.loot.priceOf("item:12345")')).toBe("100");
    s.load("Modules/Loot.lua");
    expect(s.run('return NS.loot.quoteFor("item:12345").revision')).toBe("3");
    s.run('RAID={coreId="core"}');
    expect(s.run('return NS.loot.priceOf("item:12345")')).toBe("777");
  });
  it("retains more than 400 exported exceptions and rejects oversized imports atomically", () => {
    const values=Array.from({length:501},(_,i)=>({key:`#${10000+i}`,id:10000+i,gp:i}));
    const s=addon(values);
    expect(s.run('return NS.loot.priceOf("item:10500")')).toBe("500");
    const parsed=parseItemValues(values.map(v=>`${v.id} = ${v.gp}`).join("\n"));
    expect(parsed.values).toHaveLength(0);expect(parsed.problems[0]).toContain("Nothing saved");
    const variant=parseItemValues("id:12345@ilvl:100 = 175").values[0]!;
    expect(keyOf(variant)).toBe("#12345@ilvl:100");
    expect(parseItemValues("id:12345@difficulty:heroic = 200").values).toHaveLength(0);
  });
  it("prices verified token rewards once and checks imported quote consistency", () => {
    const p=decemberPricing("classic-era");
    expect(quoteRaidItem(p,{edition:p.edition,rewardSlots:["accessory","armorLarge"]})?.baseGp).toBe(100);
    expect(quoteRaidItem(p,{edition:p.edition,legendaryFragment:true})).toMatchObject({gp:0,provisional:false});
    expect(quoteRaidItem(p,{edition:p.edition,equipLoc:"INVTYPE_WEAPON",quality:5})?.gp).toBe(400);
    const row={ref:"award",character:"Ann",realm:"Realm",item:"Sword",gp:38,pricing:{preset:p.preset,edition:p.edition,revision:3,coreId:"core",itemLink:"item:123",baseGp:75,finalGp:38,response:"offspec",source:"slot",provisional:false}};
    expect(addonLootSchema.safeParse(row).success).toBe(true);
    expect(addonLootSchema.safeParse({...row,gp:75}).success).toBe(false);
  });
});

it("never declares a wishlist-order winner for a preset PR tie", () => {
  const ranking=["Ann","Bob"].map((name,i)=>({memberId:name,displayName:name,character:name,ep:100,gp:0,pr:1,wishPriority:i+1,wishedAt:new Date()}));
  const text=describePriority("Sword","December",{price:null,ranking,outsideCore:0,visibleTies:true});
  expect(text).toContain("Priority tie");expect(text).toContain("/roll 100");expect(text).not.toContain("Goes to");
});

it("decays only the opted-in core after reset, defers an active raid, and reuses the weekly reference", async () => {
  const apply=vi.fn().mockResolvedValue([]);vi.spyOn(epgp,"createEpgpService").mockReturnValue({applyDecay:apply} as never);
  const core={id:"core",guildId:"guild",pricingAutoDecay:true,separatePool:true,decayPercent:0.1,lastPricingDecayAt:new Date("2026-12-14T20:00Z"),guild:{settings:{}}};
  const active=vi.fn().mockResolvedValue(1);
  const db={guildSettings:{findMany:async()=>[]},raidCore:{findMany:async()=>[core],update:async({data}:{data:{lastPricingDecayAt:Date}})=>Object.assign(core,data)},raid:{count:active}};
  expect(await runAutoDecay(db as never,new Date("2026-12-15T14:00Z"))).toBe(0);
  expect(await runAutoDecay(db as never,new Date("2026-12-15T16:00Z"))).toBe(0);
  expect(apply).not.toHaveBeenCalled();active.mockResolvedValue(0);
  expect(await runAutoDecay(db as never,new Date("2026-12-15T17:00Z"))).toBe(1);
  expect(apply).toHaveBeenCalledWith("guild",0.1,"auto-decay","core","decay:core:2026-12-15");
  expect(await runAutoDecay(db as never,new Date("2026-12-16T17:00Z"))).toBe(0);
});
