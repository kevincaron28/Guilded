import { expect, it } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compactLedgerText, compactLedgerFile } from '../companion/ledger-compact.mjs';
import { parseAddonExportText, readDatabase } from '../companion/lua-export-content.mjs';

const saved = `GuildedDB = {
  version = 4,
  exportedAt = "2026-10-28T00:00:00Z",
  epgp = { ["Kévin"] = { ep = 5, gp = 0, ledger = {
    [1] = { id = "stable-id", epAmount = 5, gpAmount = 0, by = "Kévin", at = "2026-10-28T00:00:00Z", reason = "A \\"quoted\\" reason", voided = true, custom = "é" },
    [2] = { epAmount = 2, gpAmount = 0, by = "Kev", at = "2026-10-28T01:00:00Z", reason = "Legacy entry" },
  } } },
  futureField = { ["__proto__"] = "preserved", enabled = true }
}`;
it('reduces storage while preserving every value, void marker and import source reference',()=>{
  const result=compactLedgerText(saved);
  expect(result.after).toBeLessThan(result.before);
  expect(result.ledgerRows).toBe(2);
  expect(readDatabase(result.text)).toEqual(readDatabase(saved));
  expect({...parseAddonExportText(result.text,'Realm'),exportedAt:null}).toEqual({...parseAddonExportText(saved,'Realm'),exportedAt:null});
  expect(()=>compactLedgerText(saved+'\nOtherDB = {}')).toThrow(/only GuildedDB/);
});
it('previews by default and verifies a full recovery copy before replacing the file',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'guilded-compact-')), file=join(dir,'Guilded.lua');
  try {
    await writeFile(file,saved);
    expect((await compactLedgerFile(file)).applied).toBe(false);
    expect(await readFile(file,'utf8')).toBe(saved);
    await expect(compactLedgerFile(file,{apply:true})).rejects.toThrow(/Close WoW/);
    const result=await compactLedgerFile(file,{apply:true,gameClosed:true});
    expect(result.applied).toBe(true);
    if (!('backup' in result)) throw new Error('Applied compaction must return its recovery copy');
    expect(await readFile(result.backup,'utf8')).toBe(saved);
    expect(readDatabase(await readFile(file,'utf8'))).toEqual(readDatabase(saved));
  } finally {await rm(dir,{recursive:true,force:true});}
});
