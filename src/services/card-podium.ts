import sharp, { type OverlayOptions } from "sharp";
import { cardBackdropArt as paintedArt } from "./card-backdrop.js";
import { plainArt } from "./card-layouts-recap.js";
import { ACCENTS, CARD_H, CARD_W, CardCanvas, INK, SUB } from "./card-kit.js";
import { MEDAL_CENTRE, artHeight, artImage, hasArt, preloadPodiumArt, type PodiumArt } from "./podium-art.js";
import type { ScoreCard, WeeklyIcon, WeeklyVisual } from "./score-card.js";

/**
 * The podium layouts (19 Nov 2026): the community leaderboard (a podium for the top three, then every other member in two or three
 * columns, each with a small stacked bar for Discord / dungeons / PvP) and the weekly honors card (MVP, top three, rookie and the guild's
 * week in one picture). Both read the stored ScoreCard definitions (`ladder` / `weekly`), so a card queued earlier draws in the new
 * look. Same kit as every other card: Carlito text, 24 px floor, contrast measured; the card grows taller with its content.
 * No logo or crest of the game and no brand text: shapes, a medal, a crown and a painting from site/card-art only.
 */
const PAD = 56, BANNER = 172, BODY = "#15110d";
export const PODIUM_TOP = 30;

interface Metal { light: string; dark: string; ring: string; ink: string; text: string; wash: string }
const METALS: Metal[] = [
  { light: "#fff0a8", dark: "#c8921c", ring: "#fff7cf", ink: "#3b2a05", text: "#ffd84d", wash: "#e0b84a" },
  { light: "#f6f8fb", dark: "#8f9ba8", ring: "#ffffff", ink: "#1f2630", text: "#e3e9f0", wash: "#aab6c3" },
  { light: "#f6c08e", dark: "#9a5a2a", ring: "#ffe2c4", ink: "#3a1f0a", text: "#f0b07a", wash: "#c9854f" }
];
const SEG = ["#7c8cff", "#22c4b0", "#ff6f5e"] as const;
const metalFor = (rank: number) => METALS[Math.min(3, Math.max(1, rank)) - 1]!;

let uid = 0;
const nextId = (prefix: string) => `${prefix}${uid++ % 100000}`;

const num = (text: string | undefined) => Number((text ?? "").replace(/[^\d]/g, "")) || 0;
/** "Simon (Crashing Paladin)" -> the member and the character on two lines; a name without brackets stays one line. */
export function splitName(full: string): { name: string; character: string } {
  const m = /^(.+?)\s*\((.*?)\)?$/u.exec(full.trim());
  return m && m[1]!.trim() && m[2]!.trim() ? { name: m[1]!.trim(), character: m[2]!.trim() } : { name: full.trim(), character: "" };
}

async function bannerLayer(card: ScoreCard, bh: number): Promise<OverlayOptions> {
  const art = (card.backdrop ? await paintedArt(card.backdrop, "wide") : null) ?? await plainArt();
  const full = await sharp(art).resize(CARD_W, CARD_H, { fit: "cover" }).removeAlpha().toBuffer();
  return { input: await sharp(full).extract({ left: 0, top: Math.round((CARD_H - bh) * 0.5), width: CARD_W, height: bh }).toBuffer(), left: 0, top: 0 };
}

/** A medal: the painted medal and ribbon when its picture loads, else a gradient disc on a drawn ribbon. The rank number is drawn on top as text. */
async function medal(c: CardCanvas, cx: number, cy: number, r: number, rank: number, metal: Metal): Promise<void> {
  const art = `medal-${["gold", "silver", "bronze"][Math.min(3, Math.max(1, rank)) - 1]}` as PodiumArt, width = Math.round(r * 2.0);
  if (hasArt(art)) c.raw(artImage(art, cx - width / 2, cy - width * MEDAL_CENTRE, width));
  else {
    const g = nextId("m");
    c.raw(`<defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${metal.light}"/><stop offset="1" stop-color="${metal.dark}"/></linearGradient></defs>`
      + `<path d="M${cx - r * 0.7} ${cy - r * 0.2} L${cx - r * 1.0} ${cy + r * 1.35} L${cx - r * 0.5} ${cy + r * 1.05} L${cx - r * 0.2} ${cy + r * 1.4} L${cx + r * 0.1} ${cy + r * 0.3} Z" fill="#b3302b"/>`
      + `<path d="M${cx + r * 0.7} ${cy - r * 0.2} L${cx + r * 1.0} ${cy + r * 1.35} L${cx + r * 0.5} ${cy + r * 1.05} L${cx + r * 0.2} ${cy + r * 1.4} L${cx - r * 0.1} ${cy + r * 0.3} Z" fill="#8f2420"/>`
      + `<circle cx="${cx}" cy="${cy}" r="${r + 3}" fill="#000" fill-opacity="0.35"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${g})" stroke="${metal.ring}" stroke-width="3"/>`
      + `<circle cx="${cx}" cy="${cy}" r="${r - 8}" fill="none" stroke="${metal.ink}" stroke-opacity="0.35" stroke-width="2"/>`);
  }
  await c.text(String(rank), cx, cy - Math.round(r * 0.62), { size: Math.round(r * 1.1) < 24 ? 24 : Math.round(r * 1.1), face: "bold", color: metal.ink, anchor: "c" });
}

