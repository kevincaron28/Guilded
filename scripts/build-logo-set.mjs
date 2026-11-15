// Every Guilded logo file, cut from the two painted sources:
//   docs/branding/guilded-logo.png          1254 x 1254, crown + G + frame, lettering spelled G-U-I-L-D-E-D
//   docs/branding/guilded-logo-emblem.png   1254 x 1254, the same without the lettering (for small icons)
// (Before 15 November 2026 the lettering read "GILDED"; the new painting was generated from it with the spelling fixed.)
//
//   node scripts/build-logo-set.mjs          writes the files
//   node scripts/build-logo-set.mjs --check  fails if a written file differs from what the script produces
//
// The phone app's icons come from scripts/build-app-icon.mjs, which uses the same lettered source.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const at = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const WORD = at("docs/branding/guilded-logo.png");
const EMBLEM = at("docs/branding/guilded-logo-emblem.png");
const DARK = "#141824"; // the Store tiles' background

const square = (source, size, options = {}) => sharp(source).resize(size, size).png({ compressionLevel: 9, ...options }).toBuffer();
/** A wide tile: the lettered logo centred on the tile background. */
async function wide(width, height, logoSize) {
  const logo = await sharp(WORD).resize(logoSize, logoSize).toBuffer();
  return sharp({ create: { width, height, channels: 4, background: DARK } })
    .composite([{ input: logo, left: Math.round((width - logoSize) / 2), top: Math.round((height - logoSize) / 2) }])
    .png({ compressionLevel: 9 }).toBuffer();
}
/** The addon's texture: 256 x 256, 32-bit uncompressed TGA, top-left origin (same header as before). */
async function tga(source, size) {
  const { data } = await sharp(source).resize(size, size).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const header = Buffer.alloc(18);
  header[2] = 2; header.writeUInt16LE(size, 12); header.writeUInt16LE(size, 14); header[16] = 32; header[17] = 0x28;
  const bgra = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 4) { bgra[i] = data[i + 2]; bgra[i + 1] = data[i + 1]; bgra[i + 2] = data[i]; bgra[i + 3] = data[i + 3]; }
  return Buffer.concat([header, bgra]);
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
  "companion-app/build/appx/Square150x150Logo.png": await square(WORD, 150),
  "companion-app/build/appx/Square44x44Logo.png": await square(EMBLEM, 44),
  "companion-app/build/appx/StoreLogo.png": await square(EMBLEM, 50),
  "companion-app/build/appx/Wide310x150Logo.png": await wide(310, 150, 150),
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
