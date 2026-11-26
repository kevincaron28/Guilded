// Every Guilded logo file, cut from the two painted sources:
//   docs/branding/guilded-logo.png          1254 x 1254, crown + G + frame, lettering spelled G-U-I-L-D-E-D
//   docs/branding/guilded-logo-emblem.png   1254 x 1254, the same without the lettering (for small icons)
// The Windows tiles and the companion's own icon are the emblem cut from that painting, on the navy backdrop or
// transparent (scripts/emblem-art.mjs), so they stay readable at 16 to 310 px.
// (Before 15 November 2026 the lettering read "GILDED"; the new painting was generated from it with the spelling fixed.)
//
//   node scripts/build-logo-set.mjs          writes the files
//   node scripts/build-logo-set.mjs --check  fails if a written file differs from what the script produces
//
// The phone app's icons come from scripts/build-app-icon.mjs, which uses the same cut-out emblem.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { cutout, tile } from "./emblem-art.mjs";

const at = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const WORD = at("docs/branding/guilded-logo.png");
const EMBLEM = at("docs/branding/guilded-logo-emblem.png");

const square = (source, size, options = {}) => sharp(source).resize(size, size).png({ compressionLevel: 9, ...options }).toBuffer();
/** The addon's texture: 256 x 256, 32-bit uncompressed TGA, top-left origin (same header as before). */
async function tga(source, size) {
  const { data } = await sharp(source).resize(size, size).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const header = Buffer.alloc(18);
  header[2] = 2; header.writeUInt16LE(size, 12); header.writeUInt16LE(size, 14); header[16] = 32; header[17] = 0x28;
  const bgra = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 4) { bgra[i] = data[i + 2]; bgra[i + 1] = data[i + 1]; bgra[i + 2] = data[i]; bgra[i + 3] = data[i + 3]; }
  return Buffer.concat([header, bgra]);
}

/** Microsoft Store tiles at 100 % and 200 %, and the taskbar icon without a plate behind it. */
async function appxTiles() {
  const files = {};
  for (const [name, width, height, radius] of [["StoreLogo", 50, 50, 24], ["Square44x44Logo", 44, 44, 21], ["Square150x150Logo", 150, 150, 64], ["Wide310x150Logo", 310, 150, 66]]) {
    files[`companion-app/build/appx/${name}.png`] = await tile(width, height, radius);
    files[`companion-app/build/appx/${name}.scale-200.png`] = await tile(width * 2, height * 2, radius * 2);
  }
  for (const size of [16, 24, 32, 48, 256]) {
    files[`companion-app/build/appx/Square44x44Logo.targetsize-${size}_altform-unplated.png`] = await cutout(size, size / 2);
  }
  return files;
}

const logo400 = await square(WORD, 400);
const outputs = {
  "docs/branding/guilded-logo-400.png": logo400,
  "companion-app/renderer/logo.png": logo400,
  "Screenshots/Logo.png": readFileSync(WORD),
  "site/brand/logo-400.png": await square(WORD, 400, { palette: true, quality: 90, effort: 10 }),
  "site/brand/logo-88.webp": await sharp(EMBLEM).resize(88, 88).webp({ quality: 80, effort: 6 }).toBuffer(),
  "site/brand/favicon.png": await square(EMBLEM, 64, { palette: true }),
  "site/brand/apple-touch-icon.png": await square(WORD, 180, { palette: true, quality: 90, effort: 10 }),
  // The app, installer and tray icon (companion-app/make-icon.mjs).
  "companion-app/branding/emblem.png": await cutout(512, 254),
  ...await appxTiles(),
  "addon/Guilded/Media/GuildedLogo.tga": await tga(EMBLEM, 256)
};
const check = process.argv.includes("--check");
let stale = 0;
for (const [path, data] of Object.entries(outputs)) {
  if (check) {
    let same = false;
    try { same = readFileSync(at(path)).equals(data); } catch { /* missing counts as stale */ }
    if (!same) { stale++; console.error(`${path} is not what scripts/build-logo-set.mjs produces.`); }
  } else {
    writeFileSync(at(path), data);
    console.log(`${path} ${data.length} bytes`);
  }
}
if (check && stale) process.exit(1);
