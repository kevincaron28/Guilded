import sharp from "sharp";
import { fileURLToPath } from "node:url";

/**
 * Painted emblems for the podium and weekly cards (19 Nov 2026): medals, crown, MVP shield, rookie banner and small stat icons from
 * site/podium-art/ (cut out by scripts/build-podium-art.mjs). Each helper returns SVG markup for CardCanvas.raw(), or "" when the file
 * cannot be read, so the caller draws its simple code-drawn shape instead and a card never fails over a picture.
 */
export type PodiumArt = "medal-gold" | "medal-silver" | "medal-bronze" | "crown" | "mvp-shield" | "rookie-banner"
  | "icon-points" | "icon-messages" | "icon-voice" | "icon-dungeons" | "icon-newcomers" | "icon-activities" | "icon-reactions" | "icon-raids";

/** Width and height of each picture, so a caller can place it by one dimension (the files are trimmed to their painting). */
export const ART_SIZE: Record<PodiumArt, { w: number; h: number }> = {
  "medal-gold": { w: 130, h: 192 }, "medal-silver": { w: 130, h: 192 }, "medal-bronze": { w: 130, h: 192 },
  crown: { w: 192, h: 150 }, "mvp-shield": { w: 192, h: 179 }, "rookie-banner": { w: 190, h: 192 },
  "icon-points": { w: 95, h: 96 }, "icon-messages": { w: 95, h: 96 }, "icon-voice": { w: 95, h: 96 }, "icon-dungeons": { w: 95, h: 96 },
  "icon-newcomers": { w: 95, h: 96 }, "icon-activities": { w: 95, h: 96 }, "icon-reactions": { w: 95, h: 96 }, "icon-raids": { w: 95, h: 96 }
};
/** Where a medal's disc centre sits, as a share of the picture's width below its top (the ribbon is above the disc). */
export const MEDAL_CENTRE = 0.985;

// The SVG renderer behind sharp cannot decode WebP inside an <image>, so each file is converted to PNG once and kept as a data URI.
const cache = new Map<PodiumArt, string | null>();
const dataUri = (name: PodiumArt): string | null => cache.get(name) ?? null;

/** Loads every picture (once). Call before drawing; a picture that fails to load stays missing and the caller's drawn shape is used. */
export async function preloadPodiumArt(): Promise<void> {
  await Promise.all((Object.keys(ART_SIZE) as PodiumArt[]).filter((name) => !cache.has(name)).map(async (name) => {
    try {
      const png = await sharp(fileURLToPath(new URL(`../../site/podium-art/${name}.webp`, import.meta.url))).png().toBuffer();
      cache.set(name, `data:image/png;base64,${png.toString("base64")}`);
    } catch { cache.set(name, null); }
  }));
}

/** The picture drawn `width` wide with its top-left at (x, y); its height follows its own proportions. "" when missing. */
export function artImage(name: PodiumArt, x: number, y: number, width: number): string {
  const uri = dataUri(name);
  if (!uri) return "";
  const { w, h } = ART_SIZE[name];
  return `<image xlink:href="${uri}" x="${Math.round(x)}" y="${Math.round(y)}" width="${width}" height="${Math.round((width * h) / w)}"/>`;
}
export const artHeight = (name: PodiumArt, width: number) => Math.round((width * ART_SIZE[name].h) / ART_SIZE[name].w);
export const hasArt = (name: PodiumArt) => dataUri(name) !== null;
