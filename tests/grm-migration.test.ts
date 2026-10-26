import { afterEach, describe, expect, it } from "vitest";
import { convertGRM, parseGRM, archiveCode } from "../companion/grm-migration.mjs";
import { newLuaSession, type LuaSession } from "./lua/harness.js";
const source = String.raw`GRM_GuildMemberHistory_Save={ ["Guild-Realm"]={ ["Élodie-Realm"]={name="Élodie-Realm",rankName="Member",rankIndex=3,note="Crafter",officerNote="Private",customNote="Personal",rankHist={{"Member",{25,10,2026}}},joinDateHist={{25,10,2026}},altGroup=1,unknownField="omit"}}}
GRM_PlayersThatLeftHistory_Save={["Guild-Realm"]={["Former-Realm"]={name="Former-Realm",note="Past"}}}
GRM_Alts={["Guild-Realm"]={[1]={{name="Élodie-Realm"},{name="Former-Realm"},main="Élodie-Realm"}}}
GRM_LogReport_Save={["Guild-Realm"]={{5,"Élodie-Realm: private history","Private"}}}`;
const options = {guildKey:"Guild-Realm",guild:"Guild",realm:"Realm",edition:"classic-era"};
let s: LuaSession | undefined;
afterEach(()=>{s?.close();s=undefined;});
function setup() {
 s=newLuaSession();s.run(`NS={commandHandlers={},commandHelp={},isOfficer=function() return OFFICER end}; OFFICER=true; PRIVATE=true; EDITION="classic-era"; function GetGuildInfo() return "Guild" end; function GetRealmName() return "Realm" end; function CanViewOfficerNote() return PRIVATE end`);
 s.load("Util.lua");s.run('NS.util.gameEdition=function() return EDITION end');s.load("Modules/Backup.lua");s.load("Modules/RosterTools.lua");s.load("Modules/GRMMigration.lua"); return s;
}
const literal = (value:string) => `[==[${value}]==]`;
describe("offline GRM migration",()=>{
 it("preserves distinct large string keys through actual Lua import",()=>{
   const input=source.replace('GRM_Alts={["Guild-Realm"]={[1]={{name="Élodie-Realm"},{name="Former-Realm"},main="Élodie-Realm"}}}', 'GRM_Alts={["Guild-Realm"]={["9007199254740992"]="first",["9007199254740993"]="second"}}');
   const {code}=convertGRM(input,options);const lua=setup();
   lua.run(`assert(NS.grmMigration.preview(${literal(code)}));assert(NS.grmMigration.import("IMPORT"))`);
   expect(lua.run('local g=NS.rosterTools.store().grm.groups;return g["9007199254740992"]..":"..g["9007199254740993"]')).toBe('first:second');
 });
 it.each(['9007199254740993','1e999','0.5'])('rejects unsafe numeric table keys: %s',key=>{expect(()=>parseGRM(`GRM_Alts={[${key}]="value"}`)).toThrow();});
 it("does not count nil entries as migrated groups or logs",()=>{
   const input=source.replace('GRM_Alts={["Guild-Realm"]={[1]=', 'GRM_Alts={["Guild-Realm"]={[2]=nil,[1]=');
   const result=convertGRM(input,options);expect(result.summary.groups).toBe(1);expect(result.archive.groups[2]).toBeUndefined();
 });
 it("rejects malformed former-member containers instead of silently dropping them",()=>{expect(()=>convertGRM(source.replace(/GRM_PlayersThatLeftHistory_Save=.*\n/, 'GRM_PlayersThatLeftHistory_Save={["Guild-Realm"]=42}\n'),options)).toThrow('must use tables');});
 it("rejects malformed top-level history containers",()=>{expect(()=>convertGRM(source.replace(/GRM_PlayersThatLeftHistory_Save=.*\n/, 'GRM_PlayersThatLeftHistory_Save=42\n'),options)).toThrow('must use tables');});
 it.each(['GRM_Alts={["Guild-Realm"]=42}','GRM_Alts={["Guild-Realm"]={bad=1e20}}','GRM_Alts={["Guild-Realm"]={bad="\\001"}}'])('refuses data the addon cannot import: %s', extra=>{expect(()=>convertGRM(source.replace(/GRM_Alts=.*\n/, extra+"\n"),options)).toThrow();});
 it("applies private-note exclusion recursively to groups and nested member data",()=>{
   const nested=source.replace('altGroup=1,unknownField="omit"','altGroup=1,professions={officerNote="Nested secret"},unknownField="omit"').replace('main="Élodie-Realm"','main="Élodie-Realm",customNote="Group secret"');
   const publicArchive=convertGRM(nested,options);expect(JSON.stringify(publicArchive.archive)).not.toContain('Nested secret');expect(JSON.stringify(publicArchive.archive)).not.toContain('Group secret');
   const privateArchive=convertGRM(nested,{...options,includePrivate:true});expect(JSON.stringify(privateArchive.archive)).toContain('Nested secret');expect(JSON.stringify(privateArchive.archive)).toContain('Group secret');
   const lua=setup();expect(lua.run(`return tostring(NS.grmMigration.preview(${literal(publicArchive.code)}) ~= nil)`)).toBe('true');
 });

 it("preserves names, structured history and alt groups without private data by default",()=>{const {archive,summary}=convertGRM(source,options);expect(archive.members["Élodie-Realm"].rankHist[1][1]).toBe("Member");expect(archive.members["Élodie-Realm"].officerNote).toBeUndefined();expect(summary).toMatchObject({current:1,former:1,groups:1,logs:0,omittedLogs:1,omittedFields:3});expect(archive.groups[1].main).toBe("Élodie-Realm");});
 it("preserves UTF-8 and decimal escaped source strings",()=>{expect(parseGRM(String.raw`GRM_Alts={name="\195\137lodie",other="中文"}`).GRM_Alts).toMatchObject({name:"Élodie",other:"中文"});});
 it.each(['GRM_Alts=loadstring("bad")()', 'GRM_Alts={a=function() end}', 'GRM_Alts={a=1,a=2}', 'GRM_Alts={__proto__={}}', 'os.execute("bad")'])('rejects executable or ambiguous data: %s',text=>expect(()=>parseGRM(text)).toThrow());
 it("requires explicit matching guild and edition",()=>{expect(()=>convertGRM(source,{...options,edition:"unknown"})).toThrow();expect(()=>convertGRM(source,{...options,realm:"Other"})).toThrow();});
 it("roundtrips through actual Lua preview/import/export, preserving only local archive state",()=>{const result=convertGRM(source,options);const lua=setup();lua.run(`CODE=${literal(result.code)}; assert(NS.grmMigration.preview(CODE)); assert(NS.grmMigration.import("IMPORT"))`);expect(lua.run('return NS.grmMigration.history("Élodie")')).toContain('Member');expect(lua.run('return tostring(GuildedDB)')).toBe('nil');expect(lua.run('return tostring(NS.grmMigration.preview(CODE))')).toBe('nil');const exported=lua.run('return NS.grmMigration.export()');lua.run('assert(NS.grmMigration.undo("UNDO IMPORT"))');expect(lua.run(`return tostring(NS.grmMigration.preview(${literal(exported)}) ~= nil)`)).toBe('true');});
 it("keeps private history behind current permission and checks again at confirmation",()=>{const {code}=convertGRM(source,{...options,includePrivate:true});const lua=setup();lua.run(`CODE=${literal(code)};PRIVATE=false`);expect(lua.run('return tostring(NS.grmMigration.preview(CODE))')).toBe('nil');lua.run('PRIVATE=true; assert(NS.grmMigration.preview(CODE));PRIVATE=false');expect(lua.run('return tostring(NS.grmMigration.import("IMPORT"))')).toBe('false');lua.run('PRIVATE=true;assert(NS.grmMigration.import("IMPORT"));PRIVATE=false');expect(lua.run('return tostring(NS.grmMigration.export())')).toBe('nil');expect(lua.run('return NS.grmMigration.history("Élodie")')).not.toContain('Private');});
 it("rejects corrupted or differently scoped archives",()=>{const {code,archive}=convertGRM(source,options);const lua=setup();expect(lua.run(`return tostring(NS.grmMigration.preview(${literal(code.replace('GGRM1:','GGRM1:0'))}))`)).toBe('nil');expect(lua.run(`return tostring(NS.grmMigration.preview(${literal(archiveCode({...archive,edition:'retail'}))}))`)).toBe('nil');});
 it("restores the previous archive and requires exact confirmation",()=>{const a=convertGRM(source,options), b=convertGRM(source.replace('Crafter','Crafter updated'),options);const lua=setup();lua.run(`assert(NS.grmMigration.preview(${literal(a.code)}));assert(not NS.grmMigration.import("yes"));assert(NS.grmMigration.import("IMPORT"));assert(NS.grmMigration.preview(${literal(b.code)}));assert(NS.grmMigration.import("IMPORT"));assert(NS.grmMigration.undo("UNDO IMPORT"))`);expect(lua.run('return NS.grmMigration.history("Élodie")')).not.toContain('updated');});
});