/** A small stacked bar: Discord, dungeons and PvP as a share of the member's points. */
function stackedBar(c: CardCanvas, x: number, y: number, w: number, h: number, parts: number[]): void {
  const total = parts.reduce((a, b) => a + b, 0), clip = nextId("b");
  let at = x, segs = "";
  if (total > 0) for (const [i, p] of parts.entries()) {
    if (p <= 0) continue;
    const sw = Math.max(3, Math.round((w * p) / total));
    segs += `<rect x="${at}" y="${y}" width="${sw}" height="${h}" fill="${SEG[i]}"/>`;
    at += sw;
  }
  c.raw(`<defs><clipPath id="${clip}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}"/></clipPath></defs><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="#ffffff" fill-opacity="0.13"/><g clip-path="url(#${clip})">${segs}</g>`);
}

function arrow(c: CardCanvas, x: number, y: number, move: number | "new" | undefined, tint: string): void {
  if (move === "new") c.raw(`<circle cx="${x}" cy="${y}" r="5" fill="${tint}"/>`);
  else if (typeof move === "number" && move !== 0) c.raw(`<path d="${move > 0 ? `M${x - 6} ${y + 5} L${x + 6} ${y + 5} L${x} ${y - 6} Z` : `M${x - 6} ${y - 5} L${x + 6} ${y - 5} L${x} ${y + 6} Z`}" fill="${move > 0 ? "#86e66a" : "#ff8a7a"}"/>`);
}

async function header(c: CardCanvas, card: ScoreCard, bh: number, emblem: "crown" | "star"): Promise<void> {
  const { accent, tint } = ACCENTS.weekly;
  c.gradient(0, 0, 780, bh, "h", [[0, "#000", 0.82], [0.7, "#000", 0.4], [1, "#000", 0]]);
  c.rect(0, bh, CARD_W, c.height - bh, BODY);
  c.rect(0, bh, CARD_W, 5, accent);
  if (emblem === "crown" && hasArt("crown")) c.raw(artImage("crown", PAD - 4, 20, 58)); else c.emblem(emblem, PAD, 24, 44, tint);
  await c.text((card.eyebrow ?? card.title).split("·").pop()!.trim().toUpperCase(), PAD + 60, 28, { size: 30, face: "title", color: tint, spacing: 800, maxW: 560 });
  await c.text(card.title, PAD, 70, { size: 55, face: "title", maxW: 1000 });
  if (card.subtitle) await c.text(card.subtitle, PAD, 134, { size: 32, face: "bold", color: INK, maxW: 1000 });
}

