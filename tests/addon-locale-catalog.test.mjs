import { readFileSync } from 'node:fs';
import lua from 'luaparse';
import { expect, it } from 'vitest';
import { readTable, luaDecode } from '../scripts/addon-locale.mjs';

it('catalogues authored literal labels used by the addon language helpers', () => {
  const source = readFileSync('addon/Guilded/Locale.lua', 'utf8');
  const tables = ['FR', 'DE', 'ES'].map(lang => [lang, readTable(source, lang)]);
  const toc = readFileSync('addon/Guilded/Guilded.toc', 'utf8');
  const files = toc.split(/\r?\n/).map(line => line.trim().replaceAll('\\', '/')).filter(line => line.endsWith('.lua') && line !== 'Locale.lua');
  function visit(node, file) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression') {
      const base = node.base;
      const name = base?.type === 'Identifier' ? base.name : base?.type === 'MemberExpression' && base.identifier?.name === 'L' ? 'L' : null;
      const arg = name === 'L' ? node.arguments[0] : ['newButton', 'newLabel'].includes(name) ? node.arguments[1] : null;
      if (arg?.type === 'StringLiteral') {
        const key = arg.value ?? luaDecode(arg.raw.slice(1, -1));
        if (key) for (const [lang, entries] of tables) expect(entries.get(key), `${lang} ${file}: ${key}`).toBeTypeOf('string');
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(child => visit(child, file));
      else if (value && typeof value === 'object') visit(value, file);
    }
  }
  for (const file of files) visit(lua.parse(readFileSync(`addon/Guilded/${file}`, 'utf8'), { luaVersion: '5.1' }), file);
});
