// The phone app's icons, with the wordmark spelled GUILDED.
//
// The badge art (docs/branding/guilded-logo.png, 1254 x 1254) is one flat painting whose lettering reads "GILDED".
// It has no layered source, so the lettering cannot be edited. This script leaves the painting alone and puts a
// plaque over the old lettering with the name set in the site's serif (site/fonts/source-serif-latin.ttf), then
// writes the corrected badge and the four files the phone app and its Play listing use.
//
//   node scripts/build-app-icon.mjs          writes the files
//   node scripts/build-app-icon.mjs --check  fails if a written file differs from what the script produces
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const at = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const SOURCE = at("docs/branding/guilded-logo.png");
const FONT = at("site/fonts/source-serif-latin.ttf");
const SIZE = 1254;
// Where the old lettering sits in the painting, with a margin: the plaque covers all of it.
const PLAQUE = { x: 62, y: 722, width: 1130, height: 300, radius: 46 };
const WORD = "GUILDED";
const WORD_WIDTH = 1010;
const BACKGROUND = "#0b0c0b"; // the app's own background (mobile/app.json)

/** An RGBA picture from a three-channel picture and a one-channel mask of the same size (raw pixels, no surprises). */
async function withAlpha(colour, mask, width, height) {
  const rgb = await sharp(colour).resize(width, height, { fit: "fill" }).removeAlpha().toColourspace("srgb").raw().toBuffer();
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) { out[i * 4] = rgb[i * 3]; out[i * 4 + 1] = rgb[i * 3 + 1]; out[i * 4 + 2] = rgb[i * 3 + 2]; out[i * 4 + 3] = mask[i]; }
  return sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

async function wordmark() {
  // Without rgba, sharp draws the text white on black: its first channel is the letters' mask.
  const text = await sharp({ text: { text: `<span letter_spacing="6000">${WORD}</span>`, font: "Source Serif 4 Bold 150", fontfile: FONT, dpi: 300 } }).png().toBuffer();
  const trimmed = await sharp(text).trim().resize({ width: WORD_WIDTH }).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  const { width, height } = trimmed.info;
  const gradient = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#fff6c2"/><stop offset="0.28" stop-color="#fbd45a"/><stop offset="0.62" stop-color="#e09a1f"/><stop offset="1" stop-color="#8f5a12"/>
  </linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`);
  const fill = await withAlpha(gradient, trimmed.data, width, height);
  // A dark rim around the letters, so they read against the plaque at small sizes.
  const pad = 14, rimWidth = width + pad * 2, rimHeight = height + pad * 2;
  const wide = await sharp(trimmed.data, { raw: { width, height, channels: 1 } }).extend({ top: pad, bottom: pad, left: pad, right: pad, background: "#000000" }).blur(5).threshold(28).extractChannel(0).raw().toBuffer();
  const rim = await withAlpha(await sharp({ create: { width: rimWidth, height: rimHeight, channels: 3, background: "#2b1704" } }).png().toBuffer(), wide, rimWidth, rimHeight);
  return { fill, rim, width, height, pad };
}

async function correctedBadge() {
  const { x, y, width, height, radius } = PLAQUE;
  const plaque = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}"><defs>
    <linearGradient id="p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#101a3d"/><stop offset="1" stop-color="#060914"/></linearGradient>
    <linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7d267"/><stop offset="1" stop-color="#9a6416"/></linearGradient>
  </defs>
  <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="url(#p)" stroke="url(#b)" stroke-width="10"/>
  <rect x="${x + 16}" y="${y + 16}" width="${width - 32}" height="${height - 32}" rx="${radius - 14}" fill="none" stroke="#c8962e" stroke-opacity="0.55" stroke-width="3"/>
  </svg>`);
  const word = await wordmark();
  const left = Math.round(x + (width - word.width) / 2), top = Math.round(y + (height - word.height) / 2);
  return sharp(SOURCE).composite([
    { input: plaque, left: 0, top: 0 },
    { input: word.rim, left: left - word.pad, top: top - word.pad },
    { input: word.fill, left, top }
  ]).png({ compressionLevel: 9 }).toBuffer();
}

/** The badge centred on a square canvas, at the same placement the earlier icons used. */
async function onCanvas(badge, canvas, badgeSize, background) {
  const scaled = await sharp(badge).resize(badgeSize, badgeSize).toBuffer();
  const offset = Math.round((canvas - badgeSize) / 2);
  return sharp({ create: { width: canvas, height: canvas, channels: 4, background } }).composite([{ input: scaled, left: offset, top: offset }]).png({ compressionLevel: 9 }).toBuffer();
}

const badge = await correctedBadge();
const icon = await onCanvas(badge, 1024, 680, BACKGROUND);
const outputs = {
  "docs/branding/guilded-logo-guilded.png": badge,
  "mobile/assets/icon.png": icon,
  // Android masks the adaptive icon to a circle or squircle: the badge stays inside the safe zone.
  "mobile/assets/adaptive-icon.png": await onCanvas(badge, 1024, 580, "#000000"),
  "mobile/store/icon-512.png": await sharp(icon).resize(512, 512).png({ compressionLevel: 9 }).toBuffer(),
  // The launch screen shows the badge alone, 400 px, on the app's background (expo-splash-screen in app.json).
  "mobile/assets/splash.png": await sharp(badge).resize(400, 400).png({ compressionLevel: 9 }).toBuffer()
};
const check = process.argv.includes("--check");
let stale = 0;
for (const [path, data] of Object.entries(outputs)) {
  if (check) {
    let same = false;
    try { same = readFileSync(at(path)).equals(data); } catch { /* missing counts as stale */ }
    if (!same) { stale++; console.error(`${path} is not what scripts/build-app-icon.mjs produces.`); }
  } else {
    writeFileSync(at(path), data);
    console.log(`${path} ${data.length} bytes`);
  }
}
if (check && stale) process.exit(1);
