import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import luaparse from 'luaparse';
import { readSavedText } from './saved-file.mjs';
import { readDatabase } from './lua-export-content.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
// Lossless storage compaction, not history pruning: IDs, voids, timestamps,
// legacy positions and all unknown fields are retained and round-trip checked.
export function compactLedgerText(text) {
  const original = readDatabase(text);
  const ast = luaparse.parse(text.replace(/^\uFEFF/, ''), { comments: false });
  const statement = ast.body[0];
  if (ast.body.length !== 1 || statement?.type !== 'AssignmentStatement' || statement.variables.length !== 1
    || statement.variables[0].name !== 'GuildedDB' || statement.init.length !== 1) throw new Error('Compaction requires a file containing only GuildedDB. Original retained.');
  const source = text.replace(/^\uFEFF/, '');
  const lexer = luaparse.parse(source, { wait: true, comments: false });
  const chunks = [];
  let previous = '';
  for (let token = lexer.lex(); token.type !== luaparse.tokenTypes.EOF; token = lexer.lex()) {
    const raw = source.slice(token.range[0], token.range[1]);
    const a = previous.slice(-1), b = raw[0];
    if (/[A-Za-z0-9_.]/.test(a) && /[A-Za-z0-9_.]/.test(b) || a === '-' && b === '-' || a === '[' && b === '[') chunks.push(' ');
    chunks.push(raw); previous = raw;
  }
  const compacted = chunks.join('') + '\n';
  if (JSON.stringify(readDatabase(compacted)) !== JSON.stringify(original)) throw new Error('Compaction round-trip verification failed. Original retained.');
  const before = Buffer.byteLength(text), after = Buffer.byteLength(compacted);
  return { text: after < before ? compacted : text, before, after: Math.min(before, after),
    ledgerRows: Object.values(original.epgp || {}).reduce((count, account) => count + Object.keys(account.ledger || {}).length, 0) };
}
export async function compactLedgerFile(input, { apply = false, gameClosed = false } = {}) {
  if (apply && !gameClosed) throw new Error('Close WoW normally and supply --game-closed before applying compaction.');
  const path = resolve(input);
  const original = await readSavedText(path);
  const result = compactLedgerText(original);
  const report = { before: result.before, after: result.after, ledgerRows: result.ledgerRows, saved: result.before - result.after, applied: false };
  if (!apply || !report.saved) return report;
  const backup = path + '.before-compact-' + randomUUID() + '.bak';
  const temporary = path + '.' + randomUUID() + '.tmp';
  await writeFile(backup, original, { flag: 'wx', mode: 0o600 });
  if (hash(await readFile(backup)) !== hash(original)) throw new Error('Backup verification failed. Original retained.');
  try {
    await writeFile(temporary, result.text, { flag: 'wx', mode: 0o600 });
    if (hash(await readFile(path)) !== hash(original)) throw new Error('Saved data changed during compaction. Original retained; close WoW first.');
    await rename(temporary, path);
    return { ...report, applied: true, backup, beforeSha256: hash(original), afterSha256: hash(result.text) };
  } finally { await rm(temporary, { force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), index = args.indexOf('--input');
  if (index < 0 || !args[index + 1]) throw new Error('Usage: npm run ledger:compact -- --input Guilded.lua [--apply --game-closed]');
  console.log(JSON.stringify(await compactLedgerFile(args[index + 1], { apply: args.includes('--apply'), gameClosed: args.includes('--game-closed') }), null, 2));
}
