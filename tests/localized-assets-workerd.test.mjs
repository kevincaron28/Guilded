import { beforeAll, afterAll, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
const require = createRequire(new URL('../node_modules/wrangler/package.json', import.meta.url));
const { Miniflare } = require('miniflare');
const fixture = `<html lang="en"><head><link rel="canonical" href="https://guilded.kcaron.top/features/">
<meta name="description" content="English" data-content-en="English" data-content-fr="Français &amp; amis">
<meta property="og:url" content="https://guilded.kcaron.top/features/"></head><body>
<h1 data-en="Hello" data-fr="Bonjour &amp; amis">Hello</h1>
<div data-language-copy="en">English body</div><div data-language-copy="fr" hidden>Contenu français</div>
<a href="/features/?period=week&amp;bracket=60">Link</a></body></html>`;
let runtime;
beforeAll(async () => {
  const contents = buildSync({entryPoints:['worker/localized-assets.mjs'],bundle:true,write:false,format:'esm',platform:'browser'}).outputFiles[0].text;
  runtime = new Miniflare({ cf:false, logRequests:false, workers:[{config:{name:'language-runtime',compatibilityDate:'2026-10-05',manifest:{mainModule:'fixture.mjs',modulesRoot:fileURLToPath(new URL('..',import.meta.url)),modules:{
    'fixture.mjs':{type:'esm',contents:`import {localizedAsset} from './localized.mjs';
      export default {fetch(request){return localizedAsset(request,{ASSETS:{fetch:async()=>new Response(${JSON.stringify(fixture)},{headers:{'content-type':'text/html','etag':'old','content-security-policy':"default-src 'self'"}})}})}};`},
    'localized.mjs':{type:'esm',contents}
  }}}}]}); await runtime.ready;
},30000);
afterAll(async()=>{await runtime?.dispose();},30000);
it('renders French content, metadata, visibility, multi-query links and canonical without JavaScript',async()=>{
  const response=await runtime.dispatchFetch('https://fixture.invalid/features/?lang=fr');
  const html=await response.text();
  expect(response.headers.get('content-language')).toBe('fr');
  expect(response.headers.get('etag')).toBeNull();
  expect(response.headers.get('content-security-policy')).toBe("default-src 'self'");
  expect(html).toContain('<html lang="fr">');
  expect(html).toContain('>Bonjour &amp; amis</h1>');
  expect(html).toContain('content="Français & amis"');
  expect(html).toContain('data-language-copy="en" hidden');
  expect(html).toContain('data-language-copy="fr">');
  expect(html).toContain('href="https://guilded.kcaron.top/features/?lang=fr"');
  expect(html).toContain('content="https://guilded.kcaron.top/features/?lang=fr"');
  expect(html).toContain('href="/features/?period=week&bracket=60&lang=fr"');
  expect(html).not.toContain('&amp;amp;');
});
it('renders English and leaves unselected-language responses untouched',async()=>{
  const english=await runtime.dispatchFetch('https://fixture.invalid/features/?lang=en');
  expect(english.headers.get('content-language')).toBe('en');
  expect(await english.text()).toContain('>Hello</h1>');
  const original=await runtime.dispatchFetch('https://fixture.invalid/features/');
  expect(original.headers.get('etag')).toBe('old');
  expect(await original.text()).toBe(fixture);
});
