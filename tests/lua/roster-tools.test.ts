import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";
let s: LuaSession;
afterEach(() => s?.close());
export const rosterPrelude = String.raw`
NS = { commandHandlers={}, commandHelp={}, isOfficer=function() return OFFICER end,
 normalizeName=function(n) return n end, playerName=function() return "Boss-Realm" end,
 util={gameEdition=function() return EDITION end, address=function(n) return n end} }
OFFICER=true; PRIVATE=true; PERMISSION=true; EDITION="classic-era"; CLOCK=100; COMBAT=false; CALLS={}; READS=0
function GetTime() return CLOCK end
function InCombatLockdown() return COMBAT end
function GetGuildInfo() return "Guild" end
function GetRealmName() return "Realm" end
function GuildControlGetNumRanks() return 5 end
ROWS={{name="Boss-Realm",rank=0,guid="boss",public="",officer=""},{name="Amy-Realm",rank=3,guid="amy",public="old",officer="secret"},{name="Bob-Realm",rank=3,guid="bob",public="",officer=""}}
function GetNumGuildMembers() return #ROWS end
function GetGuildRosterInfo(i) READS=READS+1; local r=ROWS[i]; return r.name,"Rank",r.rank,60,"Mage","Zone",r.public,r.officer,true,nil,"MAGE",0,0,false,false,0,r.guid end
function CanGuildPromote() return PERMISSION end
CanGuildDemote=CanGuildPromote;CanGuildRemove=CanGuildPromote;CanEditPublicNote=CanGuildPromote;CanEditOfficerNote=CanGuildPromote
function CanViewOfficerNote() return PRIVATE end
function GuildRoster() end
function GuildRosterSetPublicNote(i,n) CALLS[#CALLS+1]={i,n} end
function GuildRosterSetOfficerNote(i,n) CALLS[#CALLS+1]={i,n} end
function GuildPromote(n) CALLS[#CALLS+1]={n} end
GuildDemote=GuildPromote;GuildUninvite=GuildPromote
`;
function setup() { s = newLuaSession(); s.run(rosterPrelude); s.load("Modules/RosterTools.lua"); s.run('NS.util.gameEdition=function() return EDITION end; NS.util.address=function(n) return n end; fire_event("GUILD_ROSTER_UPDATE")'); return s; }
const preview = String.raw`assert(NS.rosterTools.preview("character\taction\tvalue\nAmy-Realm\tpublic\tnew")); assert(NS.rosterTools.confirm("APPLY 1"))`;
describe("native roster bulk operations", () => {
 it("discards the prior plan after invalid previews or failed recovery",()=>{setup();s.run(preview);s.run('NS.rosterTools.preview("bad")');expect(s.run('return tostring(NS.rosterTools.confirm("APPLY 1"))')).toBe('false');s.run(preview);s.run('NS.rosterTools.undoPreview()');expect(s.run('return tostring(NS.rosterTools.confirm("APPLY 1"))')).toBe('false');});
 it("requires a new roster event for a changed guild even before the guild-change event",()=>{setup();s.run('GetGuildInfo=function() return "New Guild" end');expect(s.run('return tostring(NS.rosterTools.snapshot())')).toBe('nil');s.run('fire_event("GUILD_ROSTER_UPDATE")');expect(s.run('return tostring(NS.rosterTools.snapshot() ~= nil)')).toBe('true');});
 it("preserves the pending receipt when the draft is invalidated",()=>{setup();s.run(preview);s.run('assert(NS.rosterTools.step());NS.rosterTools.invalidatePreview();ROWS[2].public="new";fire_event("GUILD_ROSTER_UPDATE")');expect(s.run('return NS.rosterTools.store().audit[1].status')).toBe('verified');expect(s.run('return tostring(NS.rosterTools.plan.confirmed)')).toBe('false');});

 it("invalidates rank changes and previous confirmations after malformed previews",()=>{setup();s.run('LABEL="Member"; GuildControlGetRankName=function(i) return LABEL..i end');s.run(preview);s.run('LABEL="Changed"');expect(s.run('return tostring(NS.rosterTools.step())')).toBe('false');s.close();setup();s.run(preview);s.run('NS.rosterTools.preview("bad")');expect(s.run('return tostring(NS.rosterTools.step())')).toBe('false');});
 it("wires manual review controls without triggering actions on open",()=>{
  setup();s.run(`local original=CreateFrame;function CreateFrame(kind,...)
    local f=original(kind,...); f.kind=kind; f.text=""; f.TitleText={SetText=function() end}
    f.SetText=function(self,v) self.text=v end; f.GetText=function(self) return self.text end
    f.CreateFontString=function() return CreateFrame("Font") end
    return f
  end
  COPIED=""; NS.showCopyText=function(t) COPIED=t end; NS.message=function() end; NS.grmMigration={};`);
  s.load('Modules/RosterAdmin.lua');s.run('NS.openRosterAdmin()');expect(s.run('return tostring(#CALLS)')).toBe('0');
  s.run(String.raw`for _,f in ipairs(FRAMES) do if f.kind=="EditBox" then f.text="character\taction\tvalue\nAmy-Realm\tpublic\tnew"; break end end
  function CLICK(text) for _,f in ipairs(FRAMES) do if f.text==text and f.scripts.OnClick then f.scripts.OnClick();return end end; error("missing button "..text) end
  CLICK("Preview actions")`);
  expect(s.run('return COPIED')).toContain('APPLY 1');expect(s.run('return tostring(#CALLS)')).toBe('0');s.run('CLICK("Apply next action")');expect(s.run('return tostring(#CALLS)')).toBe('0');
  s.run('local n=0;for _,f in ipairs(FRAMES) do if f.kind=="EditBox" then n=n+1;if n==2 then f.text="APPLY 1" end end end;CLICK("Confirm plan");CLICK("Apply next action")');expect(s.run('return tostring(#CALLS)')).toBe('1');
  s.run('ROWS[2].public="new";fire_event("GUILD_ROSTER_UPDATE");NS.grmMigration.pending={};for _,f in ipairs(FRAMES) do if f.kind=="EditBox" and f.scripts.OnTextChanged then f.scripts.OnTextChanged(f) end end');
  expect(s.run('return tostring(NS.rosterTools.plan)..":"..tostring(NS.grmMigration.pending)')).toBe('nil:nil');
 });

 it("does not write during preview, confirmation, login or frame updates",()=>{setup();s.run(preview);s.run('fire_event("PLAYER_LOGIN"); for _,f in ipairs(FRAMES) do if f.scripts.OnUpdate then f.scripts.OnUpdate() end end');expect(s.run('return tostring(#CALLS)')).toBe('0');});
 it("verifies only a fresh roster event and recovers the exact old note",()=>{setup();s.run(preview);s.run('assert(NS.rosterTools.step()); ROWS[2].public="new"; NS.rosterTools.verify(); assert(NS.rosterTools.plan.pending); fire_event("GUILD_ROSTER_UPDATE"); assert(not NS.rosterTools.plan.pending); assert(NS.rosterTools.undoPreview()); assert(NS.rosterTools.confirm("APPLY 1")); assert(NS.rosterTools.step())');expect(s.run('return CALLS[2][2]')).toBe('old');expect(s.run('return NS.rosterTools.store().audit[1].status')).toBe('verified');});
 it("uses the current roster index after reorder",()=>{setup();s.run(preview);s.run('ROWS[2],ROWS[3]=ROWS[3],ROWS[2]; fire_event("GUILD_ROSTER_UPDATE"); assert(NS.rosterTools.step())');expect(s.run('return tostring(CALLS[1][1])')).toBe('3');});
 it.each(['COMBAT=true','OFFICER=false','PERMISSION=false','ROWS[2].rank=0','ROWS[2].guid="replacement"','ROWS[2].public="someone else"','CLOCK=231','EDITION="retail"'])('revalidates before sending: %s', change=>{setup();s.run(preview);s.run(change);expect(s.run('return tostring(NS.rosterTools.step())')).toBe('false');expect(s.run('return tostring(#CALLS)')).toBe('0');});
 it("blocks duplicates and self edits",()=>{setup();expect(s.run(String.raw`local p=NS.rosterTools.preview("character\taction\tvalue\nAmy-Realm\tpublic\tx\nAmy-Realm\tdemote\t"); return tostring(p.blocked)`)).toBe('true');expect(s.run(String.raw`local p=NS.rosterTools.preview("character\taction\tvalue\nBoss-Realm\tpublic\tx"); return tostring(p.blocked)`)).toBe('true');});
 it("requires REMOVE and does not offer removal recovery",()=>{setup();s.run(String.raw`assert(NS.rosterTools.preview("character\taction\tvalue\nAmy-Realm\tkick\t")); assert(not NS.rosterTools.confirm("APPLY 1")); assert(NS.rosterTools.confirm("REMOVE 1")); assert(NS.rosterTools.step()); table.remove(ROWS,2); fire_event("GUILD_ROSTER_UPDATE")`);expect(s.run('return tostring(NS.rosterTools.undoPreview())')).toBe('nil');});
 it("stops on timeout without retries or per-frame roster rescans",()=>{setup();s.run(preview);s.run('assert(NS.rosterTools.step()); fire_event("GUILD_ROSTER_UPDATE"); READS=0; for i=1,100 do NS.rosterTools.verify() end');expect(s.run('return tostring(READS)')).toBe('0');s.run('CLOCK=116; NS.rosterTools.verify()');expect(s.run('return NS.rosterTools.store().audit[1].status')).toBe('unverified');expect(s.run('return tostring(NS.rosterTools.step())')).toBe('false');});
 it("uses GUID-based modern calls and one-based rank order",()=>{setup();s.run('C_GuildInfo={SetGuildRankOrder=function(g,r) CALLS[#CALLS+1]={g,r} end,IsGuildRankAssignmentAllowed=function() return true end}');s.run(String.raw`assert(NS.rosterTools.preview("character\taction\tvalue\nAmy-Realm\tpromote\t"));assert(NS.rosterTools.confirm("APPLY 1"));assert(NS.rosterTools.step())`);expect(s.run('return CALLS[1][1]..":"..CALLS[1][2]')).toBe('amy:3');});
 it("stops on game API errors and masks private audit values",()=>{setup();s.run(String.raw`GuildRosterSetOfficerNote=function() error("protected") end; assert(NS.rosterTools.preview("character\taction\tvalue\nAmy-Realm\tofficer\tprivate")); assert(NS.rosterTools.confirm("APPLY 1")); assert(not NS.rosterTools.step()); PRIVATE=false`);expect(s.run('return NS.rosterTools.auditText()')).not.toContain('secret');expect(s.run('return NS.rosterTools.store().audit[1].status')).toBe('failed');});
 it("refuses bare Forever first names and accepts full names",()=>{setup();s.run('EDITION="forever"; ROWS[2].name="Amy"; fire_event("GUILD_ROSTER_UPDATE")');expect(s.run(String.raw`return tostring(NS.rosterTools.preview("character\taction\tvalue\nAmy\tkick\t").blocked)`)).toBe('true');s.run('ROWS[2].name="Amy Winter"');expect(s.run(String.raw`return tostring(NS.rosterTools.preview("character\taction\tvalue\nAmy Winter\tkick\t").blocked)`)).toBe('false');});
 it("rejects oversized notes and requires a fresh full roster",()=>{setup();expect(s.run(String.raw`return tostring(NS.rosterTools.preview("character\taction\tvalue\nAmy-Realm\tpublic\t"..string.rep("x",32)))`)).toBe('nil');s.run('CLOCK=131');expect(s.run(String.raw`return tostring(NS.rosterTools.preview("character\taction\tvalue\nAmy-Realm\tpublic\tx"))`)).toBe('nil');});
});
