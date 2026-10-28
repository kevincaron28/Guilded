// Read-only wire verification: a valid config alone does not prove middleware order.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function verifyOriginAccess(publicAddress, originAddress, version, request = fetch) {
  const publicUrl = new URL(publicAddress), origin = new URL(originAddress);
  if ([publicUrl, origin].some(url => url.protocol !== 'https:' || url.username || url.password) || publicUrl.origin === origin.origin) throw new Error('Provide separate public/origin HTTPS addresses without credentials.');
  const results = [];
  for (const path of ['/health', '/companion/', '/api/v1/standings']) {
    const response = await request(new URL(path, origin), { headers: { 'x-guilded-origin': 'untrusted-verification-probe' }, redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (response.status !== 404) throw new Error(`Origin bypass: ${path} answered ${response.status}, expected 404.`);
    results.push({ route: 'origin' + path, status: response.status });
  }
  const health = await request(new URL('/health', publicUrl), { redirect: 'error', signal: AbortSignal.timeout(15000) });
  const body = await health.json();
  if (!health.ok || body.botVersion !== version || body.commands !== 'ok') throw new Error('Public health/version/commands verification failed.');
  results.push({ route: 'public/health', status: health.status });
  const companion = await request(new URL('/companion/', publicUrl), { redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!companion.ok || !companion.headers.get('content-type')?.startsWith('text/html')) throw new Error('Public companion is unavailable.');
  results.push({ route: 'public/companion/', status: companion.status });
  return { version, verifiedAt: new Date().toISOString(), results };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [publicAddress, originAddress, version] = process.argv.slice(2);
  if (!publicAddress || !originAddress || !version) throw new Error('Usage: node scripts/verify-origin-access.mjs PUBLIC_HTTPS_ORIGIN PRIVATE_HTTPS_ORIGIN VERSION');
  console.log(JSON.stringify(await verifyOriginAccess(publicAddress, originAddress, version), null, 2));
}
