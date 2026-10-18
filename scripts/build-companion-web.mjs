import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
await build({
  entryPoints: [fileURLToPath(new URL("../companion-app/renderer/web-entry.js", import.meta.url))],
  outfile: fileURLToPath(new URL("../companion-app/renderer/web-bundle.js", import.meta.url)),
  bundle: true, platform: "browser", target: "es2022", format: "iife", minify: true, legalComments: "eof",
  define: { __GUILDED_VERSION__: JSON.stringify(version) }
});
console.log("Browser companion built.");
