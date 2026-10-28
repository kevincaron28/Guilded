import { afterEach, expect, it, vi } from 'vitest';
import worker from '../worker/index.mjs';
afterEach(() => vi.unstubAllGlobals());

it('blocks API writes before forwarding a body or credential and returns retry guidance', async () => {
  const upstream = vi.fn(); vi.stubGlobal('fetch', upstream);
  const limit = vi.fn(async () => ({ success: false }));
  const response = await worker.fetch(new Request('https://guilded.kcaron.top/api/v1/addon-imports', {
    method: 'POST', headers: { 'cf-connecting-ip': '192.0.2.1', 'x-forwarded-for': 'spoof', authorization: 'Bearer secret' }, body: '{}'
  }), { API_WRITES: { limit } });
  expect(response.status).toBe(429);
  expect(response.headers.get('retry-after')).toBe('60');
  expect(limit).toHaveBeenCalledWith({ key: '192.0.2.1' });
  expect(upstream).not.toHaveBeenCalled();
});

it('uses a separate pairing budget and fails closed when the limiter errors', async () => {
  const upstream = vi.fn(); vi.stubGlobal('fetch', upstream);
  const limit = vi.fn(async () => { throw new Error('binding unavailable'); });
  const response = await worker.fetch(new Request('https://guilded.kcaron.top/api/v1/companion/sign-in', { method: 'POST', body: '{}' }), { PAIRING_ATTEMPTS: { limit } });
  expect(response.status).toBe(503);
  expect(limit).toHaveBeenCalledWith({ key: 'unknown' });
  expect(upstream).not.toHaveBeenCalled();
});
