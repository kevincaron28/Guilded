/* global crypto, atob, TextDecoder */
// Owner files are served only after signed Cloudflare Access authorization.
// Private bytes belong in a KV namespace, never in the static assets directory.
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const allowedTypes = new Set(['application/zip', 'application/pdf', 'application/json', 'image/png', 'image/webp', 'text/plain; charset=utf-8', 'text/markdown; charset=utf-8']);
const html = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const decode = value => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid encoding');
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
};
const responseHeaders = {
  'cache-control': 'private, no-store, max-age=0',
  'x-content-type-options': 'nosniff',
  'x-robots-tag': 'noindex, nofollow, noarchive',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
};

export function createOwnerResources({ resources, fetchCertificates = (url, options) => fetch(url, options), now = () => Date.now(), reportFailure = category => console.error(category) } = {}) {
  const index = new Map();
  for (const item of resources ?? []) {
    if (!/^[a-z0-9][a-z0-9._-]{0,100}$/.test(item.filename) || !allowedTypes.has(item.type) || typeof item.key !== 'string' || !item.key || index.has(item.filename)) throw new Error('Invalid curated resource manifest');
    index.set(item.filename, Object.freeze({ ...item }));
  }
  const certificates = new Map();
  const pendingCertificates = new Map();
  const lastFailureReport = new Map();
  const reply = (request, status, text, extra = {}) => new Response(request.method === 'HEAD' ? null : text, { status, headers: { ...responseHeaders, 'content-type': 'text/plain; charset=utf-8', ...extra } });

  // Report only fixed categories, at most once per category/minute per instance.
  // Never pass request data, configuration values or caught errors to the logger.
  const unavailable = category => {
    try {
      const instant = now();
      const previous = lastFailureReport.get(category);
      if (previous === undefined || instant - previous >= 60_000) {
        lastFailureReport.set(category, instant);
        reportFailure('owner-resources:' + category);
      }
    } catch { /* Logging must never change the fail-closed response. */ }
    return 503;
  };

  async function signingKeys(issuer) {
    const cached = certificates.get(issuer);
    if (cached && cached.until > now()) return cached;
    let pending = pendingCertificates.get(issuer);
    if (!pending) {
      pending = (async () => {
        const result = await fetchCertificates(issuer + '/cdn-cgi/access/certs', { redirect: 'error', signal: AbortSignal.timeout(5000) });
        if (!result.ok) throw new Error('Signing keys unavailable');
        const document = await result.json();
        if (!Array.isArray(document?.keys) || document.keys.length > 32) throw new Error('Invalid signing keys');
        const publicKeys = document.keys.filter(key => key && typeof key === 'object' && typeof key.kid === 'string' && key.kid.length <= 256 && key.kty === 'RSA');
        if (!publicKeys.length) throw new Error('No signing keys');
        const keys = { until: now() + 300_000, keys: publicKeys };
        certificates.set(issuer, keys);
        return keys;
      })();
      pendingCertificates.set(issuer, pending);
    }
    try { return await pending; }
    finally { if (pendingCertificates.get(issuer) === pending) pendingCertificates.delete(issuer); }
  }

  async function authenticate(request, env) {
    const issuer = env.OWNER_ACCESS_ISSUER;
    const audience = env.OWNER_ACCESS_AUD;
    const email = env.OWNER_EMAIL?.trim().toLowerCase();
    if (!/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(issuer ?? '')) return unavailable('CONFIG_ISSUER_INVALID');
    if (!/^[A-Za-z0-9_-]{20,128}$/.test(audience ?? '')) return unavailable('CONFIG_AUDIENCE_INVALID');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email ?? '')) return unavailable('CONFIG_IDENTITY_INVALID');
    if (!env.OWNER_RESOURCES?.get) return unavailable('CONFIG_STORAGE_INVALID');
    const jwt = request.headers.get('cf-access-jwt-assertion');
    if (!jwt || jwt.length > 8192) return 401;
    let header, claims, signature, signed;
    try {
      const segments = jwt.split('.');
      if (segments.length !== 3) return 401;
      header = JSON.parse(decoder.decode(decode(segments[0])));
      claims = JSON.parse(decoder.decode(decode(segments[1])));
      if (!claims || typeof claims !== 'object' || Array.isArray(claims)) return 401;
      signature = decode(segments[2]);
      signed = encoder.encode(segments[0] + '.' + segments[1]);
      if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid || header.kid.length > 256 || header.crit !== undefined || (header.b64 !== undefined && header.b64 !== true)) return 401;
    } catch { return 401; }
    const seconds = Math.floor(now() / 1000);
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== issuer || !audiences.includes(audience) || typeof claims.email !== 'string' || claims.email.toLowerCase() !== email || !Number.isFinite(claims.exp) || claims.exp <= seconds || (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > seconds)) || (claims.iat !== undefined && (!Number.isFinite(claims.iat) || claims.iat > seconds + 60))) return 401;
    let keys;
    try { keys = await signingKeys(issuer); } catch { return unavailable('SIGNING_KEYS_UNAVAILABLE'); }
    const jwk = keys.keys.find(key => key.kid === header.kid && key.kty === 'RSA' && (!key.alg || key.alg === 'RS256') && (!key.use || key.use === 'sig'));
    if (!jwk) return 401;
    try {
      const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
      return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signed) ? 200 : 401;
    } catch { return 401; }
  }

  return async function ownerResources(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/owner' && !url.pathname.startsWith('/owner/')) return null;
    // Only the canonical owner application may serve private resources.
    // Alternate hosts fail closed even if a valid owner token is replayed.
    if (url.origin !== 'https://kcaron.top') return reply(request, 404, 'Resource not found.');
    if (!['GET', 'HEAD'].includes(request.method)) return reply(request, 405, 'Method not allowed.', { allow: 'GET, HEAD' });
    const authorized = await authenticate(request, env);
    if (authorized !== 200) return reply(request, authorized, authorized === 503 ? 'Owner resources are not configured or are temporarily unavailable.' : 'Sign in through the owner Access application.');
    if (['/owner', '/owner/'].includes(url.pathname)) {
      const content = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>Owner resources — K Caron Projects</title><style>body{max-width:760px;margin:64px auto;padding:0 24px;background:#111416;color:#eeeae2;font:16px/1.7 system-ui}a{color:#d9b66f}a:focus-visible{outline:3px solid #d9b66f;outline-offset:4px}li{padding:12px 0}small{display:block;color:#aab2b9}</style></head><body><main><p>K CARON PROJECTS</p><h1>Owner resources</h1><p>Private brand and setup files for the signed-in owner.</p><ul>${[...index.values()].map(item => `<li><a href="/owner/downloads/${item.filename}">${html(item.title)}</a><small>${html(item.description ?? '')}</small></li>`).join('')}</ul><p><a href="/">Back to the public website</a></p></main></body></html>`;
      return reply(request, 200, content, { 'content-type': 'text/html; charset=utf-8' });
    }
    const match = url.pathname.match(/^\/owner\/downloads\/([a-z0-9][a-z0-9._-]{0,100})$/);
    const item = match && index.get(match[1]);
    if (!item) return reply(request, 404, 'Resource not found.');
    try {
      const bytes = await env.OWNER_RESOURCES.get(item.key, { type: 'arrayBuffer' });
      if (bytes === null) return reply(request, 404, 'Resource not found.');
      return new Response(request.method === 'HEAD' ? null : bytes, { headers: { ...responseHeaders, 'content-type': item.type, 'content-disposition': `attachment; filename="${item.filename}"`, 'content-length': String(bytes.byteLength) } });
    } catch { return reply(request, 503, 'Resource temporarily unavailable.'); }
  };
}
