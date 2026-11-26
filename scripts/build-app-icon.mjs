// The phone app's icons: the painted emblem (no lettering, so it reads at 48 px) on the navy backdrop.
// Until 26 November 2026 they were the lettered square painting on a black margin, which Android masked into a
// small square. The pieces come from scripts/emblem-art.mjs.
//
//   node scripts/build-app-icon.mjs          writes the files
//   node scripts/build-app-icon.mjs --check  fails if a written file differs from what the script produces
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { at, backdrop, cutout, silhouette, tile } from "./emblem-art.mjs";

const small = (source, size) => sharp(source).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
// Android's adaptive icon: a 108 dp canvas of which launchers show a 72 dp shape; art inside the 66 dp circle is
// never clipped. 312 px is that circle's radius on 1024.
const SAFE = 312;

const icon = await tile(1024, 1024, 468);
const outputs = {
  "mobile/assets/icon.png": icon,
  "mobile/assets/adaptive-icon.png": await cutout(1024, SAFE),
  "mobile/assets/adaptive-background.png": await backdrop(1024),
  "mobile/assets/adaptive-monochrome.png": await silhouette(1024, SAFE),
  // The status-bar icon of raid reminders: Android draws only its outline, in white.
  "mobile/assets/notification-icon.png": await silhouette(96, 46),
  // The launch screen shows the emblem alone on the app's background (expo-splash-screen in app.json). Android 12
  // and later mask it to a circle, so it stays inside one.
  "mobile/assets/splash.png": await cutout(800, 376),
  "mobile/store/icon-512.png": await small(icon, 512),
  "mobile/store/icon-48-preview.png": await small(icon, 48)
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
