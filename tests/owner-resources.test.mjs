/* global crypto, Response, Request */
import { test, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import worker from '../worker/index.mjs';
import { createOwnerResources } from '../worker/private-resources.mjs';
const keyPair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const publicKey = { ...await crypto.subtle.exportKey('jwk', keyPair.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
const issuer = 'https://example-team.cloudflareaccess.com';
const audience = 'a'.repeat(64);
const time = 1792236000;
const resources = [{ filename: 'approved-logo.png', key: 'approved/logo-v2', type: 'image/png', title: 'Approved logo', description: 'Owner master copy' }];
afterEach(() => vi.unstubAllGlobals());
const baseClaims = { iss: issuer, aud: [audience], email: 'owner@example.com', exp: time + 3600, iat: time };
const encode = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
async function token(claims = {}, header = {}) {
  const signed = encode({ alg: 'RS256', kid: 'test-key', ...header }) + '.' + encode({ ...baseClaims, ...claims });
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, new TextEncoder().encode(signed));
  return signed + '.' + Buffer.from(signature).toString('base64url');
}
function fixture(options = {}) {
  const reads = [];
  const certificates = [];
  const handler = createOwnerResources({ resources, now: () => time * 1000, fetchCertificates: async (url, init) => { certificates.push({url,init}); return Response.json({keys:[publicKey]}); }, ...options });
  const env = { OWNER_ACCESS_ISSUER: issuer, OWNER_ACCESS_AUD: audience, OWNER_EMAIL: 'owner@example.com', OWNER_RESOURCES: { get: async key => { reads.push(key); return new Uint8Array([1,2,3]).buffer; } } };
  const request = (path = '/owner/', jwt, method = 'GET', host = 'kcaron.top') => new Request(`https://${host}${path}`, { method, headers: jwt ? { 'cf-access-jwt-assertion': jwt } : {} });
  return {handler,env,reads,certificates,request};
}
test('unrelated public and companion routes are untouched', async () => { const f=fixture(); for(const path of ['/','/companion/','/api/v1/manage','/g/quebec-gold/']) assert.equal(await f.handler(f.request(path),f.env),null); });
test('missing authentication blocks index and direct downloads on every host', async () => {
  const f=fixture();
  for(const host of ['kcaron.top','www.kcaron.top','guilded.kcaron.top','guilded-wow.kcaron.workers.dev']) {
    for(const path of ['/owner','/owner/','/owner/downloads/approved-logo.png']) {
      for(const method of ['GET','HEAD']) {
        const response=await f.handler(f.request(path,undefined,method,host),f.env);
        assert.equal(response.status,host==='kcaron.top'?401:404);
        assert.match(response.headers.get('cache-control'),/no-store/);
        if(method==='HEAD')assert.equal((await response.arrayBuffer()).byteLength,0);
      }
    }
  }
  assert.equal(f.reads.length,0);
  assert.equal(f.certificates.length,0);
});
test('missing configuration or KV binding fails closed', async () => { const f=fixture(); for(const key of ['OWNER_ACCESS_ISSUER','OWNER_ACCESS_AUD','OWNER_EMAIL','OWNER_RESOURCES']) {const env={...f.env};delete env[key];assert.equal((await f.handler(f.request(),env)).status,503);}assert.equal(f.reads.length,0); });
test('only a trusted Cloudflare Access issuer can supply certificate keys', async () => { const f=fixture(); const env={...f.env,OWNER_ACCESS_ISSUER:'https://attacker.example'};assert.equal((await f.handler(f.request('/owner/',await token()),env)).status,503);assert.equal(f.certificates.length,0); });
test('valid signed owner token renders escaped resource metadata', async () => { const f=fixture(); const response=await f.handler(f.request('/owner/',await token()),f.env);assert.equal(response.status,200);assert.match(await response.text(),/approved-logo.png/);assert.equal(response.headers.get('cache-control'),'private, no-store, max-age=0');assert.equal(f.reads.length,0);assert.equal(f.certificates[0].url,issuer+'/cdn-cgi/access/certs');assert.equal(f.certificates[0].init.redirect,'error'); });
test('authenticated direct download reads only the curated object key', async () => { const f=fixture();const response=await f.handler(f.request('/owner/downloads/approved-logo.png',await token()),f.env);assert.equal(response.status,200);assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[1,2,3]);assert.deepEqual(f.reads,['approved/logo-v2']);assert.equal(response.headers.get('content-type'),'image/png');assert.match(response.headers.get('content-disposition'),/^attachment;/); });
test('HEAD authenticates and returns no private response body', async () => { const f=fixture();const jwt=await token();for(const path of ['/owner/','/owner/downloads/approved-logo.png']){const response=await f.handler(f.request(path,jwt,'HEAD'),f.env);assert.equal(response.status,200);assert.equal((await response.arrayBuffer()).byteLength,0);} });
test('wrong email, audience, issuer and expired or future claims are denied', async () => { const f=fixture();for(const claims of [{email:'someone@example.com'},{aud:['b'.repeat(64)]},{iss:'https://other.cloudflareaccess.com'},{exp:time},{exp:'later'},{nbf:time+1},{iat:time+100}]) assert.equal((await f.handler(f.request('/owner/',await token(claims)),f.env)).status,401);assert.equal(f.reads.length,0); });
test('malformed, unsigned and unknown-key tokens are denied', async () => { const f=fixture();for(const jwt of ['bad','a.b.c','x'.repeat(8193),await token({}, {alg:'none'}),await token({}, {kid:'missing'})]) assert.equal((await f.handler(f.request('/owner/',jwt),f.env)).status,401); });
test('tampered payload and signature cannot authorize a download', async () => {const f=fixture();const jwt=await token();const parts=jwt.split('.');parts[1]=encode({...baseClaims,exp:time+7200});for(const broken of [parts.join('.'),jwt.slice(0,-4)+'aaaa'])assert.equal((await f.handler(f.request('/owner/downloads/approved-logo.png',broken),f.env)).status,401);assert.equal(f.reads.length,0);});
test('certificate retrieval failure never falls through to assets or KV', async () => {const f=fixture({fetchCertificates:async()=>{throw Error('offline');}});assert.equal((await f.handler(f.request('/owner/',await token()),f.env)).status,503);assert.equal(f.reads.length,0);});
test('unlisted names and encoded paths do not become arbitrary KV keys', async () => {const f=fixture();for(const path of ['/owner/downloads/private.zip','/owner/downloads/%2Fapproved-logo.png','/owner/downloads/approved-logo.png/more'])assert.equal((await f.handler(f.request(path,await token()),f.env)).status,404);assert.equal(f.reads.length,0);});
test('no write method is exposed', async()=>{const f=fixture();for(const method of ['POST','PUT','DELETE'])assert.equal((await f.handler(f.request('/owner/',undefined,method),f.env)).status,405);assert.equal(f.reads.length,0);});
test('missing object and storage failures return controlled responses', async()=>{const f=fixture();const jwt=await token();f.env.OWNER_RESOURCES.get=async()=>null;assert.equal((await f.handler(f.request('/owner/downloads/approved-logo.png',jwt),f.env)).status,404);f.env.OWNER_RESOURCES.get=async()=>{throw Error('storage');};assert.equal((await f.handler(f.request('/owner/downloads/approved-logo.png',jwt),f.env)).status,503);});
test('unknown signing keys cannot force repeated certificate fetches', async()=>{const f=fixture();assert.equal((await f.handler(f.request('/owner/',await token()),f.env)).status,200);for(let i=0;i<5;i++)assert.equal((await f.handler(f.request('/owner/',await token({},{kid:'unknown-'+i})),f.env)).status,401);assert.equal(f.certificates.length,1);});
test('Worker integration denies direct private files before any static or KV read',async()=>{
  const f=fixture();const liveTime=Math.floor(Date.now()/1000);const liveClaims={iat:liveTime,exp:liveTime+3600};
  const assets=vi.fn(async()=>new Response('must never reach assets'));
  vi.stubGlobal('fetch',async()=>Response.json({keys:[publicKey]}));
  const env={...f.env,ASSETS:{fetch:assets}};
  for(const host of ['kcaron.top','www.kcaron.top','guilded.kcaron.top','guilded-wow.kcaron.workers.dev']) {
    const status=host==='kcaron.top'?401:404;
    assert.equal((await worker.fetch(f.request('/owner/downloads/approved-brand-kit-v2.zip',undefined,'GET',host),env)).status,status);
    assert.equal((await worker.fetch(f.request('/owner/downloads/approved-brand-kit-v2.zip',await token({...liveClaims,email:'wrong@example.com'}),'GET',host),env)).status,status);
    if(host!=='kcaron.top')assert.equal((await worker.fetch(f.request('/owner/downloads/approved-brand-kit-v2.zip',await token(liveClaims),'GET',host),env)).status,404);
  }
  assert.equal(assets.mock.calls.length,0);assert.equal(f.reads.length,0);
  const response=await worker.fetch(f.request('/owner/downloads/approved-brand-kit-v2.zip',await token(liveClaims)),env);
  assert.equal(response.status,200);assert.deepEqual(f.reads,['brand/approved-v2/kit.zip']);
});
test('private routes run before Cloudflare static assets and account vars survive deploys',()=>{const config=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));assert.ok(config.assets.run_worker_first.includes('/owner'));assert.ok(config.assets.run_worker_first.includes('/owner/*'));assert.equal(config.keep_vars,true);});
test('untrusted active content is excluded from the curated resource manifest',()=>{assert.throws(()=>createOwnerResources({resources:[{filename:'page.html',key:'private/html',type:'text/html',title:'bad'}]}),/Invalid curated/);});

