// Explicit synthetic review environment. No production imports, DB, OAuth or Discord binding.
import fixture from './fixture-export.json' with { type: 'json' };
export const REVIEW_GUILD = 'guilded-store-review';
const MAX_BODY = 16_384;
const json = (status, body) => globalThis.Response.json({ ...body, environment: 'synthetic-store-review' }, {
  status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
});
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const hash = async value => Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');
const token = () => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
async function body(request) {
  if (request.headers.get('content-encoding') || !request.headers.get('content-type')?.startsWith('application/json')) throw new Error('Use uncompressed JSON.');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('JSON body required.');
  const chunks = []; let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_BODY) { await reader.cancel(); throw new Error('Review request exceeds 16 KiB.'); }
      chunks.push(next.value);
    }
    const data = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new globalThis.TextDecoder().decode(data));
  } finally { reader.releaseLock(); }
}
export async function reviewRequest(request, env, storage, now = Date.now()) {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/health') return json(200, { ok: true, productionAccess: false });
  const until = Date.parse(env.REVIEW_EXPIRES_AT ?? '');
  if (!/^[A-F0-9]{12}$/.test(env.REVIEW_CODE ?? '') || !Number.isFinite(until) || until <= now) return json(503, { error: 'Review access is disabled or expired.' });
  const generation = await hash(env.REVIEW_CODE);
  // One bounded counter, never one persistent key per attacker-controlled address.
  const allowed = await storage.transaction(async tx => {
    const minute = Math.floor(now / 60_000); const prior = await tx.get('rate');
    const rate = prior?.minute === minute ? prior : { minute, count: 0 };
    if (rate.count >= 120) return false;
    await tx.put('rate', { minute, count: rate.count + 1 }); return true;
  });
  if (!allowed) return json(429, { error: 'Review request limit reached. Retry next minute.' });
  try {
    if (request.method === 'POST' && url.pathname === '/api/v1/addon-pairings') {
      const input = await body(request);
      if (typeof input?.code !== 'string' || await hash(input.code) !== generation || (input.guildDiscordId && input.guildDiscordId !== REVIEW_GUILD)) return json(401, { error: 'Invalid review code or guild.' });
      const secret = token(); const digest = await hash(secret);
      // Re-pairing replaces the prior session, so stored state stays bounded.
      await storage.put('session', { digest, generation, expiresAt: Math.min(until, now + 86_400_000), imported: false });
      return json(200, { companionCredential: secret, guildDiscordId: REVIEW_GUILD, gameEdition: 'retail', wowGuildName: 'Guilded Review Sandbox' });
    }
    const supplied = request.headers.get('x-companion-credential') ?? '';
    if (supplied.length !== 64) return json(401, { error: 'Pair with the private review code.' });
    const digest = await hash(supplied);
    const session = await storage.get('session');
    if (!session || session.digest !== digest || session.generation !== generation || session.expiresAt <= now) return json(401, { error: 'Review session expired or revoked. Pair again.' });
    if (request.method === 'GET' && url.pathname === '/api/v1/standings') {
      if (url.searchParams.get('guild') !== REVIEW_GUILD) return json(403, { error: 'This connection can access only the review guild.' });
      return json(200, { protocolVersion: 2, botVersion: '7.5.0', gameEdition: 'retail', features: [], updatedAt: new Date(now).toISOString(), baseGp: 100,
        wowGuildName: 'Guilded Review Sandbox', standings: [{ character: 'Reviewmage', realm: 'Review Realm', displayName: 'Reviewmage (synthetic)', className: 'MAGE', ep: session.imported ? 100 : 0, gp: 0 }] });
    }
    if (request.method === 'POST' && url.pathname === '/api/v1/companion/logout') {
      const input = await body(request);
      if (input?.guildDiscordId !== REVIEW_GUILD) return json(403, { error: 'Wrong review guild.' });
      await storage.transaction(async tx => { if ((await tx.get('session'))?.digest === digest) await tx.delete('session'); });
      return json(200, { ok: true });
    }
    if (request.method === 'POST' && url.pathname === '/api/v1/addon-imports') {
      const input = await body(request);
      if (input?.guildDiscordId !== REVIEW_GUILD || canonical(input.export) !== canonical(fixture)) return json(422, { error: 'Only the supplied synthetic Guilded.lua fixture is accepted. Do not send real guild data.' });
      const result = await storage.transaction(async tx => {
        const fresh = await tx.get('session');
        if (!fresh || fresh.digest !== digest || fresh.generation !== generation || fresh.expiresAt <= now) return 'revoked';
        if (fresh.imported) return 'duplicate';
        await tx.put('session', { ...fresh, imported: true }); return 'accepted';
      });
      if (result === 'revoked') return json(401, { error: 'Review session revoked.' });
      if (result === 'duplicate') return json(409, { importId: 'synthetic-review', status: 'APPLIED' });
      return json(200, { botVersion: '7.5.0', protocolVersion: 2, importId: 'synthetic-review', transactionCount: 0, autoApplied: { epgp: 0, discovered: 1 } });
    }
    return json(403, { error: 'This endpoint is unavailable in the synthetic review environment. Discord sign-in, public scores and PoE2 are not simulated.' });
  } catch { return json(400, { error: 'Invalid or oversized review request.' }); }
}
