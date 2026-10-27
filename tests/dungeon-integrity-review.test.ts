import { describe, expect, it, vi } from "vitest";
import { dungeonRoleFixture } from "./fixtures/dungeon-role-contract.js";
import { agrees, summarize, prismaPublicRunStore, publicEvidenceFinalized } from "../src/services/public-runs.js";
import { leaderRun, rankCharacters } from "../src/services/public-leaderboard.js";
import { publicRules, snapshotRules, rateRun } from "../src/services/public-score.js";
import { finalizeClosingSeasons, startSeason } from "../src/services/dungeon-admin.js";
import { UPLOAD_GRACE_MS } from "../src/services/dungeon-integrity.js";

const start = new Date("2026-11-05T00:00:00Z"), end = new Date("2026-12-05T00:00:00Z");
const rules = { ...publicRules(), evidencePolicy: "current-v2" as const };
const snapshot = { ...snapshotRules(rules, start), rules };
const windows = [{ startsAt: start, rules: snapshot }, { startsAt: end, rules: null }];

describe("observer integrity repair", () => {
  it.each([false,true])("ranks a supported capture API contract under current-v1, standalone=%s", standalone => {
    // Mocked game globals, real Compat, capture, final-boss fallback, SavedVariables
    // reader and scorer. No invented reset witness or overridden completion helper.
    const { run } = dungeonRoleFixture(standalone, "DAMAGER", { nativeApi: true });
    expect(run).toMatchObject({ instanceId: 36, completedBy: "final boss", integrity: { startWitness: "unknown" } });
    expect(run.encounters?.some(e=>e.id===2747 && e.success)).toBe(true);
    const row = leaderRun({ ...summarize(run), id:"api", confirmations:1 } as never);
    const verdict = rateRun(row, snapshotRules(publicRules(),start).rules);
    expect(verdict.reason).toBeUndefined();
    expect(verdict).toMatchObject({score:{points:expect.any(Number)}});
    expect(verdict.score!.points).toBeGreaterThan(0);
    expect(rateRun(row, rules).score).toBeNull();
  });
  it.each([false,true])("retains the clock and counts reload gaps as unknown, standalone=%s", standalone => {
    const { run } = dungeonRoleFixture(standalone, "DAMAGER", { nativeApi:true, reloadGap:120 });
    expect(run.endedAt! - run.startedAt!).toBe(1320);
    expect(run.integrity?.continuous).toBe(true);
    expect(run.players[0]?.integrity).toMatchObject({ knownSec:1170, unknownSec:150 });
  });
  it("does not confuse different local observations with contradictory clear facts", () => {
    const first = summarize(dungeonRoleFixture().run), other = structuredClone(first);
    other.integrity = { run:{version:2,startWitness:"unknown",startTrigger:"peer",continuous:false},
      players:[{character:"Tester",realm:"TestRealm",observation:{knownSec:300,unknownSec:900,mixedRole:true}}] };
    expect(agrees(first,other)).toBe(true);
    expect(agrees(other,first)).toBe(true);
    expect(agrees(first,{...other,durationSec:1})).toBe(false);
    expect(first.integrity).not.toEqual(other.integrity); // no synthetic union
  });
  it("never includes unscored v2 captures on fastest-player boards", () => {
    const row = leaderRun({...summarize(dungeonRoleFixture().run),id:"unknown",confirmations:1} as never);
    expect(rankCharacters([row],{className:null,role:null,confirmed:false},100,rules)).toEqual([]);
  });
});

describe("grace finality repair", () => {
  it("freezes canonical public evidence exactly at cutoff, preserving legacy windows", () => {
    const played = new Date(end.getTime()-1), deadline = new Date(end.getTime()+UPLOAD_GRACE_MS);
    expect(publicEvidenceFinalized(windows,played,new Date(deadline.getTime()-1))).toBe(false);
    expect(publicEvidenceFinalized(windows,played,deadline)).toBe(true);
    expect(publicEvidenceFinalized(windows,end,deadline)).toBe(false);
    expect(publicEvidenceFinalized([{...windows[0]!,rules:snapshotRules(publicRules(),start)},windows[1]!],played,deadline)).toBe(false);
  });
  it("stores a conflicting late report without changing canonical status or confirmations", async () => {
    const summary = summarize(dungeonRoleFixture().run,new Date(end.getTime()+UPLOAD_GRACE_MS));
    const stored = {...summary,id:"r",gameEdition:"forever",endedAt:new Date(end.getTime()-1),status:"ACCEPTED",uploads:[]};
    const tx = { $executeRaw:vi.fn(), publicRun:{findUniqueOrThrow:async()=>stored,update:vi.fn()},
      publicRunUpload:{create:vi.fn()}, officialSeason:{findMany:async()=>windows} };
    const db = {$transaction:async(fn:(t:typeof tx)=>unknown)=>fn(tx)};
    const result = await prismaPublicRunStore(db as never).addUpload("r",{key:"other",reporters:["tester"]},{...summary,durationSec:20});
    expect(result).toEqual({agree:false,duplicate:false,historyOnly:true});
    expect(tx.publicRun.update).not.toHaveBeenCalled();
    expect(tx.publicRunUpload.create).toHaveBeenCalledWith({data:expect.objectContaining({historyOnly:true,evidence:expect.any(Object)})});
  });
  it("closes a v2 season without early champions then finalizes once after grace", async () => {
    vi.useFakeTimers(); vi.setSystemTime(end);
    try {
      const season = {id:"s",guildId:"g",name:"First",status:"ACTIVE",startsAt:start,endsAt:end,ratingRules:rules};
      const tx = {$executeRaw:vi.fn(), dungeonSeason:{findFirst:async()=>season,
        findMany:async()=>[season], update:vi.fn(async({data}:{data:object})=>Object.assign(season,data)),create:vi.fn(async()=>({id:"next"}))},
        dungeonRun:{findMany:async()=>[]}, dungeonPointTransaction:{groupBy:async()=>[]},member:{count:async()=>0,findMany:async()=>[]},
        guildSettings:{findUnique:async()=>null},dungeonAchievement:{upsert:vi.fn()} };
      const db = {...tx,$transaction:async(fn:(t:typeof tx)=>unknown)=>fn(tx)};
      await startSeason(db as never,"g","Next","s",undefined,publicRules(),end);
      expect(season.status).toBe("CLOSING"); expect(tx.dungeonAchievement.upsert).not.toHaveBeenCalled();
      expect(tx.dungeonSeason.update).not.toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({finalRating:expect.anything()})}));
      // Return the candidate for all ticks, including retries, to test the locked recheck.
      db.dungeonSeason = {...tx.dungeonSeason,findMany:async()=>[{...season,guild:{discordId:"d"}}]};
      tx.dungeonSeason.findFirst = async()=>season.status==="CLOSING"?season:null as never;
      expect(await finalizeClosingSeasons(db as never,new Date(end.getTime()+UPLOAD_GRACE_MS-1))).toEqual([]);
      expect(await finalizeClosingSeasons(db as never,new Date(end.getTime()+UPLOAD_GRACE_MS))).toEqual(["g"]);
      expect(season.status).toBe("ENDED");
      expect(await finalizeClosingSeasons(db as never,new Date(end.getTime()+UPLOAD_GRACE_MS+1))).toEqual([]);
      expect(tx.dungeonAchievement.upsert).not.toHaveBeenCalled(); // no fabricated zero-point winners
    } finally {vi.useRealTimers();}
  });
});