test('even a signed owner token cannot serve private bytes on alternate origins',async()=>{
  const f=fixture();const jwt=await token();
  for(const origin of ['https://www.kcaron.top','https://guilded.kcaron.top','https://guilded-wow.kcaron.workers.dev','http://kcaron.top','https://kcaron.top:8443']) {
    for(const path of ['/owner/','/owner/downloads/approved-logo.png']) {
      const response=await f.handler(new Request(origin+path,{headers:{'cf-access-jwt-assertion':jwt}}),f.env);
      assert.equal(response.status,404);
    }
  }
  assert.equal(f.reads.length,0);assert.equal(f.certificates.length,0);
});

test('wrong-owner direct GET and HEAD never read storage',async()=>{
  const f=fixture();const jwt=await token({email:'someone@example.com'});
  for(const method of ['GET','HEAD'])assert.equal((await f.handler(f.request('/owner/downloads/approved-logo.png',jwt,method),f.env)).status,401);
  assert.equal(f.reads.length,0);assert.equal(f.certificates.length,0);
});

test('cookies and unsigned identity headers cannot replace a signed application token',async()=>{
  const f=fixture();
  const request=new Request('https://kcaron.top/owner/downloads/approved-logo.png',{headers:{cookie:'CF_Authorization=not-a-signed-token','cf-access-authenticated-user-email':'owner@example.com'}});
  assert.equal((await f.handler(request,f.env)).status,401);
  assert.equal(f.reads.length,0);assert.equal(f.certificates.length,0);
});

