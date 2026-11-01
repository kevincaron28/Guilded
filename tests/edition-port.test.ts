import { describe, expect, it, vi } from "vitest";
import { Collection } from "discord.js";
import { addProfile, switchProfile } from "../companion/profiles.mjs";
import { characterKey, characterReference } from "../companion/character-identity.mjs";
import { bindGuildScope, currentGuildScope, entityGuildScope, guildWhere, interactionGuildScope, runInGuildScope } from "../src/services/guild-scope.js";
import { currentEdition, withEdition } from "../src/services/edition-context.js";
import { hasPermission } from "../src/permissions.js";
import { findCharacter, selectedCharacter } from "../src/services/character-match.js";
import { assessRaidReadiness } from "../src/services/readiness.js";
import { coreComposition } from "../src/services/core-planning.js";
import { GAME_EDITIONS } from "../companion/game-edition.mjs";
import { configureNextSeasonRules } from "../src/services/official-seasons.js";
import type { Guild } from "../src/generated/prisma/client.js";

const scope = (id: string, gameEdition = "retail") => ({ guild: { id, discordId: "server", scopeKey: id, gameEdition, name: id } as Guild, permissionRoles: { officer: `${id}-officer` } });

describe("full edition routing", () => {
  it("keeps open setup and reset confirmations in their original guild after selection changes", () => {
    const callback = runInGuildScope(scope("original"), () => bindGuildScope(() => guildWhere("server")));
    expect(runInGuildScope(scope("other"), callback)).toEqual({id:"original"});
    expect(callback()).toEqual({id:"original"});
  });
  it("keeps simultaneous requests and nested jobs in their own guild", async () => {
    await Promise.all(["one", "two"].map(id => runInGuildScope(scope(id), async () => {
      await Promise.resolve();
      expect(guildWhere("server")).toEqual({ id });
      expect(currentEdition()).toBe("retail");
      await runInGuildScope(scope("nested", "classic-tbc"), async () => { expect(currentEdition()).toBe("classic-tbc"); });
      expect(currentGuildScope()?.guild.id).toBe(id);
    })));
    expect(currentGuildScope()).toBeUndefined();
    expect(guildWhere("server")).toEqual({ discordId_scopeKey: { discordId: "server", scopeKey: "default" } });
  });
  it("does not grant another guild's officer access from the same role name", () => {
    const member = { permissions: { has: () => false }, roles: { cache: new Collection([["two-officer", {id:"two-officer",name:"Officer"}]]) } };
    expect(runInGuildScope(scope("one"), () => hasPermission(member as never, "officer"))).toBe(false);
    expect(runInGuildScope(scope("two"), () => hasPermission(member as never, "raidLeader"))).toBe(true);
  });
  it("routes a bound channel before a personal selection and rejects foreign servers", async () => {
    const findFirst = vi.fn(async () => ({ ...scope("channel").guild, wowSpace: { permissionRoles: {}, memberRoleId: null } }));
    const choice = vi.fn();
    const db = { wowGuildChannel: { findUnique: async () => ({scopeGuildId:"channel"}) }, wowGuildSelection: { findUnique: choice }, guild: { findFirst } };
    expect((await interactionGuildScope(db as never,{discordId:"server",userId:"user",channelId:"text"}))?.guild.id).toBe("channel");
    expect(choice).not.toHaveBeenCalled();
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({where:{id:"channel",discordId:"server"}}));
  });
  it("routes persisted application decisions by the application guild", async () => {
    const db = { application: { findUnique: vi.fn(async()=>({guildId:"one"})) }, guild: {findFirst:vi.fn(async()=>({...scope("one").guild,wowSpace:null}))} };
    expect((await entityGuildScope(db as never,"server","apply-form:decide:approve:application"))?.guild.id).toBe("one");
    expect(db.application.findUnique).toHaveBeenCalledWith({where:{id:"application"},select:{guildId:true}});
  });
  it.each(["bgCategoryId", "bgGroupsChannelId", "bgResultsChannelId", "bgStatsChannelId"])("routes persisted %s before the member's other guild selection", async field => {
    const selection = vi.fn();
    const settings = vi.fn(async (query: { where: { guild: { discordId: string }; OR: Record<string, { in: string[] }>[] } }) =>
      query.where.guild.discordId === "server" && query.where.OR.some(row => row[field]?.in.includes("bg-channel")) ? [{ guildId: "bg-owner" }] : []);
    const db = {
      wowGuildChannel: { findUnique: vi.fn(async () => null) }, guildSettings: { findMany: settings },
      raidCore: { findMany: vi.fn(async () => []) }, activityCore: { findMany: vi.fn(async () => []) },
      wowGuildSelection: { findUnique: selection },
      guild: { findFirst: vi.fn(async () => ({ ...scope("bg-owner").guild, wowSpace: null })) }
    };
    expect((await interactionGuildScope(db as never, { discordId: "server", userId: "user", channelId: "bg-channel" }))?.guild.id).toBe("bg-owner");
    expect(selection).not.toHaveBeenCalled();
    expect(db.guild.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "bg-owner", discordId: "server" } }));
  });
  it("routes weekly dungeon and PvP team responses to the session's guild", async () => {
    const db = { activitySession: { findUnique: vi.fn(async()=>({core:{guildId:"one"}})) }, guild: {findFirst:vi.fn(async()=>({...scope("one").guild,wowSpace:null}))} };
    expect((await entityGuildScope(db as never,"server","team:session:DPS"))?.guild.id).toBe("one");
  });
});

