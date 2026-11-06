// Draws every active achievement badge (earned on the top half, locked below) into one contact sheet, so a new
// achievement without good art is easy to spot. Run: npx tsx scripts/achievement-badge-sheet.ts
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { ACHIEVEMENTS } from "../src/services/achievements-catalogue.js";
import { badgeSvg } from "../src/services/achievement-badges.js";

const SIZE = 96, GAP = 14, COLS = 13, PAD = 24;
const tiles = [...ACHIEVEMENTS.map(def => ({ def, earned: true })), ...ACHIEVEMENTS.map(def => ({ def, earned: false }))];
const rows = Math.ceil(tiles.length / COLS);
const width = PAD * 2 + COLS * SIZE + (COLS - 1) * GAP, height = PAD * 2 + rows * SIZE + (rows - 1) * GAP;
const composites = await Promise.all(tiles.map(async ({ def, earned }, i) => ({
  input: await sharp(Buffer.from(badgeSvg(def, earned, { size: SIZE }))).png().toBuffer(),
  left: PAD + (i % COLS) * (SIZE + GAP), top: PAD + Math.floor(i / COLS) * (SIZE + GAP)
})));
const out = fileURLToPath(new URL("../marketing/achievements-preview/badge-contact-sheet.png", import.meta.url));
await sharp({ create: { width, height, channels: 4, background: "#10131a" } }).composite(composites).png().toFile(out);
console.log(`${ACHIEVEMENTS.length} achievements, ${tiles.length} badges -> ${out}`);
