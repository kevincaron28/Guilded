// Publishes the painted dungeon pictures (site/dungeon-art/<key>.jpg, 1200 x 630) for the website's leaderboards as
// <out>/<key>-480.webp (480 x 252, the table and strip thumbnails) and <out>/<key>-1200.webp (the header cover).
// Used by scripts/build-site.mjs; keys are the file names paintedKey() (src/services/dungeon-card.ts) returns.
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import sharp from "sharp";

export async function buildDungeonThumbs(sourceDir = "site/dungeon-art", outDir = "dist/site/images/dungeons") {
  mkdirSync(outDir, { recursive: true });
  const keys = [];
  if (!existsSync(sourceDir)) return keys;
  for (const name of readdirSync(sourceDir)) {
    const match = /^([a-z0-9-]+)\.(?:jpe?g|png)$/.exec(name);
    if (!match) continue;
    const key = match[1];
    const source = `${sourceDir}/${name}`;
    await sharp(source).resize(480, 252, { fit: "cover" }).webp({ quality: 78 }).toFile(`${outDir}/${key}-480.webp`);
    await sharp(source).resize(1200, 630, { fit: "cover" }).webp({ quality: 80 }).toFile(`${outDir}/${key}-1200.webp`);
    keys.push(key);
  }
  return keys;
}
