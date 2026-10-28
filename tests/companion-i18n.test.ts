import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const { translate, message, normalizeLanguage } = require('../companion-app/i18n.cjs');
const fr: Record<string, string> = require('../companion-app/locales/fr.json');

describe('companion French presentation', () => {
  it('preserves every interpolation slot and covers authored T calls', () => {
    const slots = (text: string) => [...text.matchAll(/\{\d+\}/g)].map(match => match[0]).sort();
    for (const [key, value] of Object.entries(fr)) expect(slots(value), key).toEqual(slots(key));
    for (const file of ['main.cjs', 'grm-import.cjs', 'renderer/app.js', 'renderer/manage.js']) {
      const source = ts.createSourceFile(file, readFileSync(new URL(`../companion-app/${file}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      function visit(node: ts.Node) {
        if (ts.isCallExpression(node) && node.expression.getText(source) === 'T') {
          const key = node.arguments[0];
          if (key && ts.isStringLiteral(key)) expect(fr[key.text], `${file}: ${key.text}`).toBeTypeOf('string');
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  });
  it('uses French variants but retains English and arbitrary user data', () => {
    expect(normalizeLanguage('fr-CA')).toBe('fr');
    expect(normalizeLanguage('de')).toBe('en');
    expect(translate('en', 'Saved {0} to {1}.', '$&', 'D:\\Guilded')).toBe('Saved $& to D:\\Guilded.');
    expect(message('fr', 'Unknown diagnostic: $& Guilded')).toBe('Unknown diagnostic: $& Guilded');
    const path = 'D:\\Games\\SavedVariables\\Guilded.lua';
    expect(message('fr', `Updated addon data for 3 character(s) in ${path}.`)).toBe(`Données de l’addon actualisées pour 3 personnage(s) dans ${path}.`);
    expect(translate('fr', 'Backup: {0} ({1})', 'Save', 'DPS')).toBe('Renfort : Save (DPS)');
    expect(message('fr', 'Unknown diagnostic: member Save')).toBe('Unknown diagnostic: member Save');
  });
  it('translates composed sync diagnostics without hiding held or disputed records', () => {
    const result = message('fr', 'Uploaded and applied automatically (3 ledger entries, 1 new characters). 2 on hold: an officer can see why with /import held. This character is linked to another member; ask an officer to resolve it.');
    expect(result).toContain('2 en attente');
    expect(result).toContain('/import held');
    expect(result).toContain('autre membre');
    expect(result).not.toContain('This character');
    expect(message('fr', 'Connected. PoE2 tracking is paused; an officer can enable /poe setup.')).toContain('en pause');
    expect(message('fr', 'Public leaderboards: 1 new, 2 confirmed, 3 already sent, 4 refused (unknown-route).')).toBe('Classements publics : 1 nouveaux, 2 confirmés, 3 déjà envoyés, 4 refusés (unknown-route).');
    expect(message('fr', "Save is on Run's wishlist.")).toBe('Save figure dans la liste de souhaits de Run.');
  });
  it('stores native language separately without rewriting pairing or starting a sync', () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const writeFileSync = vi.fn();
    const frame = { url: new URL("../companion-app/renderer/index.html", import.meta.url).href };
    const contents = { mainFrame: frame };
    const ipcEvent = { sender: contents, senderFrame: frame };
    const appRequire = createRequire(new URL('../companion-app/main.cjs', import.meta.url));
    runInNewContext(readFileSync(new URL('../companion-app/main.cjs', import.meta.url), 'utf8') + '\nwin = { webContents: ipcTestContents };', {
      ipcTestContents: contents,
      require: (id: string) => id === 'electron' ? {
        app: { requestSingleInstanceLock: () => true, whenReady: () => new Promise(() => {}), on: vi.fn(), getPath: () => 'C:/fixture-user-data' },
        ipcMain: { handle: (name: string, handler: (...args: unknown[]) => unknown) => handlers.set(name, (_event, ...args) => handler(ipcEvent, ...args)) }
      } : id === 'node:fs' ? { mkdirSync: vi.fn(), writeFileSync } : appRequire(id),
      process: { argv: [] }, __dirname: fileURLToPath(new URL("../companion-app/", import.meta.url))
    });
    expect(handlers.get('set-language')!(null, 'fr')).toBe('fr');
    expect(writeFileSync).toHaveBeenCalledOnce();
    const [path, content] = writeFileSync.mock.calls[0]!;
    expect(String(path).replaceAll('\\', '/')).toBe('C:/fixture-user-data/language.json');
    expect(JSON.parse(content)).toEqual({ language: 'fr' });
    expect(() => handlers.get('set-language')!(null, 'unsupported')).toThrow('Unsupported language');
    expect(writeFileSync).toHaveBeenCalledOnce();
  });
});
