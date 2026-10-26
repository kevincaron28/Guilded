import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { convertGRM } from "../companion/grm-migration.mjs";
const { createGRMConverter } = createRequire(import.meta.url)("../companion-app/grm-import.cjs");
const source='GRM_GuildMemberHistory_Save={["Guild-Realm"]={["Amy-Realm"]={name="Amy-Realm",note="Crafter"}}}';
function setup() {
 const fs={stat:vi.fn().mockResolvedValue({size:source.length}),readFile:vi.fn().mockResolvedValue(source),writeFile:vi.fn().mockResolvedValue(undefined)};
 const dialog={showOpenDialog:vi.fn().mockResolvedValue({canceled:false,filePaths:["source.lua"]}),showMessageBox:vi.fn().mockResolvedValue({response:1}),showSaveDialog:vi.fn().mockResolvedValue({canceled:false,filePath:"archive.txt"})};
 const handler=createGRMConverter({fs,dialog,convertGRM,getWindow:()=>null,T:(key:string,...values:unknown[])=>key.replace(/\{(\d+)\}/g,(_,i)=>String(values[Number(i)]))});
 return {fs,dialog,handler};
}
const options={guild:"Guild",realm:"Realm",edition:"classic-era",includePrivate:false};
describe('companion GRM file flow',()=>{
 it('reviews counts before saving a new archive without changing source files',async()=>{const {handler,fs,dialog}=setup();expect(await handler(options)).toMatchObject({ok:true,summary:{current:1,private:false}});expect(dialog.showMessageBox).toHaveBeenCalledWith(null,expect.objectContaining({defaultId:0,detail:expect.stringContaining('1 current members')}));expect(fs.writeFile).toHaveBeenCalledWith('archive.txt',expect.stringMatching(/^GGRM1:/),{flag:'wx',mode:0o600});expect(fs.writeFile).toHaveBeenCalledTimes(1);});
 it.each(['file','review','destination'])('does not save after %s cancellation',async stage=>{const {handler,fs,dialog}=setup();if(stage==='file')dialog.showOpenDialog.mockResolvedValue({canceled:true});if(stage==='review')dialog.showMessageBox.mockResolvedValue({response:0});if(stage==='destination')dialog.showSaveDialog.mockResolvedValue({canceled:true});expect(await handler(options)).toMatchObject({canceled:true});expect(fs.writeFile).not.toHaveBeenCalled();});
 it('refuses oversized input before reading and handles conflicting output without overwrite',async()=>{const {handler,fs}=setup();fs.stat.mockResolvedValue({size:16000001});expect(await handler(options)).toMatchObject({ok:false});expect(fs.readFile).not.toHaveBeenCalled();fs.stat.mockResolvedValue({size:100});fs.writeFile.mockRejectedValue(Object.assign(new Error('exists'),{code:'EEXIST'}));expect(await handler(options)).toMatchObject({ok:false,message:'Choose a new filename. Existing files are never overwritten.'});});
 it('rejects ambiguous guild/edition input without producing an archive',async()=>{const {handler,fs}=setup();expect(await handler({...options,edition:'unknown'})).toMatchObject({ok:false});expect(await handler({...options,guild:''})).toMatchObject({ok:false});expect(fs.writeFile).not.toHaveBeenCalled();});
});
