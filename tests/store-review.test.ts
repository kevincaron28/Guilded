import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { canonical, REVIEW_GUILD, reviewRequest } from '../store-review/handler.mjs';
import { parseAddonExportText } from '../companion/lua-export-content.mjs';
import { profileChoices } from '../companion/profiles.mjs';

const fixture = JSON.parse(readFileSync(new URL('../store-review/fixture-export.json', import.meta.url), 'utf8'));
const NOW = Date.parse('2026-10-26T17:00:00Z');
function harness() {
  const values = new Map(); let tail = Promise.resolve();
  const storage = {
    get: async (key: string) => structuredClone(values.get(key)),
    put: async (key: string, value: unknown) => { values.set(key, structuredClone(value)); },
    delete: async (key: string) => { values.delete(key); },
    transaction: async (work: (tx: unknown) => Promise<unknown>) => {
      const next = tail.then(() => work(storage)); tail = next.then(() => undefined, () => undefined); return next;
    }
  };
  const env = { REVIEW_CODE: '123456ABCDEF', REVIEW_EXPIRES_AT: '2026-11-25T23:59:59Z' };
  const call = (path: string, payload?: unknown, secret = '', now = NOW) => reviewRequest(new Request(`https://review.test${path}`, {
    method: payload === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', 'x-companion-credential': secret },
    ...(payload !== undefined ? { body: JSON.stringify(payload) } : {})
  }), env, storage, now);
  const pair = async () => (await (await call('/api/v1/addon-pairings', { code: env.REVIEW_CODE })).json()).companionCredential;
  return { call, pair, storage, env, values };
}
describe('isolated Store reviewer connection', () => {
  it('accepts exactly the export produced by the real companion parser', () => {
    const actual = parseAddonExportText(readFileSync(new URL('../store-review/Guilded.lua', import.meta.url), 'utf8'), 'Review Realm');
    expect(canonical(actual)).toBe(canonical(fixture));
  });
  it('fails closed for missing secrets, expiry and incorrect pairing codes', async () => {
    const h = harness();
    expect((await h.call('/api/v1/addon-pairings', { code: 'bad' })).status).toBe(401);
    expect((await h.call('/api/v1/addon-pairings', { code: h.env.REVIEW_CODE }, '', Date.parse('2026-11-26'))).status).toBe(503);
    h.env.REVIEW_CODE = '';
    expect((await h.call('/api/v1/standings')).status).toBe(503);
  });
  it('rejects unauthenticated and cross-guild requests; never exposes production routes', async () => {
    const h = harness(), secret = await h.pair();
    expect((await h.call(`/api/v1/standings?guild=${REVIEW_GUILD}`)).status).toBe(401);
    expect((await h.call('/api/v1/standings?guild=real-guild', undefined, secret)).status).toBe(403);
    for (const path of ['/api/v1/manage', '/api/v1/public-runs', '/api/v1/poe/visits', '/api/v1/companion/sign-in']) {
      expect((await h.call(path, {}, secret)).status).toBe(403);
    }
  });
  it('rejects real/modified exports and oversized bodies without storing the content', async () => {
    const h = harness(), secret = await h.pair();
    const sent = { guildDiscordId: REVIEW_GUILD, export: { ...fixture, privateNote: 'must-not-be-stored' } };
    expect((await h.call('/api/v1/addon-imports', sent, secret)).status).toBe(422);
    expect((await h.call('/api/v1/addon-imports', { text: 'x'.repeat(20_000) }, secret)).status).toBe(400);
    expect(JSON.stringify([...h.values.values()])).not.toContain('must-not-be-stored');
  });
  it('applies the synthetic import once under concurrency and changes only synthetic standings', async () => {
    const h = harness(), secret = await h.pair();
    const path = `/api/v1/standings?guild=${REVIEW_GUILD}`;
    expect((await (await h.call(path, undefined, secret)).json()).standings[0].ep).toBe(0);
    const replies = await Promise.all(Array.from({ length: 3 }, () => h.call('/api/v1/addon-imports', { guildDiscordId: REVIEW_GUILD, export: fixture }, secret)));
    expect(replies.map(r => r.status).sort()).toEqual([200, 409, 409]);
    const feed = await (await h.call(path, undefined, secret)).json();
    expect(feed.environment).toBe('synthetic-store-review');
    expect(feed.standings[0].ep).toBe(100);
  });
  it('revokes on logout, replacement, expiry and code rotation', async () => {
    const h = harness(), first = await h.pair(), second = await h.pair();
    const path = `/api/v1/standings?guild=${REVIEW_GUILD}`;
    expect((await h.call(path, undefined, first)).status).toBe(401);
    expect((await h.call(path, undefined, second, NOW + 86_400_001)).status).toBe(401);
    expect((await h.call('/api/v1/companion/logout', { guildDiscordId: REVIEW_GUILD }, second)).status).toBe(200);
    expect((await h.call(path, undefined, second)).status).toBe(401);
    const third = await h.pair(); h.env.REVIEW_CODE = 'FEDCBA654321';
    expect((await h.call(path, undefined, third)).status).toBe(401);
  });
  it('keeps rate-limit storage bounded and reopens on the next minute', async () => {
    const h = harness();
    for (let i = 0; i < 120; i++) await h.call('/api/v1/addon-pairings', { code: 'invalid' });
    expect((await h.call('/api/v1/addon-pairings', { code: 'invalid' })).status).toBe(429);
    expect((await h.call('/api/v1/addon-pairings', { code: 'invalid' }, '', NOW + 60_000)).status).toBe(401);
    expect(h.values.size).toBe(1);
  });
});
it('marks only authored profile fallback names for translation, preserving user/guild names', () => {
  expect(profileChoices({})[0]!.defaultName).toBe(true);
  expect(profileChoices({ profileName: 'Original connection' })[0]).toMatchObject({ defaultName: false, name: 'Original connection' });
  expect(profileChoices({ wowGuildName: 'Original connection' })[0]!.defaultName).toBe(false);
});
