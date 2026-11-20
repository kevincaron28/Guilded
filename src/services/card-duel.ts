import sharp from "sharp";
import { ACCENTS, CARD_H, CARD_W, CardCanvas, INK, SUB, type TextReport } from "./card-kit.js";
import type { DuelSide, DuelVisual } from "./score-card.js";

/**
 * The duel result card, redesigned 21 Nov 2026 after owner feedback ("a bit too dark, redesign the information layout").
 * The painting is lifted instead of buried under a half-card slab: a soft left-to-right and top/bottom shade carries the header and
 * the strip, and the two fighters sit in light glass panels, winner left and loser right. Each panel holds the portrait badge,
 * the name, the level and that player's rating change with their new rating together. Few sizes, one alignment.
 */
const WIN = "#86e66a", LOSS = "#ff9a8c";
const TONE = { green: WIN, red: LOSS, muted: SUB } as const;
const { accent, tint } = ACCENTS.duel;

/** The painting, a little brighter and livelier than stored (the old card darkened it). */
async function lift(art: Buffer): Promise<Buffer> {
  return sharp(art).resize(CARD_W, CARD_H, { fit: "cover" }).removeAlpha().modulate({ brightness: 1.14, saturation: 1.08 }).linear(1.07, -3).jpeg({ quality: 90 }).toBuffer();
}

/** A round badge from the portrait bytes, or the class-coloured initial when there is none. */
async function badge(side: DuelSide, size: number): Promise<Buffer> {
  const mask = Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}"/></svg>`);
  if (side.portrait) {
    try { return await sharp(Buffer.from(side.portrait, "base64")).resize(size, size, { fit: "cover" }).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer(); } catch { /* the initial below */ }
  }
  return sharp(Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#16110c"/><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 10}" fill="none" stroke="${/^#[0-9a-fA-F]{6}$/.test(side.color) ? side.color : INK}" stroke-opacity=".55" stroke-width="3"/></svg>`)).png().toBuffer();
}

export async function renderDuelFaceOff(visual: DuelVisual, art: Buffer): Promise<{ png: Buffer; report: TextReport[] }> {
  const c = new CardCanvas();
  // Light shading: the top and bottom bands carry text, the centre is left to the painting and the panels.
  c.gradient(0, 0, CARD_W, 190, "v", [[0, "#000", 0.5], [1, "#000", 0]]);
  c.gradient(0, 0, 760, 190, "h", [[0, "#000", 0.3], [1, "#000", 0]]);
  c.gradient(0, 500, CARD_W, 130, "v", [[0, "#000", 0], [1, "#000", 0.62]]);
  c.emblem("duel", 56, 30, 40, tint);
  await c.text(visual.label.toUpperCase(), 108, 32, { size: 28, face: "title", color: tint, spacing: 800, maxW: 560, shadow: true });
  await c.text(visual.outcome, 56, 76, { size: 60, face: "title", maxW: visual.levels ? 700 : 1088, shadow: true });
  if (visual.levels) {
    const w = Math.min(330, await c.width(visual.levels, 34, "bold") + 44), x = 1144 - w;
    c.rect(x, 70, w, 56, "#0b0907", { opacity: 0.5, rx: 28, stroke: accent, strokeWidth: 2 });
    await c.text(visual.levels, x + w / 2, 79, { size: 34, face: "bold", anchor: "c", maxW: w - 28, shadow: true });
  }
  const top = 150, h = 240, w = 528;
  const sides: [DuelSide, number, string][] = [[visual.winner, 56, WIN], [visual.loser, 616, LOSS]];
  for (const [side, x, edge] of sides) {
    c.rect(x, top, w, h, "#0b0907", { opacity: 0.46, rx: 20, stroke: "#ffffff", strokeWidth: 1.5 });
    c.rect(x + 24, top, w - 48, 5, edge, { opacity: 0.9, rx: 2 });
    const left = x + 28, nameX = left + 112, room = x + w - 24 - nameX;
    await c.text(side.tag.toUpperCase(), left, top + 16, { size: 26, face: "bold", color: edge, spacing: 1800, maxW: w - 56, shadow: true });
    c.raw(`<circle cx="${left + 46}" cy="${top + 96}" r="48" fill="none" stroke="${side.color}" stroke-opacity=".9" stroke-width="3"/>`);
    await c.text(side.name, nameX, top + 58, { size: 40, face: "bold", color: side.color, maxW: room, ellipsis: true, shadow: true });
    if (side.level) await c.text(side.level, nameX, top + 104, { size: 30, color: SUB, maxW: room, shadow: true });
    c.rect(left, top + 150, w - 56, 2, "#ffffff", { opacity: 0.18 });
    if (side.delta) {
      const d = await c.text(side.delta, left, top + 154, { size: 72, face: "bold", color: TONE[side.tone], maxW: 170, shadow: true });
      if (side.standing) await c.text(side.standing, left + d.w + 20, top + 172, { size: 40, face: "bold", color: INK, maxW: w - 56 - d.w - 20, shadow: true });
    } else if (side.standing) await c.text(side.standing, left, top + 170, { size: 40, face: "bold", color: INK, maxW: w - 56, shadow: true });
  }
  c.rect(572, top + 92, 56, 56, "#0b0907", { opacity: 0.7, rx: 28, stroke: accent, strokeWidth: 2 });
  await c.text("VS", 600, top + 105, { size: 28, face: "bold", color: tint, anchor: "c", shadow: true });
  return finishWith(c, visual, art);
}

async function finishWith(c: CardCanvas, visual: DuelVisual, art: Buffer) {
  const strip = visual.strip ?? "";
  if (strip) await c.text(strip, 56, 568, { size: 26, color: SUB, maxW: visual.date ? 820 : 1088, shadow: true });
  if (visual.date) await c.text(visual.date, 1144, 568, { size: 26, color: SUB, anchor: "r", maxW: 300, shadow: true });
  const faces = await Promise.all([visual.winner, visual.loser].map((side) => badge(side, 88)));
  const { png, report } = await c.finish([{ input: await lift(art), left: 0, top: 0 }]);
  const withFaces = await sharp(png).composite([{ input: faces[0]!, left: 56 + 28 + 2, top: 150 + 96 - 44 }, { input: faces[1]!, left: 616 + 28 + 2, top: 150 + 96 - 44 }]).png().toBuffer();
  return { png: withFaces, report };
}
