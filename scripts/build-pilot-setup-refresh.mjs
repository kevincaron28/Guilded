// Refresh only the install guide in the verified public 6.0.0 addon.
// Main contains private 6.1 game code; do not bundle it into this public refresh.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {TextDecoder} from 'node:util';
import {zipSync,unzipSync} from 'fflate';
const source=process.argv[2];
if(!source) throw new Error('Pass the original published Guilded-v6.0.0.zip path.');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const original=readFileSync(source);
const expected='3f1672649adb8f75619983725b81f125e28658b4fda6b9315be94b6beea4d33b';
if(hash(original)!==expected) throw new Error('Original archive does not match the published 6.0.0 SHA-256.');
const files=unzipSync(original), install='Guilded/INSTALL.md';
if(!files[install]) throw new Error('Published install guide missing.');
files[install]=new TextEncoder().encode(readFileSync('docs/MEMBER_INSTALL.md','utf8')
  .replace(/\]\((?!https?:|#)([^)]+)\)/g,'](https://github.com/kevincaron28/Guilded/blob/main/docs/$1)'));
const zip=zipSync(files,{level:9}), refreshed=unzipSync(zip), old=unzipSync(original);
if(JSON.stringify(Object.keys(old).sort())!==JSON.stringify(Object.keys(refreshed).sort())) throw new Error('Archive entries changed.');
for(const path of Object.keys(old)) if(path!==install && hash(old[path])!==hash(refreshed[path])) throw new Error(`Unexpected code change: ${path}`);
if(new TextDecoder().decode(refreshed['Guilded/Guilded.toc']).includes('OfficerBridge.lua')) throw new Error('Private bridge unexpectedly included.');
mkdirSync('dist',{recursive:true});
const name='Guilded-v6.0.0-hosted-pilot.zip';
writeFileSync(`dist/${name}`,zip);
writeFileSync('dist/Guilded-v6.0.0-hosted-pilot-SHA256SUMS.txt',`${hash(zip)}  ${name}\n`);
writeFileSync('dist/Guilded-v6.0.0-hosted-pilot-verification.json',JSON.stringify({originalSha256:expected,refreshedSha256:hash(zip),gameSource:'9fd70626b1800eaf26fb0f363144f81753c91d21',changedEntries:[install],unchangedEntries:Object.keys(old).length-1},null,2)+'\n');
console.log(`Verified ${name}: INSTALL.md updated; ${Object.keys(old).length-1} other files byte-identical.`);
