// Uses only synthetic files. Never prints pairing codes or session credentials.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { unzipSync } from 'fflate';
import { pairAccount, testConnection, createEngine } from '../companion/engine.mjs';
import { readAddonExport } from '../companion/lua-export.mjs';
import { writeStandings } from '../companion/standings.mjs';
import { credentialHeaders, requestJson } from '../companion/request.mjs';

const [endpoint, codeFile] = process.argv.slice(2);
const url = new URL(endpoint);
assert.equal(url.origin, 'https://guilded-store-review.kcaron.workers.dev');
assert.ok(codeFile, 'Provide the ignored local code file, never the code itself.');
const pairingCode = (await readFile(codeFile, 'utf8')).trim();
assert.match(pairingCode, /^[A-F0-9]{12}$/);
const output = resolve('backups/store-review-smoke');
await mkdir(output, { recursive: true });
const kitResponse = await fetch(new URL('/review-kit.zip', url));
assert.equal(kitResponse.status, 200);
const archive = unzipSync(new Uint8Array(await kitResponse.arrayBuffer()));
for (const [name, bytes] of Object.entries(archive)) {
  const destination = resolve(output, name);
  assert.ok(destination.startsWith(output + '\\') || destination.startsWith(output + '/'));
  await mkdir(resolve(destination, '..'), { recursive: true });
  await writeFile(destination, bytes);
}
const uploadUrl = new URL('/api/v1/addon-imports', url).href;
const pair = await pairAccount({ uploadUrl, pairingCode });
assert.equal(pair.ok, true, 'Actual companion pairing failed.');
const config = { uploadUrl, guildDiscordId: pair.guildDiscordId, companionCredential: pair.companionCredential,
  watchFile: join(output, 'Guilded-Store-Review/WTF/Account/REVIEW/SavedVariables/Guilded.lua'),
  wowEnabled: true, poeEnabled: false, realm: 'Review Realm' };
assert.equal((await testConnection(config)).ok, true);
assert.equal((await writeStandings(config)).body.standings[0].ep, 0);
const engine = createEngine(config);
try {
  assert.equal(await engine.start(), true);
  const deadline = Date.now() + 30_000;
  while (!engine.state().lastUpload && !engine.state().uploadError && Date.now() < deadline) await new Promise(done => setTimeout(done, 200));
  assert.equal(engine.state().uploadError, null, 'Actual engine upload failed.');
  assert.equal(engine.state().uploads, 1, 'Engine did not complete first import.');
} finally { await engine.stop(); }
const standings = await writeStandings(config);
assert.equal(standings.body.standings[0].ep, 100);
assert.ok((await readFile(standings.path, 'utf8')).includes('Reviewmage'));
const headers = { ...credentialHeaders(config), 'content-type': 'application/json' };
const exported = await readAddonExport(config.watchFile, config.realm);
const call = (path, payload) => requestJson(new URL(path, url), {
  method: 'POST', headers, body: JSON.stringify(payload)
});
assert.equal((await call('/api/v1/addon-imports', { guildDiscordId: config.guildDiscordId, export: exported })).response.status, 409);
assert.equal((await call('/api/v1/addon-imports', { guildDiscordId: config.guildDiscordId, export: { ...exported, privateNote: 'rejected-synthetic-probe' } })).response.status, 422);
assert.equal((await requestJson(new URL('/api/v1/standings?guild=another-guild', url), { headers })).response.status, 403);
assert.equal((await call('/api/v1/companion/logout', { guildDiscordId: config.guildDiscordId })).response.status, 200);
assert.equal((await testConnection(config)).ok, false);
const evidence = { verifiedAt: new Date().toISOString(), endpoint: url.origin, syntheticOnly: true,
  checks: ['kit download', 'real companion pairing', 'connection', 'engine upload', 'standings file', 'duplicate', 'modified export rejected', 'cross-guild denied', 'logout revocation'],
  productionAccess: false, gameTested: false };
await writeFile(join(output, 'result.json'), JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence));
