import { build } from "esbuild";
import { fileURLToPath } from "node:url";
// The Windows app's interface: one bundle of the helpers its window calls (companion/*.mjs and the
// language picker). Electron loads this local file.
await build({
  entryPoints: [fileURLToPath(new URL("../companion-app/renderer/ui-entry.js", import.meta.url))],
  outfile: fileURLToPath(new URL("../companion-app/renderer/ui-bundle.js", import.meta.url)),
  bundle: true, platform: "browser", target: "es2022", format: "iife", minify: true, legalComments: "eof"
});
console.log("Companion interface built.");