/** ---------- Community leaderboard ---------- */
export async function renderCommunityPodium(card: ScoreCard): Promise<Buffer> {
  const visual = card.ladder!, rows = visual.boards.flatMap((board) => board.rows).slice(0, PODIUM_TOP);
  const fr = /Mis à jour/.test(visual.meta ?? "");
  const top = rows.slice(0, 3), rest = rows.slice(3);
  const cols = rest.length > 18 ? 3 : rest.length > 0 ? 2 : 1, perCol = Math.ceil(rest.length / cols), ROW = 64;
  const podiumTop = BANNER + 44, tileBottom = podiumTop + 292, restTop = tileBottom + 34;
  const H = restTop + (rest.length ? perCol * ROW + 14 : -6) + 118;
  await preloadPodiumArt();
  const c = new CardCanvas(H);
  await header(c, card, BANNER, "crown");

  // --- the podium: second, first, third; the first is taller and wears a crown ---
  const tileW = 338, gap = 22, order = top.length >= 3 ? [1, 0, 2] : top.length === 2 ? [0, 1] : [0];
  const startX = Math.round((CARD_W - (order.length * tileW + (order.length - 1) * gap)) / 2);
  for (const [slot, index] of order.entries()) {
    const row = top[index]!, metal = metalFor(index + 1), first = index === 0;
    const x = startX + slot * (tileW + gap), y = first ? podiumTop : podiumTop + 34, h = first ? 292 : 258, cx = x + tileW / 2;
    const gid = nextId("t");
    c.raw(`<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${metal.wash}" stop-opacity="0.30"/><stop offset="1" stop-color="#000" stop-opacity="0.25"/></linearGradient></defs>`);
    c.rect(x, y, tileW, h, "#1d1710", { rx: 16, stroke: metal.wash, strokeWidth: 3 });
    c.rect(x, y, tileW, h, `url(#${gid})`, { rx: 16 });
    c.rect(x + 16, y + 3, tileW - 32, 4, metal.text, { rx: 2, opacity: 0.9 });
    const medalR = first ? 30 : 26, medalY = y + (first ? 66 : 50);
    if (first) { if (hasArt("crown")) c.raw(artImage("crown", cx - 31, y + 2 - artHeight("crown", 62), 62)); else c.emblem("crown", cx - 20, y - 12, 40, metal.text); }
    await medal(c, cx, medalY, medalR, row.rank, metal);
    const { name, character } = splitName(row.name);
    const nameY = y + (first ? 98 : 88);
    await c.text(name, cx, nameY, { size: first ? 34 : 32, face: "bold", color: row.color, anchor: "c", maxW: tileW - 36 });
    if (character) await c.text(character, cx, nameY + (first ? 40 : 38), { size: 24, color: SUB, anchor: "c", maxW: tileW - 36 });
    const points = row.values[3] ?? "";
    const figY = y + h - (first ? 124 : 100);
    await c.text(points, cx, figY, { size: first ? 52 : 46, face: "bold", color: metal.text, anchor: "c", maxW: 180 });
    await c.text("pts", cx + Math.min(90, (await c.width(points, first ? 52 : 46, "bold")) / 2 + 8) + 4, figY + (first ? 22 : 18), { size: 24, color: SUB });
    stackedBar(c, x + 28, y + h - 34, tileW - 56, 12, [num(row.values[0]), num(row.values[1]), num(row.values[2])]);
    arrow(c, x + 26, y + 26, row.move, metal.text);
  }

  // --- everyone else: rows with a two-line name, the total and a stacked bar ---
  const colGap = 20, colW = Math.floor((CARD_W - 2 * PAD - (cols - 1) * colGap) / cols);
  const totalW = cols === 3 ? 84 : 96, barW = cols === 3 ? 84 : 110;
  for (const [i, row] of rest.entries()) {
    const col = Math.floor(i / perCol), slot = i % perCol, x = PAD + col * (colW + colGap), y = restTop + slot * ROW;
    c.rect(x, y, colW, ROW - 6, "#ffffff", { opacity: slot % 2 ? 0.02 : 0.07, rx: 10 });
    await c.text(String(row.rank), x + 46, y + 14, { size: 30, face: "bold", color: SUB, anchor: "r" });
    arrow(c, x + 62, y + 28, row.move, "#ffd100");
    const { name, character } = splitName(row.name), nameX = x + 78, nameR = x + colW - Math.max(totalW, barW) - 30;
    if (character) {
      await c.text(name, nameX, y + 5, { size: 28, face: "bold", color: row.color, maxW: nameR - nameX });
      await c.text(character, nameX, y + 32, { size: 24, color: SUB, maxW: nameR - nameX });
    } else await c.text(name, nameX, y + 14, { size: 28, face: "bold", color: row.color, maxW: nameR - nameX });
    const edge = x + colW - 14;
    await c.text(row.values[3] ?? "", edge, y + 3, { size: 32, face: "bold", color: "#ffd100", anchor: "r", maxW: totalW + 20 });
    stackedBar(c, edge - barW, y + ROW - 22, barW, 8, [num(row.values[0]), num(row.values[1]), num(row.values[2])]);
  }

  // --- legend, the rest of the board and the time ---
  const legendY = H - 104, labels = fr ? ["Discord", "Donjons", "JcJ"] : ["Discord", "Dungeons", "PvP"];
  const fromCols = visual.columns.slice(0, 3).map((col) => col.label);
  let lx = PAD;
  for (const [i, text] of labels.entries()) {
    c.rect(lx, legendY + 6, 22, 12, SEG[i]!, { rx: 6 });
    const w = await c.text(fromCols[i] || text, lx + 32, legendY, { size: 24, color: SUB, maxW: 160 });
    lx += 32 + w.w + 30;
  }
  if (visual.more) await c.text(visual.more, CARD_W - PAD, legendY, { size: 24, color: SUB, anchor: "r", maxW: 420 });
  if (visual.meta) await c.text(visual.meta, PAD, H - 56, { size: 24, color: SUB, maxW: CARD_W - 2 * PAD });
  return (await c.finish([await bannerLayer(card, BANNER)])).png;
}

