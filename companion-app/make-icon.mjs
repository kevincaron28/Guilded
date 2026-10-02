import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const source = fileURLToPath(new URL("../docs/branding/guilded-logo-400.png", import.meta.url));
const assets = fileURLToPath(new URL("./assets/", import.meta.url));
mkdirSync(assets, { recursive: true });
// Use the owner's logo throughout the app, installer and tray.
for (const name of ["icon.png", "tray-ok.png", "tray-error.png", "tray-setup.png"]) copyFileSync(source, assets + "/" + name);
copyFileSync(source, fileURLToPath(new URL("./renderer/logo.png", import.meta.url)));
console.log("Guilded branding ready.");
