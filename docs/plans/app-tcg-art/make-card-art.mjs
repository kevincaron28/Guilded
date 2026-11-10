// Builds the app-sized painted card art (owner approved the "E22" and Rare batches on 9 November 2026) from the original PNGs.
// Usage: node docs/plans/app-tcg-art/make-card-art.mjs <folder with files named <card id>-<slug>.png>
// Writes mobile/assets/clash/cards/<id>.webp (full 640x480) and <id>-window.webp (card art window, 624x240),
// plus docs/plans/app-tcg-art/cards/<id>.webp previews (640x480). Needs `sharp` (set REPO_NODE_MODULES to a checkout that has it).
// The registry that uses the files is mobile/src/clash/cardArt.ts (Metro needs literal require() paths, so add new ids there too).
import { createRequire } from "node:module";
import { mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const require = createRequire(join(process.env.REPO_NODE_MODULES ?? join(root, "node_modules"), "x.js"));
const sharp = require("sharp");
const src = process.argv[2];
if (!src) { console.error("Usage: node make-card-art.mjs <folder of <id>-<slug>.png>"); process.exit(1); }
const out = join(root, "mobile/assets/clash/cards");
const preview = join(here, "cards");
mkdirSync(out, { recursive: true });
mkdirSync(preview, { recursive: true });

// Vertical focus (fraction of the painting height) so the window crop keeps the subject in view; table below; centred by default.
const FOCUS = { "010": 0.2, "021": 0.2, "032": 0.25, "044": 0.2, "055": 0.2, "065": 0.25, "087": 0.25, "098": 0.25, "121": 0.35, "123": 0.3, "125": 0.35 };
// Rare batch (9 November 2026): units sit a little above centre, the zone and Standards are centred.
for (const id of ["008","009","018","020","030","031","043","052","053","063","064","074","075","085","086","096","097","115","116","117","124"]) FOCUS[id] = 0.25;
const DEFAULT_FOCUS = 0.5; // spells, gear and standards: centred
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

for (const name of readdirSync(src).filter((f) => /^\d{3}-.*\.png$/.test(f)).sort()) {
  const id = name.slice(0, 3);
  const file = join(src, name);
  const { width: W, height: H } = await sharp(file).metadata();
  await sharp(file).resize(640, 480).webp({ quality: 74 }).toFile(join(out, `${id}.webp`));
  await sharp(file).resize(640, 480).webp({ quality: 74 }).toFile(join(preview, `${id}.webp`));
  const winH = Math.round(W * 240 / 624);
  const top = clamp(Math.round((FOCUS[id] ?? DEFAULT_FOCUS) * H - winH * 0.5), 0, H - winH);
  await sharp(file).extract({ left: 0, top, width: W, height: winH }).resize(624, 240).webp({ quality: 80 }).toFile(join(out, `${id}-window.webp`));
  console.log(id, name);
}
console.log("Done:", out);
