import { build } from "esbuild";
import { fileURLToPath } from "node:url";
await build({
  entryPoints: [fileURLToPath(new URL("../companion-app/renderer/web-entry.js", import.meta.url))],
  outfile: fileURLToPath(new URL("../companion-app/renderer/web-bundle.js", import.meta.url)),
  bundle: true, platform: "browser", target: "es2022", format: "iife", minify: true, legalComments: "eof"
});
console.log("Browser companion built.");
