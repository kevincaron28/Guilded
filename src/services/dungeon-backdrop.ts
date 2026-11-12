import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { dungeonArt, type DungeonArtTheme } from "./dungeon-art.js";

/**
 * The 1200x630 backdrop of a dungeon card. A dungeon with painted artwork (`theme.painted` names a file in
 * `site/dungeon-art/<key>.jpg`, 1200x630) uses that picture; every other dungeon, and a card queued before the paintings
 * existed, keeps the procedural scene of dungeon-art.ts. A missing or unreadable file also falls back, so a card never fails
 * over its picture.
 */
const KEY = /^[a-z0-9-]{1,40}$/;
const cache = new Map<string, Buffer>();

async function painted(key: string): Promise<Buffer | null> {
  const known = cache.get(key);
  if (known) return known;
  try {
    const file = fileURLToPath(new URL(`../../site/dungeon-art/${key}.jpg`, import.meta.url));
    const art = await sharp(await readFile(file)).resize(1200, 630, { fit: "cover" }).png().toBuffer();
    if (cache.size >= 40) cache.clear();
    cache.set(key, art);
    return art;
  } catch { return null; }
}

export async function dungeonBackdrop(theme: DungeonArtTheme): Promise<Buffer> {
  if (theme.painted && KEY.test(theme.painted)) {
    const art = await painted(theme.painted);
    if (art) return art;
  }
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">${dungeonArt(theme)}</svg>`)).png().toBuffer();
}