/** ---------- Weekly honors ---------- */
const ICONS: Record<WeeklyIcon, string> = {
  points: '<path d="M20 10 H44 V26 Q44 40 32 42 Q20 40 20 26 Z"/><path d="M32 42 V52 M22 57 H42 M20 14 H10 Q10 28 20 30 M44 14 H54 Q54 28 44 30"/>',
  members: '<circle cx="24" cy="22" r="9"/><path d="M6 54 Q6 36 24 36 Q42 36 42 54 Z"/><circle cx="46" cy="26" r="7"/><path d="M40 40 Q58 38 58 54 H46"/>',
  messages: '<path d="M8 12 H56 V42 H30 L18 54 V42 H8 Z"/><path d="M18 24 H46 M18 32 H36"/>',
  voice: '<rect x="23" y="6" width="18" height="30" rx="9"/><path d="M12 30 Q12 48 32 48 Q52 48 52 30 M32 48 V58 M22 58 H42"/>',
  dungeons: '<path d="M10 58 V26 Q10 8 32 8 Q54 8 54 26 V58 Z"/><path d="M32 8 V58 M10 36 H54"/>',
  newcomers: '<circle cx="26" cy="20" r="10"/><path d="M6 56 Q6 36 26 36 Q46 36 46 56 Z"/><path d="M50 14 V34 M40 24 H60"/>',
  raids: '<path d="M32 5 C40 20 52 26 50 42 C48 54 40 59 32 59 C22 59 14 53 14 42 C14 32 22 28 26 18 C28 24 30 26 32 29 C35 20 32 12 32 5 Z"/>',
  activities: '<path d="M16 8 V58"/><path d="M16 10 H52 L43 22 L52 34 H16 Z"/>',
  reactions: '<path d="M32 54 C10 38 8 22 18 14 C25 9 31 13 32 19 C33 13 39 9 46 14 C56 22 54 38 32 54 Z"/>'
};
const ICON_ART: Partial<Record<WeeklyIcon, PodiumArt>> = { points: "icon-points", messages: "icon-messages", voice: "icon-voice", dungeons: "icon-dungeons", newcomers: "icon-newcomers", activities: "icon-activities", reactions: "icon-reactions", raids: "icon-raids" };
/** A stat icon: the painted badge when there is one for it, else the drawn outline. */
const icon = (c: CardCanvas, kind: WeeklyIcon, x: number, y: number, size: number, color: string) => {
  const art = ICON_ART[kind];
  if (art && hasArt(art)) c.raw(artImage(art, x, y, size));
  else if (hasArt("icon-points")) {
    // No painted badge for this one: the drawn outline sits in a matching gold-rimmed leather disc.
    const m = size * 0.24, k = (size - 2 * m) / 64;
    c.raw(`<circle cx="${x + size / 2}" cy="${y + size / 2}" r="${size / 2 - 2}" fill="#4a2c14" stroke="#e0a22a" stroke-width="4"/><g transform="translate(${x + m} ${y + m}) scale(${k})" fill="none" stroke="#f2c14e" stroke-width="6" stroke-linejoin="round" stroke-linecap="round">${ICONS[kind]}</g>`);
  } else c.raw(`<g transform="translate(${x} ${y}) scale(${size / 64})" fill="none" stroke="${color}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round">${ICONS[kind]}</g>`);
};

