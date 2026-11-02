import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { copyFileSync, cpSync } from "node:fs";
// The Windows app's interface: shared design tokens and fonts, plus one bundle of the helpers
// its pages call (companion/*.mjs and the language picker). Electron loads these local files.
copyFileSync("site/design-tokens.css", "companion-app/renderer/design-tokens.css");
cpSync("site/fonts", "companion-app/renderer/fonts", { recursive: true });
await build({
  entryPoints: [fileURLToPath(new URL("../companion-app/renderer/ui-entry.js", import.meta.url))],
  outfile: fileURLToPath(new URL("../companion-app/renderer/ui-bundle.js", import.meta.url)),
  bundle: true, platform: "browser", target: "es2022", format: "iife", minify: true, legalComments: "eof"
});
console.log("Companion interface built.");
