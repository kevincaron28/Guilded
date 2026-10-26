// Inspect the actual package; never installs it or changes certificate trust.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
const require = createRequire(new URL("../companion-app/package.json", import.meta.url));
const { extractFile } = require("@electron/asar");
const file = process.argv[2];
if (!file?.endsWith(".msix")) throw new Error("Pass the prepared .msix path.");
const raw = readFileSync(file), names = [];
const contents = unzipSync(raw, { filter: entry => {
  names.push(entry.name);
  return ["AppxManifest.xml", "app/resources/app.asar", "app/resources/LICENSE.Guilded.txt"].includes(entry.name) || entry.name.startsWith("assets/") || entry.name.startsWith("app/resources/engine/");
} });
const manifest = Buffer.from(contents["AppxManifest.xml"] ?? []).toString("utf8");
assert.match(manifest, /EntryPoint="Windows.FullTrustApplication"/);
assert.match(manifest, /Name="runFullTrust"/);
assert.match(manifest, /StartupTask[^>]+Enabled="false"/);
assert.match(manifest, /<Resource Language="en-US"\s*\/>/);
assert.match(manifest, /<Resource Language="fr-FR"\s*\/>/);
assert.ok(names.includes("AppxBlockMap.xml") && names.includes("[Content_Types].xml"));
assert.deepEqual(Buffer.from(contents["app/resources/LICENSE.Guilded.txt"] ?? []), readFileSync("LICENSE"));
const sourcePackage = JSON.parse(readFileSync("companion-app/package.json", "utf8"));
for (const resource of sourcePackage.build.extraResources.filter(row => row.from === "../companion")) {
  for (const path of resource.filter) assert.deepEqual(Buffer.from(contents[`app/resources/${resource.to}/${path}`] ?? []), readFileSync(`companion/${path}`), `Stale engine: ${path}`);
}
for (const path of ["package.json", "luaparse.js"]) assert.deepEqual(Buffer.from(contents[`app/resources/engine/node_modules/luaparse/${path}`] ?? []), readFileSync(`companion-app/node_modules/luaparse/${path}`), `Stale parser: ${path}`);
assert.ok(!names.some(name => /(?:^|\/)(?:\.env(?:\.|$)|config\.json$|credentials|backups\/)/i.test(name)), "Unexpected private configuration in package");
for (const name of ["StoreLogo.png", "Square150x150Logo.png", "Square44x44Logo.png", "Wide310x150Logo.png"]) {
  assert.deepEqual(Buffer.from(contents[`assets/${name}`] ?? []), readFileSync(`companion-app/build/appx/${name}`));
}
const temp = mkdtempSync(join(tmpdir(), "guilded-msix-check-"));
try {
  const asar = join(temp, "app.asar");
  writeFileSync(asar, contents["app/resources/app.asar"]);
  const packaged = JSON.parse(extractFile(asar, "package.json").toString());
  const version = JSON.parse(readFileSync("companion-app/package.json", "utf8")).version;
  assert.equal(packaged.version, version);
  assert.equal(packaged.guildedDistribution, "microsoft-store");
  assert.ok(manifest.includes(`Version="${version}.0"`));
  assert.equal(manifest.includes("Guilded.Companion.LocalPreview"), packaged.guildedStorePreview);
  for (const path of ["main.cjs", "store-config.cjs", "preload.cjs", "renderer/app.js", "renderer/index.html", "locales/fr.json", "grm-import.cjs"])
    assert.deepEqual(extractFile(asar, path), readFileSync(`companion-app/${path}`), `Stale package: ${path}`);
  console.log(JSON.stringify({ file: resolve(file), bytes: raw.length, sha256: createHash("sha256").update(raw).digest("hex"), version, preview: packaged.guildedStorePreview,
    manifestAndSourcesVerified: true, installed: false, storeCertified: false }, null, 2));
} finally {
  assert.equal(dirname(resolve(temp)), resolve(tmpdir()));
  assert.ok(basename(temp).startsWith("guilded-msix-check-"));
  rmSync(temp, { recursive: true, force: true });
}
