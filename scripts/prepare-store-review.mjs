import { readFileSync, writeFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { parseAddonExportText } from '../companion/lua-export-content.mjs';
const source = readFileSync('store-review/Guilded.lua', 'utf8');
const parsed = parseAddonExportText(source, 'Review Realm');
writeFileSync('store-review/fixture-export.json', JSON.stringify(parsed, null, 2) + '\n');
writeFileSync('store-review/review-kit.zip', zipSync({
  'Guilded-Store-Review/README.md': strToU8(readFileSync('store-review/README.md', 'utf8')),
  'Guilded-Store-Review/WTF/Account/REVIEW/SavedVariables/Guilded.lua': strToU8(source),
  'Guilded-Store-Review/Interface/AddOns/Guilded/Guilded.toc': strToU8('## Title: Synthetic review folder only\nStandings.lua\n'),
  'Guilded-Store-Review/Interface/AddOns/Guilded/Standings.lua': strToU8('-- Synthetic review output; the companion writes here.\n')
}));
console.log('Synthetic fixture and review archive prepared. No credentials included.');
