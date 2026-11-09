// Optimises the phone-app screenshots for the website (webp, 360 px wide) and the marketing folder (palette PNG, full size).
// Sources: mobile/store/screenshots (Play listing) and docs/plans/app-tcg-art/clash-screens (Guilded Clash), all made-up sample data.
// Usage: node scripts/optimise-phone-screenshots.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const site = "site/images/phone";
const marketing = "docs/marketing/screenshots-9nov/phone";
mkdirSync(site, { recursive: true });
mkdirSync(marketing, { recursive: true });
const sets = [
  ["mobile/store/screenshots", ["02-guild-roster", "04-guild-raids", "06-me-badges", "07-alerts"], "app"],
  ["docs/plans/app-tcg-art/clash-screens", ["01-play", "02-gauntlet", "04-board", "06-collection", "08-pack-open", "pvp-01-guild", "pvp-07-ranked", "pvp-10-ladder"], "clash"]
];
for (const [dir, names, prefix] of sets) {
  for (const name of names) {
    const input = `${dir}/${name}.png`;
    const out = `${prefix}-${name.replace(/^\d+-/, "")}`;
    const webp = await sharp(input).resize({ width: 360 }).webp({ quality: 80, effort: 6 }).toBuffer({ resolveWithObject: true });
    writeFileSync(`${site}/${out}.webp`, webp.data);
    writeFileSync(`${marketing}/${out}.png`, await sharp(input).png({ compressionLevel: 9, palette: true, quality: 90 }).toBuffer());
    console.log(out, webp.info.width, webp.info.height, webp.data.length);
  }
}
