import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const source = fileURLToPath(new URL("../docs/branding/guilded-logo-400.png", import.meta.url));
const assets = fileURLToPath(new URL("./assets/", import.meta.url));
mkdirSync(assets, { recursive: true });
// Use the owner's logo throughout the app, installer and tray.
for (const name of ["icon.png", "tray-ok.png", "tray-error.png", "tray-setup.png"]) copyFileSync(source, assets + "/" + name);
copyFileSync(source, fileURLToPath(new URL("./renderer/logo.png", import.meta.url)));

// Problems panel (8.5): the same logo with a red "!" for the tray, and the "!" alone for the
// taskbar overlay. Without sharp (a root dependency) the tray falls back to tray-error.png.
const badge = (size) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="#d93a32" stroke="#ffffff" stroke-width="2"/><rect x="14" y="6" width="4" height="13" rx="2" fill="#ffffff"/><circle cx="16" cy="24.5" r="2.5" fill="#ffffff"/></svg>`);
try {
  const { default: sharp } = await import("sharp");
  await sharp(badge(32)).png().toFile(assets + "/problem-badge.png");
  await sharp(source).resize(400, 400).composite([{ input: badge(220), top: 180, left: 180 }]).png().toFile(assets + "/tray-problem.png");
} catch (error) {
  console.warn("Problem icons skipped (sharp unavailable): " + (error instanceof Error ? error.message : String(error)));
}
console.log("Guilded branding ready.");
