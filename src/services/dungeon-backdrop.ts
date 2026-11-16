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
/** Least-recently-used cache of the painting files' own (JPEG, ~160 KB) bytes: small and bounded, never decoded pictures. */
export const BACKDROP_CACHE_LIMIT = 6;
const cache = new Map<string, Buffer>();

/**
 * Dark paintings (Deadmines, Blackfathom, a procedural fallback) came out nearly black once the card's left shade was on top.
 * The part of the picture under the text column is brought up towards a mean brightness of LIFT_TARGET (never more than
 * LIFT_MAX times, never darker), so every dungeon shows its scenery. Exported for the tests.
 */
export const LIFT_TARGET = 100, LIFT_MAX = 1.9;
export async function lifted(art: Buffer): Promise<Buffer> {
  const stats = await sharp(art).extract({ left: 0, top: 0, width: 700, height: 630 }).stats();
  const mean = stats.channels.slice(0, 3).reduce((total, channel) => total + channel.mean, 0) / 3;
  const gain = Math.min(LIFT_MAX, Math.max(1, LIFT_TARGET / Math.max(mean, 1)));
  if (gain <= 1.02) return art;
  // A linear gain plus a small offset lifts the shadows without blowing out the lights (sharp clips at 255).
  return sharp(art).linear(gain, Math.round((gain - 1) * 12)).jpeg({ quality: 88 }).toBuffer();
}

/** How many paintings are held right now (for the test of the bound). */
export function backdropCacheSize(): number { return cache.size; }

async function painted(key: string): Promise<Buffer | null> {
  const known = cache.get(key);
  if (known) { cache.delete(key); cache.set(key, known); return known; }
  try {
    const file = fileURLToPath(new URL(`../../site/dungeon-art/${key}.jpg`, import.meta.url));
    let art: Buffer = await readFile(file);
    const meta = await sharp(art).metadata();
    // Every shipped file is 1200x630; anything else is fitted once, here.
    if (meta.width !== 1200 || meta.height !== 630) art = await sharp(art).resize(1200, 630, { fit: "cover" }).jpeg({ quality: 82 }).toBuffer();
    art = await lifted(art);
    cache.set(key, art);
    while (cache.size > BACKDROP_CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
    return art;
  } catch { return null; }
}

export async function dungeonBackdrop(theme: DungeonArtTheme): Promise<Buffer> {
  if (theme.painted && KEY.test(theme.painted)) {
    const art = await painted(theme.painted);
    if (art) return art;
  }
  // The procedural scene is brightened and re-encoded once per scene, then cached like the paintings.
  const key = `proc:${JSON.stringify(theme)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const art = await lifted(await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">${dungeonArt(theme)}</svg>`)).jpeg({ quality: 90 }).toBuffer());
  cache.set(key, art);
  while (cache.size > BACKDROP_CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  return art;
}