export async function renderWeeklyHonorsCard(card: ScoreCard): Promise<Buffer | null> {
  const v: WeeklyVisual | undefined = card.weekly;
  if (!v) return null;
  const { tint } = ACCENTS.weekly, top3 = v.top.slice(0, 3), stats = v.stats.slice(0, 8);
  const statCols = v.rookie ? 2 : 4, statRows = Math.max(1, Math.ceil(stats.length / statCols)), STAT_ROW = 68;
  const panelTop = BANNER + 28, heroH = 290;
  const row2 = panelTop + heroH + 24, row2H = Math.max(v.rookie ? 236 : 0, 60 + statRows * STAT_ROW + 8);
  const H = row2 + row2H + 70;
  await preloadPodiumArt();
  const c = new CardCanvas(H);
  await header(c, card, BANNER, "crown");
  const layers: OverlayOptions[] = [await bannerLayer(card, BANNER)];
  let faceLayer: OverlayOptions | undefined; // composited after the card is finished: the MVP panel is an opaque shape that would hide it
  const leftW = 540, rightX = PAD + leftW + 24, rightW = CARD_W - PAD - rightX;

  // MVP panel: gold frame, avatar or star disc, name, points.
  c.rect(PAD, panelTop, leftW, heroH, "#1d1710", { rx: 18, stroke: METALS[0]!.wash, strokeWidth: 3 });
  c.rect(PAD, panelTop, leftW, heroH, METALS[0]!.wash, { rx: 18, opacity: 0.10 });
  await c.text(v.mvp.label.toUpperCase(), PAD + 28, panelTop + 20, { size: 28, face: "title", color: METALS[0]!.text, spacing: 600, maxW: leftW - 56 });
  const face = 128, faceX = PAD + 28, faceY = panelTop + 74;
  c.raw(`<circle cx="${faceX + face / 2}" cy="${faceY + face / 2}" r="${face / 2 + 5}" fill="none" stroke="${METALS[0]!.text}" stroke-width="5"/>`);
  if (card.portrait) {
    try {
      const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${face}" height="${face}"><circle cx="${face / 2}" cy="${face / 2}" r="${face / 2}"/></svg>`);
      const image = await sharp(Buffer.from(card.portrait, "base64")).resize(face, face, { fit: "cover" }).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
      faceLayer = { input: image, left: faceX, top: faceY };
    } catch { icon(c, "points", faceX + 28, faceY + 28, 72, METALS[0]!.text); }
  } else {
    c.raw(`<circle cx="${faceX + face / 2}" cy="${faceY + face / 2}" r="${face / 2}" fill="#2a2113"/>`);
    if (hasArt("mvp-shield")) c.raw(artImage("mvp-shield", faceX - 14, faceY + (face - artHeight("mvp-shield", 156)) / 2, 156)); else c.emblem("star", faceX + 30, faceY + 30, 68, METALS[0]!.text);
  }
  const tx = faceX + face + 30, tw = PAD + leftW - 24 - tx;
  const split = splitName(v.mvp.name);
  await c.text(split.name, tx, panelTop + 78, { size: 44, face: "bold", maxW: tw });
  if (split.character) await c.text(split.character, tx, panelTop + 130, { size: 26, color: SUB, maxW: tw });
  const pts = await c.text(v.mvp.points, tx, panelTop + 166, { size: 66, face: "bold", color: METALS[0]!.text, maxW: tw - 70 });
  await c.text(v.ptsWord, tx + pts.w + 12, panelTop + 198, { size: 28, color: SUB, maxW: 70 });
  const extra = [v.mvp.note, v.mvp.times].filter(Boolean).join("  ·  ");
  if (extra) await c.text(extra, PAD + 28, panelTop + heroH - 56, { size: 26, color: SUB, maxW: leftW - 56 });

  // Top three with medals.
  c.rect(rightX, panelTop, rightW, heroH, "#ffffff", { rx: 18, opacity: 0.05 });
  await c.text(v.topLabel, rightX + 24, panelTop + 20, { size: 28, face: "title", color: tint, spacing: 600, maxW: rightW - 48 });
  const rowH = 76;
  for (const [i, row] of top3.entries()) {
    const y = panelTop + 72 + i * rowH, metal = metalFor(row.rank);
    c.rect(rightX + 12, y, rightW - 24, rowH - 8, metal.wash, { rx: 12, opacity: i === 0 ? 0.16 : 0.08 });
    await medal(c, rightX + 54, y + 36, 20, row.rank, metal);
    const sp = splitName(row.name);
    const figW = await c.width(row.points, 36, "bold");
    const nameR = rightX + rightW - 24 - figW - 50, nameX = rightX + 96;
    if (sp.character) {
      await c.text(sp.name, nameX, y + 2, { size: 30, face: "bold", maxW: nameR - nameX });
      await c.text(sp.character, nameX, y + 32, { size: 24, color: SUB, maxW: nameR - nameX });
    } else await c.text(sp.name, nameX, y + 14, { size: 32, face: "bold", maxW: nameR - nameX });
    await c.text(row.points, rightX + rightW - 66, y + 14, { size: 36, face: "bold", color: metal.text, anchor: "r", maxW: 150 });
    await c.text(v.ptsWord, rightX + rightW - 58, y + 25, { size: 24, color: SUB, maxW: 46 });
  }

  // Rookie.
  let sx = PAD, sw = CARD_W - 2 * PAD;
  if (v.rookie) {
    c.rect(PAD, row2, leftW, row2H, "#1d1710", { rx: 18, stroke: "#4fbf7a", strokeWidth: 3 });
    c.rect(PAD, row2, leftW, row2H, "#2ecc71", { rx: 18, opacity: 0.09 });
    if (hasArt("rookie-banner")) c.raw(artImage("rookie-banner", PAD + leftW - 118, row2 + 14, 92));
    else c.raw(`<g transform="translate(${PAD + leftW - 96} ${row2 + 20}) scale(1.1)" fill="none" stroke="#7fe0a2" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M32 58 V30"/><path d="M32 34 C32 20 22 14 10 14 C10 28 18 34 32 34 Z"/><path d="M32 28 C32 16 42 8 56 8 C56 22 48 28 32 28 Z"/></g>`);
    await c.text(v.rookie.label.toUpperCase(), PAD + 28, row2 + 20, { size: 28, face: "title", color: "#7fe0a2", spacing: 600, maxW: leftW - 150 });
    const rs = splitName(v.rookie.name);
    await c.text(rs.name, PAD + 28, row2 + 70, { size: 40, face: "bold", maxW: leftW - 56 });
    if (rs.character) await c.text(rs.character, PAD + 28, row2 + 118, { size: 26, color: SUB, maxW: leftW - 56 });
    const rp = await c.text(v.rookie.points, PAD + 28, row2 + 150, { size: 52, face: "bold", color: "#7fe0a2", maxW: 200 });
    await c.text(v.ptsWord, PAD + 28 + rp.w + 10, row2 + 176, { size: 26, color: SUB, maxW: 70 });
    await c.text(`${v.rookie.placeLabel} ${v.rookie.place}`, PAD + leftW - 28, row2 + 164, { size: 30, face: "bold", anchor: "r", maxW: 220 });
    await c.text(v.rookie.note, PAD + 28, row2 + row2H - 44, { size: 24, color: SUB, maxW: leftW - 56 });
    sx = rightX; sw = rightW;
  }

  // The guild's week: icon, figure, label.
  c.rect(sx, row2, sw, row2H, "#ffffff", { rx: 18, opacity: 0.05 });
  await c.text(v.statsLabel, sx + 24, row2 + 18, { size: 28, face: "title", color: tint, spacing: 600, maxW: sw - 48 });
  const cellW = (sw - 24) / statCols;
  for (const [i, s] of stats.entries()) {
    const col = i % statCols, r = Math.floor(i / statCols), x = sx + 24 + col * cellW, y = row2 + 64 + r * STAT_ROW;
    icon(c, s.icon, x - 4, y - 2, 48, tint);
    await c.text(s.value, x + 56, y - 2, { size: 34, face: "bold", maxW: cellW - 74 });
    await c.text(s.label, x + 56, y + 32, { size: 24, color: SUB, maxW: cellW - 66 });
  }
  if (card.footer) await c.text(card.footer, PAD, H - 50, { size: 24, color: SUB, maxW: CARD_W - 2 * PAD });
  const finished = (await c.finish(layers)).png;
  return faceLayer ? sharp(finished).composite([faceLayer]).png().toBuffer().catch(() => finished) : finished;
}

