// Builds the app-sized Legendary unit paintings (owner approved the "L9-WoW" set on 9 November 2026) from the original PNGs.
// Usage: node docs/plans/app-tcg-art/make-legendaries.mjs <folder with warrior.png ... druid.png>
// Writes mobile/assets/clash/legendary/<card id>.webp (full 640x480) and <card id>-window.webp (card art window, 624x240).
// The nine Legendary class units are set 1 cards 011, 022, 033, 042, 054, 066, 077, 088 and 099 (src/services/tcg-cards-set1.ts).
// Needs `sharp` (set REPO_NODE_MODULES to a checkout that has it).
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const require = createRequire(join(process.env.REPO_NODE_MODULES ?? join(root, "node_modules"), "x.js"));
const sharp = require("sharp");
const src = process.argv[2];
if (!src) { console.error("Usage: node make-legendaries.mjs <folder with the nine PNGs>"); process.exit(1); }
const out = join(root, "mobile/assets/clash/legendary");
mkdirSync(out, { recursive: true });

// class -> [card id, vertical focus (fraction of the painting height) so the window crop keeps the subject's head in view]
const SET = {
  warrior: ["011", 0.30], paladin: ["022", 0.18], hunter: ["033", 0.22], rogue: ["042", 0.30], priest: ["054", 0.20],
  shaman: ["066", 0.40], mage: ["077", 0.27], warlock: ["088", 0.15], druid: ["099", 0.20]
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

for (const [cls, [id, fy]] of Object.entries(SET)) {
  const file = join(src, `${cls}.png`);
  const { width: W, height: H } = await sharp(file).metadata();
  await sharp(file).resize(640, 480).webp({ quality: 74 }).toFile(join(out, `${id}.webp`));
  const winH = Math.round(W * 240 / 624);
  const top = clamp(Math.round(fy * H - winH * 0.38), 0, H - winH);
  await sharp(file).extract({ left: 0, top, width: W, height: winH }).resize(624, 240).webp({ quality: 80 }).toFile(join(out, `${id}-window.webp`));
}
console.log("Done:", out);
