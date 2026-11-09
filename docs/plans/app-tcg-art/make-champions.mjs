// Builds the app-sized Champion paintings (owner approved 8 November 2026) from the original 1448x1086 PNGs.
// Usage: node docs/plans/app-tcg-art/make-champions.mjs <folder with warrior.png ... druid.png>
// Writes mobile/assets/clash/champions/<class>.webp (full 640x480), <class>-window.webp (card art window, 624x240) and
// <class>-portrait.webp (square Champion portrait, 192x192). Needs `sharp` (set REPO_NODE_MODULES to a checkout that has it).
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const require = createRequire(join(process.env.REPO_NODE_MODULES ?? join(root, "node_modules"), "x.js"));
const sharp = require("sharp");
const src = process.argv[2];
if (!src) { console.error("Usage: node make-champions.mjs <folder with the nine PNGs>"); process.exit(1); }
const out = join(root, "mobile/assets/clash/champions");
mkdirSync(out, { recursive: true });

const W = 1448, H = 1086;
// Where the face sits (fraction of the painting), so the crops keep the Champion's face in view.
const FOCUS = {
  warrior: [0.54, 0.22], mage: [0.40, 0.27], paladin: [0.58, 0.24], hunter: [0.45, 0.28], rogue: [0.42, 0.28],
  priest: [0.45, 0.28], shaman: [0.40, 0.30], warlock: [0.38, 0.25], druid: [0.40, 0.40]
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

for (const [cls, [fx, fy]] of Object.entries(FOCUS)) {
  const file = join(src, `${cls}.png`);
  await sharp(file).resize(640, 480).webp({ quality: 74 }).toFile(join(out, `${cls}.webp`));
  const winH = Math.round(W * 240 / 624);
  const top = clamp(Math.round(fy * H - winH * 0.38), 0, H - winH);
  await sharp(file).extract({ left: 0, top, width: W, height: winH }).resize(624, 240).webp({ quality: 80 }).toFile(join(out, `${cls}-window.webp`));
  const side = 640;
  const left = clamp(Math.round(fx * W - side / 2), 0, W - side);
  const sTop = clamp(Math.round(fy * H - side * 0.4), 0, H - side);
  await sharp(file).extract({ left, top: sTop, width: side, height: side }).resize(192, 192).webp({ quality: 80 }).toFile(join(out, `${cls}-portrait.webp`));
}
console.log("Done:", out);