test('unsupported critical JWS extensions and algorithm confusion are rejected',async()=>{
  const f=fixture();
  for(const header of [{alg:'HS256'},{crit:['unrecognized']},{b64:false},{kid:''}])assert.equal((await f.handler(f.request('/owner/',await token({},header)),f.env)).status,401);
  assert.equal(f.certificates.length,0);
});

test('concurrent authorizations share one certificate request',async()=>{
  let calls=0;let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const f=fixture({fetchCertificates:async()=>{calls++;await gate;return Response.json({keys:[publicKey]});}});
  const jwt=await token();
  const responses=Promise.all(Array.from({length:8},()=>f.handler(f.request('/owner/',jwt),f.env)));
  await vi.waitFor(()=>assert.equal(calls,1));release();
  assert.ok((await responses).every(response=>response.status===200));
  assert.equal(calls,1);assert.equal(f.reads.length,0);
});

test('a failed shared certificate request is cleared for a later retry',async()=>{
  let calls=0;
  const f=fixture({fetchCertificates:async()=>{if(++calls===1)throw Error('temporary failure');return Response.json({keys:[publicKey]});}});
  const jwt=await token();
  assert.equal((await f.handler(f.request('/owner/',jwt),f.env)).status,503);
  assert.equal((await f.handler(f.request('/owner/',jwt),f.env)).status,200);
  assert.equal(calls,2);
});

test('expired certificate cache is refreshed and never used when refresh fails',async()=>{
  let instant=time*1000;let fail=false;let calls=0;
  const f=fixture({now:()=>instant,fetchCertificates:async()=>{calls++;if(fail)throw Error('offline');return Response.json({keys:[publicKey]});}});
  const jwt=await token();
  assert.equal((await f.handler(f.request('/owner/',jwt),f.env)).status,200);
  instant+=300_001;fail=true;
  assert.equal((await f.handler(f.request('/owner/',jwt),f.env)).status,503);
  assert.equal(calls,2);assert.equal(f.reads.length,0);
});

test('empty, malformed, excessive and unusable certificate sets fail closed',async()=>{
  for(const keys of [null,[],Array(33).fill(publicKey),[{kid:'test-key',kty:'EC'}]]) {
    const f=fixture({fetchCertificates:async()=>Response.json({keys})});
    assert.equal((await f.handler(f.request('/owner/',await token()),f.env)).status,503);
    assert.equal(f.reads.length,0);
  }
});

test('authenticated resource metadata is escaped and responses forbid caching',async()=>{
  const f=fixture({resources:[{...resources[0],title:'<script>bad</script>',description:'A & B "quoted"'}]});
  const response=await f.handler(f.request('/owner/',await token()),f.env);
  const text=await response.text();
  assert.match(text,/&lt;script&gt;bad&lt;\/script&gt;/);assert.doesNotMatch(text,/<script>/);
  assert.match(text,/A &amp; B &quot;quoted&quot;/);
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  assert.match(response.headers.get('x-robots-tag'),/noindex/);
  assert.match(response.headers.get('content-security-policy'),/default-src 'none'/);
});