describe("edition identities and companion connections", () => {
  it("normalizes connected realms without collapsing names on different realms", () => {
    expect(characterReference("Amy-Area 52","Other","retail")).toEqual({character:"Amy",realm:"area52"});
    expect(characterKey("Amy","Area 52","retail")).not.toBe(characterKey("Amy","Illidan","retail"));
    expect(characterKey("Amy","Forever","forever")).toBe("amy");
    const chars=[{name:"Amy",realm:"Area 52",gameEdition:"retail"},{name:"Amy",realm:"Illidan",gameEdition:"retail"}];
    expect(findCharacter(chars,"Amy-Area52","","retail")).toBe(chars[0]);
    expect(findCharacter(chars,"Amy","Unknown","retail")).toBeUndefined();
    expect(selectedCharacter(chars,"Amy-Area52")).toBe(chars[0]);
    expect(()=>selectedCharacter(chars,"Amy")).toThrow("Several characters");
  });
  it("switches credentials, WoW files and PoE state together without copying the old credential", () => {
    const original={companionCredential:"forever-secret",watchFile:"Forever.lua",gameEdition:"forever",poeEnabled:true};
    const next=addProfile(original,"Retail guild");
    expect(next.companionCredential).toBe(""); expect(next.watchFile).toBe(""); expect(next.poeEnabled).toBe(false);
    const retail={...next,companionCredential:"retail-secret",watchFile:"Retail.lua",gameEdition:"retail"};
    const back=switchProfile(retail,"default");
    expect(back.companionCredential).toBe("forever-secret"); expect(back.watchFile).toBe("Forever.lua");
    expect(switchProfile(back,retail.activeProfile).companionCredential).toBe("retail-secret");
    expect(()=>switchProfile(back,"__proto__")).toThrow();
  });
  it.each(GAME_EDITIONS)("uses the raid level for %s even outside a request", edition => {
    const level=edition==="retail"||edition==="classic-mists"?90:edition==="classic-tbc"?70:60;
    const now=new Date();
    expect(assessRaidReadiness({status:"READY",inspectedAt:now,character:{level:level-1,gameEdition:edition},findings:[]},now).status).toBe("LEVELLING");
    expect(assessRaidReadiness({status:"READY",inspectedAt:now,character:{level,gameEdition:edition},findings:[]},now).status).toBe("READY");
  });
  it("supports Retail flexible raid sizes without changing Classic raid formats", () => {
    expect(withEdition("retail",()=>coreComposition("17","2","4","11")).raidSize).toBe(17);
    expect(()=>withEdition("classic-era",()=>coreComposition("17","2","4","11"))).toThrow();
  });
});

describe("edition season rules", () => {
  const rules = {gameEdition:"retail",brackets:[{key:"90",min:90,max:90,bestCount:1}],routes:[{
    dungeonKey:"90001",instanceId:90001,name:"Synthetic test route",completion:{ids:[999],names:[]},requiredEncounters:[],
    routeStandard:"Synthetic fixture only",participationBand:{min:90,max:90,difficultyId:1},competitionBand:{min:90,max:90,difficultyId:1},
    targetSec:600,verification:{build:"SYNTHETIC",runRef:"TEST-ONLY"}
  }]};
  it("rejects another edition's rules and a season that started during the update", async () => {
    const db={officialSeason:{findFirst:vi.fn(async()=>({id:"pending"})),updateMany:vi.fn(async()=>({count:0}))}};
    await expect(withEdition("classic-era",()=>configureNextSeasonRules(db as never,rules))).rejects.toThrow("selected WoW edition");
    expect(db.officialSeason.findFirst).not.toHaveBeenCalled();
    await expect(withEdition("retail",()=>configureNextSeasonRules(db as never,rules))).rejects.toThrow("season has started");
  });
  it("freezes reviewed rules only for the selected edition's pending season", async () => {
    const db={officialSeason:{findFirst:vi.fn(async()=>({id:"pending"})),updateMany:vi.fn(async()=>({count:1}))}};
    expect(await withEdition("retail",()=>configureNextSeasonRules(db as never,rules))).toBe(1);
    expect(db.officialSeason.findFirst).toHaveBeenCalledWith(expect.objectContaining({where:{gameEdition:"retail",startsAt:{gt:expect.any(Date)}}}));
    expect(db.officialSeason.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:{id:"pending",gameEdition:"retail",startsAt:{gt:expect.any(Date)}},data:{rules:expect.objectContaining({rules:expect.objectContaining({gameEdition:"retail"})})}}));
  });
});
