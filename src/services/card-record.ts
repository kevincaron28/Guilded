import sharp from "sharp";
import { CARD_H, CARD_W, CardCanvas, GOOD, INK, SUB, type TextReport } from "./card-kit.js";
import { formatDuration } from "./dungeon-rules.js";
import { circleImage, roleGlyph, type ScoreCard } from "./score-card.js";

/**
 * The guild dungeon record card, redesigned 21 Nov 2026 after owner feedback ("very bare, a lot of empty space, no hype"). Same
 * language as the duel card: the dungeon painting fills the whole card (lifted, with soft shades behind the text), a big headline
 * and the new time, the time cut as a green badge, a standing pill and a "dethrones" pill, then the party as a row of round portraits
 * (Armory picture added at delivery, else a class-coloured ring with the initial) with the name in class colour and a role mark.
 */
const GOLD = "#ffd75a", RED = "#ff8a7a";
const PANEL = "#0b0907";

/** The painting, a little brighter and livelier than stored (as the duel card does). */
async function lift(art: Buffer): Promise<Buffer> {
  return sharp(art).resize(CARD_W, CARD_H, { fit: "cover" }).removeAlpha().modulate({ brightness: 1.1, saturation: 1.08 }).linear(1.06, -2).jpeg({ quality: 90 }).toBuffer();
}

const colorOf = (color: string) => (/^#[0-9a-fA-F]{6}$/.test(color) ? color : INK);

export async function renderRecordCard(card: ScoreCard, art: Buffer): Promise<{ png: Buffer; report: TextReport[] }> {
  const v = card.record!, c = new CardCanvas();
  const tie = v.previousSec !== undefined && v.previousSec === v.newSec, first = v.previousSec === undefined;
  // Fallback for cards queued before the headline existed: the French ribbons all read "... record de ...", so only they get the
  // space before "!" (English ones read "NEW GUILD RECORD!").
  const headline = v.headline ?? `${v.ribbon.toUpperCase()}${/\brecord de\b/i.test(v.ribbon) ? " !" : "!"}`;
  // Shades: the top carries the headline, the middle the time, the bottom the party panel; the painting stays visible between.
  c.gradient(0, 0, CARD_W, 340, "v", [[0, "#000", 0.55], [1, "#000", 0.08]]);
  c.gradient(0, 0, 820, 340, "h", [[0, "#000", 0.38], [1, "#000", 0]]);
  c.gradient(0, 340, CARD_W, 290, "v", [[0, "#000", 0], [1, "#000", 0.55]]);

  c.emblem("cup", 56, 24, 56, GOLD);
  await c.text(headline, 130, 14, { size: 72, face: "title", color: GOLD, maxW: 1014, shadow: true });
  await c.text(card.title, 56, 100, { size: 44, face: "bold", maxW: card.subtitle ? 700 : 1088, shadow: true });
  if (card.subtitle) await c.text(card.subtitle, 1144, 112, { size: 26, color: SUB, anchor: "r", maxW: 380, shadow: true });

  // The new time, huge, with the time cut beside it.
  const time = await c.text(formatDuration(v.newSec), 56, 148, { size: 150, face: "bold", color: GOLD, maxW: 520, shadow: true });
  const bx = 56 + time.w + 36, bw = 1144 - bx, by = 176, bh = 150;
  if (bw >= 230) {
    const tone = first || tie ? GOLD : v.newSec < (v.previousSec ?? 0) ? GOOD : RED;
    c.rect(bx, by, Math.min(bw, 420), bh, PANEL, { opacity: 0.5, rx: 22, stroke: tone, strokeWidth: 2 });
    const cx = bx + Math.min(bw, 420) / 2, inner = Math.min(bw, 420) - 40;
    if (first) {
      await c.text(v.diffLabel, cx, by + 24, { size: 52, face: "bold", color: tone, anchor: "c", maxW: inner, shadow: true });
      await c.text(v.oldLabel, cx, by + 96, { size: 26, color: SUB, anchor: "c", maxW: inner, shadow: true });
    } else {
      await c.text(v.diffLabel, cx, by + 10, { size: 88, face: "bold", color: tone, anchor: "c", maxW: inner, shadow: true });
      await c.text(`${v.oldWord ?? v.oldLabel.split(" ")[0]} ${formatDuration(v.previousSec!)}`, cx, by + 106, { size: 30, face: "bold", color: SUB, anchor: "c", maxW: inner, shadow: true });
    }
  }

  // Pills: where the record stands, and whose it was.
  const py = 350, ph = 52;
  let px = 56;
  if (v.rankLabel) {
    const w = Math.min(520, await c.width(v.rankLabel, 28, "bold") + 84);
    c.rect(px, py, w, ph, "#3b2a05", { opacity: 0.86, rx: 26, stroke: GOLD, strokeWidth: 2 });
    c.emblem("cup", px + 14, py + 10, 32, GOLD);
    await c.text(v.rankLabel, px + 54 + (w - 54 - 20) / 2, py + 9, { size: 28, face: "bold", color: GOLD, anchor: "c", maxW: w - 54 - 20, shadow: true });
    px += w + 14;
  }
  if (v.previousHolders.length) {
    const text = `${v.dethroneLabel ?? v.previousLabel} ${v.previousHolders.join(", ")}`, room = 1144 - px;
    if (room >= 200) {
      const w = Math.min(room, await c.width(text, 28, "bold") + 44);
      c.rect(px, py, w, ph, PANEL, { opacity: 0.62, rx: 26, stroke: RED, strokeWidth: 2 });
      await c.text(text, px + w / 2, py + 9, { size: 28, face: "bold", color: INK, anchor: "c", maxW: w - 36, ellipsis: true, shadow: true });
    }
  }

  // The party: round portraits with a class-coloured ring, name in class colour, role mark on the portrait.
  const party = v.party.slice(0, 5), top = 424, h = 178, r = 42;
  const faces: { input: Buffer; left: number; top: number }[] = [];
  if (party.length) {
    c.rect(56, top, 1088, h, PANEL, { opacity: 0.48, rx: 22, stroke: "#ffffff", strokeWidth: 1.5 });
    const cell = 1088 / 5, start = 56 + (1088 - cell * party.length) / 2;
    for (const [i, m] of party.entries()) {
      const cx = Math.round(start + cell * i + cell / 2), cy = top + 16 + r + 2, color = colorOf(m.color);
      const face = m.portrait ? await circleImage(m.portrait, r * 2) : null;
      if (face) faces.push({ input: face, left: cx - r, top: cy - r });
      else {
        c.raw(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="#16110c" fill-opacity=".85"/>`);
        const initial = [...(m.name.trim() || "?")][0]!.toUpperCase();
        await c.text(initial, cx, cy - 27, { size: 54, face: "bold", color, anchor: "c", shadow: true });
      }
      c.raw(`<circle cx="${cx}" cy="${cy}" r="${r + 2}" fill="none" stroke="${color}" stroke-width="4"/>`);
      c.raw(roleGlyph(m.role, cx + r - 6, cy + r - 6, 16));
      await c.text(m.name, cx, top + 16 + r * 2 + 14, { size: 28, face: "bold", color, anchor: "c", maxW: cell - 16, ellipsis: true, shadow: true });
    }
  }
  const { png, report } = await c.finish([{ input: await lift(art), left: 0, top: 0 }, ...faces]);
  return { png, report };
}
