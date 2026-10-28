import { expect, it } from 'vitest';
import { verifyOriginAccess } from '../scripts/verify-origin-access.mjs';

const request = (direct = 404, publicStatus = 200) => async (input: RequestInfo | URL) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  return url.hostname === 'origin.test'
  ? new Response('Not found', { status: direct }) : url.pathname === '/health'
    ? Response.json({ botVersion: '8.0.0', commands: 'ok' }, { status: publicStatus })
    : new Response('<html>Companion</html>', { status: publicStatus, headers: { 'content-type': 'text/html' } });
};
it('requires all private routes to reject a caller header while public routes remain usable', async () => {
  const report = await verifyOriginAccess('https://public.test', 'https://origin.test', '8.0.0', request());
  expect(report.results).toHaveLength(5);
  await expect(verifyOriginAccess('https://public.test', 'https://origin.test', '8.0.0', request(200))).rejects.toThrow('Origin bypass');
  await expect(verifyOriginAccess('https://public.test', 'https://origin.test', '8.0.0', request(404, 404))).rejects.toThrow('Public health');
});
it('does not contact an insecure, credential-bearing or identical destination', async () => {
  for (const origin of ['http://origin.test', 'https://user:secret@origin.test', 'https://public.test']) {
    await expect(verifyOriginAccess('https://public.test', origin, '8.0.0', request())).rejects.toThrow('separate');
  }
});
