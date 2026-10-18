import {afterAll,beforeAll,test} from 'vitest';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

// Exercise the actual Worker module with the workerd version pinned by Wrangler.
// All certificates, keys and assertions are fixtures; no external fetch is sent.
const wranglerRequire=createRequire(new URL('../node_modules/wrangler/package.json',import.meta.url));
const {Miniflare}=wranglerRequire('miniflare');
const source=readFileSync(new URL('../worker/private-resources.mjs',import.meta.url),'utf8');
const config=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
const script=`
import {createOwnerResources} from './private-resources.mjs';
export default {async fetch(request){
  const instant=1900000000;
  const issuer='https://runtime-fixture.cloudflareaccess.com';
  const audience='a'.repeat(64);
  const keyPair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
  const publicKey={...await crypto.subtle.exportKey('jwk',keyPair.publicKey),kid:'runtime-fixture',alg:'RS256',use:'sig'};
  const encode=text=>btoa(typeof text==='string'?text:JSON.stringify(text)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  const signed=encode({alg:'RS256',kid:'runtime-fixture'})+'.'+encode({iss:issuer,aud:[audience],email:'owner@example.test',iat:instant,exp:instant+3600});
  const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keyPair.privateKey,new TextEncoder().encode(signed));
  const jwt=signed+'.'+encode(String.fromCharCode(...new Uint8Array(signature)));
  const status=Number(new URL(request.url).searchParams.get('status')||200);
  const modes=[];const failures=[];let reads=0;let pinnedEndpoint=true;
  const handler=createOwnerResources({resources:[],now:()=>instant*1000,reportFailure:category=>failures.push(category),fetchCertificates:async(url,options)=>{
    // Native Request construction reproduces fetch(url,init) option validation
    // while returning fixture certificates instead of making a network request.
    const nativeRequest=new Request(url,options);
    modes.push(nativeRequest.redirect);
    pinnedEndpoint&&=url===issuer+'/cdn-cgi/access/certs';
    return status===200?Response.json({keys:[publicKey]}):new Response(null,{status,headers:{location:'https://untrusted.invalid/certs'}});
  }});
  const env={OWNER_ACCESS_ISSUER:issuer,OWNER_ACCESS_AUD:audience,OWNER_EMAIL:'owner@example.test',OWNER_RESOURCES:{get:async()=>{reads++;return null;}}};
  const response=await handler(new Request('https://kcaron.top/owner',{headers:{'cf-access-jwt-assertion':jwt}}),env);
  return Response.json({status:response.status,modes,failures,reads,pinnedEndpoint});
}};
`;
let runtime;
beforeAll(async()=>{
  runtime=new Miniflare({cf:false,logRequests:false,workers:[{config:{
    name:'owner-runtime-regression',compatibilityDate:config.compatibility_date,
    manifest:{mainModule:'runtime-fixture.mjs',modulesRoot:fileURLToPath(new URL('..',import.meta.url)),modules:{
      'runtime-fixture.mjs':{type:'esm',contents:script},
      'private-resources.mjs':{type:'esm',contents:source}
    }}
  }}]});
  await runtime.ready;
},30_000);
afterAll(async()=>{await runtime?.dispose();},30_000);

test('workerd accepts the actual signing-key request options and verifies a fixture owner assertion',async()=>{
  const response=await runtime.dispatchFetch('https://fixture.invalid/');
  const result=await response.json();
  assert.equal(result.status,200);
  assert.deepEqual(result.modes,['manual']);
  assert.deepEqual(result.failures,[]);
  assert.equal(result.reads,0);assert.equal(result.pinnedEndpoint,true);
},10_000);

test.each([301,302,307,308])('workerd keeps a signing-key HTTP %i redirect fail-closed',async status=>{
  const response=await runtime.dispatchFetch('https://fixture.invalid/?status='+status);
  const result=await response.json();
  assert.equal(result.status,503);
  assert.deepEqual(result.modes,['manual']);
  assert.deepEqual(result.failures,['owner-resources:SIGNING_KEYS_UNAVAILABLE']);
  assert.equal(result.reads,0);assert.equal(result.pinnedEndpoint,true);
},10_000);
