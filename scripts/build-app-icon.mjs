// The phone app's icons, cut from the painted logo (docs/branding/guilded-logo.png, 1254 x 1254, lettering spelled GUILDED).
// Until 15 November 2026 the painting read "GILDED" and this script covered the word with a plaque; the painting is fixed now.
//
//   node scripts/build-app-icon.mjs          writes the files
//   node scripts/build-app-icon.mjs --check  fails if a written file differs from what the script produces
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const at = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const badge = readFileSync(at("docs/branding/guilded-logo.png"));
const BACKGROUND = "#0b0c0b"; // the app's own background (mobile/app.json)

/** The badge centred on a square canvas, at the same placement the earlier icons used. */
async function onCanvas(badge, canvas, badgeSize, background) {
  const scaled = await sharp(badge).resize(badgeSize, badgeSize).toBuffer();
  const offset = Math.round((canvas - badgeSize) / 2);
  return sharp({ create: { width: canvas, height: canvas, channels: 4, background } }).composite([{ input: scaled, left: offset, top: offset }]).png({ compressionLevel: 9 }).toBuffer();
}

const icon = await onCanvas(badge, 1024, 680, BACKGROUND);
const outputs = {
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
