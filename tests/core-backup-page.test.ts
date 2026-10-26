import { describe, expect, it, vi } from 'vitest';
import { createRaidCoreService } from '../src/services/raid-core.js';
function setup() {
  const core={id:'c',realm:'Realm',members:[{id:'spot',memberId:'m',characterId:'main',backups:[]}]};
  const tx={raidCore:{findFirst:vi.fn().mockResolvedValue(core)},character:{findMany:vi.fn().mockResolvedValue([{id:'new',name:'Ann',realm:'Realm'}])},raidCoreBackup:{deleteMany:vi.fn(),createMany:vi.fn()}};
  const database={$transaction:vi.fn(async(work:(tx:unknown)=>Promise<unknown>)=>work(tx))};
  return {tx,database,service:createRaidCoreService(database as never)};
}
describe('atomic backup page changes',()=>{
  it('clears only the visible page without attempting an empty insert',async()=>{
    const {service,tx}=setup();tx.character.findMany.mockResolvedValue([]);
    expect(await service.replaceBackupPage('g','c','m',['old'],[],'DPS')).toBe(0);
    expect(tx.raidCoreBackup.deleteMany).toHaveBeenCalledWith({where:{spotId:'spot',characterId:{in:['old']}}});
    expect(tx.raidCoreBackup.createMany).not.toHaveBeenCalled();
  });
  it('validates owned IDs, preserves other pages and existing roles, and writes in one transaction',async()=>{
    const {service,tx,database}=setup();
    expect(await service.replaceBackupPage('g','c','m',['old','new'],['new'],'HEALER')).toBe(1);
    expect(tx.character.findMany).toHaveBeenCalledWith({where:{memberId:'m',member:{guildId:'g'},id:{in:['new']}}});
    expect(tx.raidCoreBackup.deleteMany).toHaveBeenCalledWith({where:{spotId:'spot',characterId:{in:['old']}}});
    expect(tx.raidCoreBackup.createMany).toHaveBeenCalledWith({data:[{spotId:'spot',characterId:'new',role:'HEALER'}],skipDuplicates:true});
    expect(database.$transaction).toHaveBeenCalledWith(expect.any(Function),{isolationLevel:'Serializable',timeout:15000,maxWait:15000});
  });
  it.each(['unlinked','wrong-realm'])('does not remove anything when a selection is %s',async reason=>{
    const {service,tx}=setup();tx.character.findMany.mockResolvedValue(reason==='unlinked'?[]:[{id:'new',name:'Ann',realm:'Other'}]);
    await expect(service.replaceBackupPage('g','c','m',['old','new'],['new'],'DPS')).rejects.toThrow();
    expect(tx.raidCoreBackup.deleteMany).not.toHaveBeenCalled();expect(tx.raidCoreBackup.createMany).not.toHaveBeenCalled();
  });
  it('refuses selections outside the displayed page before querying the database',async()=>{
    const {service,database}=setup();await expect(service.replaceBackupPage('g','c','m',['old'],['foreign'],'DPS')).rejects.toThrow();expect(database.$transaction).not.toHaveBeenCalled();
  });
});
