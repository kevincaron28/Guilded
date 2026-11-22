import sharp from "sharp";
import { ACCENTS, CARD_H, CARD_W, CardCanvas, GOOD, INK, SUB, type AccentKey, type EmblemKind } from "./card-kit.js";
import type { RenderedCard } from "./card-layouts-next.js";

/**
 * Layouts that replace the old framed layout (16 Nov 2026, audit item 1): the daily recap, the raid-night check, the record card,
 * the roster, the server statistics, the anniversary, the achievement cards and the website's character card. They sit on the same
 * kit as the other banner cards (card-kit.ts: nothing under 24 px, upright text, contrast measured), and are sized to their content:
 * rows grow when there are few of them, panels are only as tall as their rows, and what does not fit becomes one "+N more" row.
 *  - renderBodyCard: banner, an optional sentence, a strip of up to four figures, then one to three panels of rows.
 *  - renderBarsCard: banner, bars (classes, one segment per level band) on the left, tiles (professions, figures) on the right.
 */
export interface BodyRow { name: string; color?: string | undefined; sub?: string | undefined; right?: string | undefined; rightColor?: string | undefined; /** Inner markup of a 64 x 64 badge. */ icon?: string | undefined }
export interface BodySection { title?: string | undefined; rows: BodyRow[]; /** Rows not shown by the caller, drawn as "+N <moreLabel>". */ more?: number | undefined; moreLabel?: string | undefined; /** Relative column width (default 1). */ weight?: number | undefined }
export interface BodyTile { value: string; label: string; color?: string | undefined }
export interface BodyCardSpec {
  type: AccentKey; emblem: EmblemKind; label: string; title: string;
  hero?: string | undefined; heroColor?: string | undefined; heroNote?: string | undefined;
  /** One sentence in large type under the banner (an empty state, or an achievement's description). */
  note?: string | undefined;
  tiles?: BodyTile[] | undefined; sections?: BodySection[] | undefined;
  /** A medallion in the banner (inner markup of a 64 x 64 badge) and its glow colour. */
  badge?: { icon: string; color: string } | undefined;
  /** A square picture (any image buffer), drawn round at the banner's right. */
  portrait?: Buffer | undefined;
  /** Small coloured text under the portrait (a Discord role). */
  chip?: { text: string; color: string } | undefined;
  strip?: string | undefined;
  /** Cut the picture to its content (never over 630 px). Cards posted in Discord do; the website's share images stay 1200 x 630 (social previews). */
  fit?: boolean | undefined;
  art: Buffer;
}

const BANNER = 172, BODY_TOP = BANNER + 17, PAD = 56, FULL_W = CARD_W - 2 * PAD;

/** Neutral painting for a card that has none: a warm glow on the dark card colour. */
export function plainArt(glow = "#6b5322"): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}"><defs><radialGradient id="g" cx=".22" cy=".15" r=".95"><stop offset="0" stop-color="${glow}" stop-opacity=".55"/><stop offset="1" stop-color="#0b0907"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
}

async function bannerLayer(art: Buffer, bh: number) {
  const full = await sharp(art).resize(CARD_W, CARD_H, { fit: "cover" }).removeAlpha().toBuffer();
  return sharp(full).extract({ left: 0, top: Math.round((CARD_H - bh) * 0.5), width: CARD_W, height: bh }).toBuffer();
}

/** Words wrapped to at most `maxLines` lines of about `chars` characters; the last line ends in an ellipsis when text is left over. */
export function wrapLines(body: string, chars: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of body.split(/\s+/).filter(Boolean)) {
    if (line && [...line].length + 1 + [...word].length > chars) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines), rest = `${kept[maxLines - 1]} ${lines[maxLines]}`;
  kept[maxLines - 1] = [...rest].length > chars ? `${[...rest].slice(0, chars - 1).join("").trimEnd()}…` : rest;
  return kept;
}

/** The header every layout here shares: the painting as a banner, the emblem and type label, the card title, one hero line. */
async function drawBanner(c: CardCanvas, spec: Pick<BodyCardSpec, "type" | "emblem" | "label" | "title" | "hero" | "heroColor" | "heroNote" | "badge" | "portrait" | "chip">): Promise<void> {
  const { accent, tint } = ACCENTS[spec.type], aside = Boolean(spec.badge || spec.portrait), maxW = spec.badge && spec.portrait ? 700 : aside ? 780 : 1000;
  c.gradient(0, 0, 820, BANNER, "h", [[0, "#000", 0.82], [0.7, "#000", 0.4], [1, "#000", 0]]);
  c.rect(0, BANNER, CARD_W, CARD_H - BANNER, "#15110d");
  c.rect(0, BANNER, CARD_W, 5, accent);
  c.emblem(spec.emblem, PAD, 26, 44, tint);
  await c.text(spec.label, PAD + 60, 32, { size: 30, face: "title", color: tint, spacing: 800, maxW: maxW - 60 });
  await c.text(spec.title, PAD, 70, { size: 52, face: "title", maxW: Math.min(maxW, 760) });
  if (spec.hero) {
    const hero = await c.text(spec.hero, PAD, 120, { size: 38, face: "bold", color: spec.heroColor ?? INK, maxW: spec.heroNote ? 460 : maxW });
    if (spec.heroNote) await c.text(spec.heroNote, PAD + hero.w + 18, 128, { size: 28, color: SUB, maxW: Math.max(160, maxW - hero.w - 18) });
  }
}

const RIGHT_X = CARD_W - PAD;
async function drawAside(c: CardCanvas, spec: Pick<BodyCardSpec, "badge" | "portrait" | "chip" | "type">): Promise<OverlayLayer[]> {
  const layers: OverlayLayer[] = [];
  const portraitRight = spec.badge ? RIGHT_X - 196 : RIGHT_X;
  if (spec.badge) {
    const cx = RIGHT_X - 88, cy = BANNER / 2 + 2, { color, icon } = spec.badge;
    c.raw(`<defs><radialGradient id="bglow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${color}" stop-opacity=".6"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient></defs><circle cx="${cx}" cy="${cy}" r="118" fill="url(#bglow)"/><circle cx="${cx}" cy="${cy}" r="82" fill="#15110d" fill-opacity=".7" stroke="${color}" stroke-opacity=".7" stroke-width="3"/><svg x="${cx - 76}" y="${cy - 76}" width="152" height="152" viewBox="0 0 64 64">${icon}</svg>`);
  }
  if (spec.portrait) {
    const size = spec.badge ? 96 : spec.chip ? 112 : 124, left = portraitRight - size, top = spec.badge ? 38 : spec.chip ? 14 : 24;
    try {
      const face = await sharp(spec.portrait).resize(size, size, { fit: "cover" }).composite([{ input: Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}"/></svg>`), blend: "dest-in" }]).png().toBuffer();
      c.raw(`<circle cx="${left + size / 2}" cy="${top + size / 2}" r="${size / 2 + 3}" fill="none" stroke="${ACCENTS[spec.type].tint}" stroke-width="3"/>`);
      layers.push({ input: face, left, top });
    } catch { /* an unreadable picture is skipped */ }
    if (spec.chip) {
      // A pill behind the rank, so this one word on the painting never makes the contrast guard darken the whole card.
      const w = Math.min(260, await c.width(spec.chip.text, 24)) + 24;
      c.rect(left + size / 2 - w / 2, top + size + 2, w, 36, "#000", { opacity: 0.72, rx: 18 });
      await c.text(spec.chip.text, left + size / 2, top + size + 6, { size: 24, color: spec.chip.color, anchor: "c", maxW: 260 });
    }
  } else if (spec.chip) {
    const w = Math.min(300, await c.width(spec.chip.text, 26)) + 24;
    c.rect(portraitRight - w + 12, 34, w, 40, "#000", { opacity: 0.72, rx: 20 });
    await c.text(spec.chip.text, portraitRight, 40, { size: 26, color: spec.chip.color, anchor: "r", maxW: 300 });
  }
  return layers;
}
type OverlayLayer = { input: Buffer; left: number; top: number };

/** The painting's own layer is added by the caller; portraits ride on top of the shapes, so the finished card is composited once more. */
async function finishWithLayers(c: CardCanvas, art: Buffer, extra: OverlayLayer[]): Promise<RenderedCard> {
  const done = await c.finish([{ input: await bannerLayer(art, BANNER), left: 0, top: 0 }, ...extra]);
  return done;
}

export function renderBodyCard(spec: BodyCardSpec): Promise<RenderedCard> {
  return (async () => {
    const c = new CardCanvas(), { tint } = ACCENTS[spec.type];
    await drawBanner(c, spec);
    const extra = await drawAside(c, spec);
    const bottom = spec.strip ? 566 : 598;
    let y = BODY_TOP, end = BODY_TOP;
    if (spec.note) {
      const lines = wrapLines(spec.note, 58, 3);
      y += 14;
      for (const line of lines) { const t = await c.text(line, PAD, y, { size: 38, color: INK, maxW: FULL_W }); y += t.h + 2; }
      y += 16; end = y;
    }
    const tiles = (spec.tiles ?? []).filter((t) => t.value).slice(0, 4);
    if (tiles.length) {
      const gap = 16, tw = Math.floor((FULL_W - gap * (tiles.length - 1)) / tiles.length);
      for (const [i, tile] of tiles.entries()) {
        const x = PAD + i * (tw + gap);
        c.rect(x, y, tw, 78, "#ffffff", { opacity: 0.06, rx: 12 });
        c.rect(x, y + 10, 5, 58, tile.color ?? tint, { rx: 2 });
        await c.text(tile.label, x + 20, y + 3, { size: 24, color: SUB, maxW: tw - 32 });
        await c.text(tile.value, x + 20, y + 30, { size: 38, face: "bold", color: tile.color ?? INK, maxW: tw - 32 });
      }
      y += 78 + 12; end = y;
    }
    const sections = (spec.sections ?? []).filter((s) => s.rows.length || s.more).slice(0, 3);
    if (sections.length) {
      const gap = 24, weights = sections.map((s) => s.weight ?? 1), total = weights.reduce((a, b) => a + b, 0);
      const widths = weights.map((w) => Math.floor(((FULL_W - gap * (sections.length - 1)) * w) / total));
      const titled = sections.some((s) => s.title), header = titled ? 42 : 8, avail = bottom - y - header - 8;
      const icons = sections.some((s) => s.rows.some((r) => r.icon)), withSub = sections.some((s) => s.rows.some((r) => r.sub));
      const minPitch = icons || withSub ? 64 : 44, capacity = Math.max(1, Math.floor(avail / minPitch));
      // A section longer than the room shows its first rows and one "+N more" row; the rest were already counted by the caller.
      const prepared = sections.map((s) => {
        let rows = s.rows, more = s.more ?? 0;
        if (rows.length + (more ? 1 : 0) > capacity) {
          // With a "more" label the hidden rows are counted in one last row; without one the list is just cut where it stops fitting.
          if (s.moreLabel) { const keep = Math.max(1, capacity - 1); more += rows.length - keep; rows = rows.slice(0, keep); }
          else { rows = rows.slice(0, Math.max(1, capacity - (more ? 1 : 0))); }
        }
        return { ...s, rows, more };
      });
      const lines = Math.max(...prepared.map((s) => s.rows.length + (s.more ? 1 : 0)));
      const pitch = Math.min(icons ? 78 : withSub ? 84 : 60, Math.floor(avail / lines));
      const panelH = header + lines * pitch + 8;
      let x = PAD;
      for (const [si, section] of prepared.entries()) {
        const w = widths[si]!;
        c.rect(x, y, w, panelH, "#ffffff", { opacity: 0.04, rx: 12 });
        c.rect(x, y, w, panelH, "none", { rx: 12, stroke: "#ffffff", strokeWidth: 1 });
        if (section.title) await c.text(section.title, x + 18, y + 8, { size: 26, face: "bold", color: tint, maxW: w - 36 });
        const rowsTop = y + header;
        for (const [ri, row] of section.rows.entries()) await drawRow(c, row, x, rowsTop + ri * pitch, w, pitch, ri % 2 === 1);
        if (section.more) await drawRow(c, { name: `+${section.more}${section.moreLabel ? ` ${section.moreLabel}` : ""}`, color: SUB }, x, rowsTop + section.rows.length * pitch, w, pitch, section.rows.length % 2 === 1);
        x += w + gap;
      }
      end = y + panelH;
    }
    // The card is as tall as its content (at most 630): a recap with one duel is not a tall black card.
    const height = spec.fit ? Math.min(CARD_H, Math.max(340, end + (spec.strip ? 70 : 24))) : CARD_H;
    if (spec.strip) await c.text(spec.strip, PAD, height >= CARD_H ? 580 : end + 18, { size: 26, color: SUB, maxW: FULL_W });
    const done = await finishWithLayers(c, spec.art, extra);
    return height >= CARD_H ? done : { ...done, png: await sharp(done.png).extract({ left: 0, top: 0, width: CARD_W, height }).png().toBuffer() };
  })();
}

async function drawRow(c: CardCanvas, r: BodyRow, x: number, y: number, w: number, pitch: number, zebra: boolean): Promise<void> {
  const big = pitch >= 72, nameSize = big ? 34 : 30, subSize = big ? 26 : 24, rightSize = big ? 34 : 30;
  if (zebra) c.rect(x + 6, y, w - 12, pitch - 2, "#ffffff", { opacity: 0.05, rx: 8 });
  const nameH = Math.round(nameSize * 1.15), subH = Math.round(subSize * 1.15), content = r.sub ? nameH + subH : nameH;
  const top = y + Math.max(0, Math.round((pitch - content) / 2)) - 1;
  const iconSize = r.icon ? Math.min(64, pitch - 10) : 0, tx = x + 18 + (iconSize ? iconSize + 12 : 0), room = x + w - 16 - tx;
  if (r.icon) c.raw(`<svg x="${x + 14}" y="${y + Math.round((pitch - iconSize) / 2)}" width="${iconSize}" height="${iconSize}" viewBox="0 0 64 64">${r.icon}</svg>`);
  let rightW = 0;
  if (r.right) { const t = await c.text(r.right, x + w - 16, top, { size: rightSize, face: "bold", color: r.rightColor ?? INK, anchor: "r", maxW: Math.min(170, Math.floor(room * 0.45)) }); rightW = t.w + 14; }
  await c.text(r.name, tx, top, { size: nameSize, face: "bold", color: r.color ?? INK, maxW: Math.max(60, room - rightW), ellipsis: true });
  if (r.sub) await c.text(r.sub, tx, top + nameH, { size: subSize, color: SUB, maxW: room, ellipsis: true });
}

// ---------------------------------------------------------------------------------------------------------------------------------

export interface BarSpec { name: string; color: string; /** One count per segment (a level band); darker segments are higher bands. */ parts: number[]; total: number }
export interface BarsCardSpec {
  type: AccentKey; emblem: EmblemKind; label: string; title: string; hero?: string | undefined; heroNote?: string | undefined;
  barsTitle?: string | undefined; legend?: string[] | undefined; bars: BarSpec[]; otherLabel?: string | undefined;
  rightTitle?: string | undefined; tiles: { name: string; value: string; side?: string | undefined; color?: string | undefined }[]; rightNote?: string | undefined;
  strip?: string | undefined; art: Buffer;
}

const SEGMENT_OPACITY = [0.4, 0.62, 0.82, 1];
export function renderBarsCard(spec: BarsCardSpec): Promise<RenderedCard> {
  return (async () => {
    const c = new CardCanvas(), { tint } = ACCENTS[spec.type];
    await drawBanner(c, { ...spec, heroColor: INK });
    const top = BODY_TOP, bottom = spec.strip ? 566 : 598, h = bottom - top;
    // Left panel: bars by class.
    const lx = PAD, lw = 600;
    c.rect(lx, top, lw, h, "#ffffff", { opacity: 0.04, rx: 12 });
    let bars = spec.bars.filter((b) => b.total > 0);
    const CAP = 9;
    if (bars.length > CAP) {
      const rest = bars.slice(CAP - 1);
      bars = [...bars.slice(0, CAP - 1), { name: `${spec.otherLabel ?? "+"} (${rest.length})`, color: "#bfc9bd", parts: [], total: rest.reduce((sum, b) => sum + b.total, 0) }];
    }
    let hy = top + 8;
    if (spec.legend?.length) {
      let x = lx + 18;
      for (const [i, label] of spec.legend.slice(0, 4).entries()) {
        c.rect(x, hy + 7, 16, 16, tint, { opacity: SEGMENT_OPACITY[i] ?? 1, rx: 3 });
        const t = await c.text(label, x + 24, hy, { size: 24, color: SUB, maxW: 110 });
        x += 24 + t.w + 22;
      }
      hy += 40;
    } else if (spec.barsTitle) { await c.text(spec.barsTitle, lx + 18, hy, { size: 26, face: "bold", color: tint, maxW: lw - 36 }); hy += 40; }
    const rows = Math.max(1, bars.length), pitch = Math.min(52, Math.floor((bottom - hy - 8) / rows)), size = pitch >= 44 ? 30 : pitch >= 36 ? 28 : 26;
    const nameW = 200, barX = lx + 18 + nameW + 12, barMax = lx + lw - 18 - 64 - barX, max = Math.max(1, ...bars.map((b) => b.total));
    for (const [i, b] of bars.entries()) {
      const y = hy + i * pitch;
      await c.text(b.name, barX - 12, y + (pitch - size * 1.22) / 2, { size, face: "bold", color: legibleColor(b.color), anchor: "r", maxW: nameW, ellipsis: true });
      const fullW = Math.max(6, Math.round((b.total / max) * barMax)), barH = Math.max(14, Math.min(26, pitch - 14)), by = y + Math.round((pitch - barH) / 2);
      if (b.parts.some((p) => p > 0)) {
        const sum = b.parts.reduce((a, p) => a + p, 0) || 1;
        let x = barX;
        for (const [s, count] of b.parts.entries()) {
          const w = count ? Math.max(3, Math.round((count / sum) * fullW)) : 0;
          if (w) c.rect(x, by, w, barH, b.color, { opacity: SEGMENT_OPACITY[s] ?? 1 });
          x += w;
        }
        await c.text(String(b.total), x + 10, y + (pitch - size * 1.22) / 2, { size, color: INK, maxW: 80 });
      } else {
        c.rect(barX, by, fullW, barH, b.color, { opacity: 0.85 });
        await c.text(String(b.total), barX + fullW + 10, y + (pitch - size * 1.22) / 2, { size, color: INK, maxW: 80 });
      }
    }
    // Right panel: tiles, two per row, then one line of small print.
    const rx = lx + lw + 20, rw = CARD_W - PAD - rx;
    c.rect(rx, top, rw, h, "#ffffff", { opacity: 0.04, rx: 12 });
    let ry = top + 8;
    if (spec.rightTitle) { await c.text(spec.rightTitle, rx + 18, ry, { size: 26, face: "bold", color: tint, maxW: rw - 36 }); ry += 42; }
    const noteLines = spec.rightNote ? wrapLines(spec.rightNote, 38, 2) : [], noteH = noteLines.length ? noteLines.length * 30 + 10 : 0, tileGap = 10, tw = Math.floor((rw - 36 - tileGap) / 2);
    const tileRows = Math.max(1, Math.min(4, Math.floor((bottom - ry - noteH - 8) / 72)));
    const tiles = spec.tiles.slice(0, tileRows * 2), rowsUsed = Math.ceil(tiles.length / 2) || 1;
    const th = Math.min(84, Math.floor((bottom - ry - noteH - 8 - (rowsUsed - 1) * tileGap) / rowsUsed));
    for (const [i, tile] of tiles.entries()) {
      const x = rx + 18 + (i % 2) * (tw + tileGap), y = ry + Math.floor(i / 2) * (th + tileGap);
      c.rect(x, y, tw, th, "#000000", { opacity: 0.32, rx: 10, stroke: tile.color ?? tint, strokeWidth: 1.5 });
      await c.text(tile.name, x + 12, y + 5, { size: 26, face: "bold", color: INK, maxW: tw - 24, ellipsis: true });
      const v = await c.text(tile.value, x + 12, y + 5 + 30, { size: 30, face: "bold", color: tile.color ?? GOOD, maxW: tw - 24 });
      if (tile.side) await c.text(tile.side, x + tw - 12, y + 5 + 33, { size: 26, color: SUB, anchor: "r", maxW: Math.max(40, tw - 36 - v.w) });
    }
    for (const [i, line] of noteLines.entries()) await c.text(line, rx + 18, bottom - noteH + 4 + i * 30, { size: 24, color: SUB, maxW: rw - 36, ellipsis: true });
    if (spec.strip) await c.text(spec.strip, PAD, 580, { size: 26, color: SUB, maxW: FULL_W });
    return finishWithLayers(c, spec.art, []);
  })();
}

/** Class colours can be near black on the dark card (death knight red, rogue yellow is fine): mix dark ones toward white so names stay readable. */
function legibleColor(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return SUB;
  const ch = [0, 2, 4].map((i) => parseInt(m[1]!.slice(i, i + 2), 16));
  const luma = (0.299 * ch[0]! + 0.587 * ch[1]! + 0.114 * ch[2]!) / 255, mix = luma < 0.45 ? (0.45 - luma) * 1.6 : 0;
  return `#${ch.map((v) => Math.round(v + (255 - v) * mix).toString(16).padStart(2, "0")).join("")}`;
}

export interface UnlockHeroBadge { name: string; color: string; /** Inner markup of a 64 x 64 badge. */ icon: string; tier?: string | undefined; group?: string | undefined; detail?: string | undefined }
export interface UnlockHeroSpec {
  label: string; player: string; unlocks: UnlockHeroBadge[];
  progress?: { text: string; ratio: number } | undefined;
  portrait?: Buffer | undefined; chip?: { text: string; color: string } | undefined; art: Buffer;
}

/** One medallion: a glow in the tier colour, a dark disc with a ring, and the badge picture inside. */
function medallion(id: string, cx: number, cy: number, ring: number, color: string, icon: string): string {
  const size = Math.round(ring * 1.84), glow = Math.round(ring * 1.45);
  return `<defs><radialGradient id="${id}" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${color}" stop-opacity=".65"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient></defs>`
    + `<circle cx="${cx}" cy="${cy}" r="${glow}" fill="url(#${id})"/><circle cx="${cx}" cy="${cy}" r="${ring}" fill="#15110d" fill-opacity=".72" stroke="${color}" stroke-opacity=".8" stroke-width="3"/>`
    + `<svg x="${cx - size / 2}" y="${cy - size / 2}" width="${size}" height="${size}" viewBox="0 0 64 64">${icon}</svg>`;
}

/**
 * The achievement-unlocked card with the badge as the hero (owner, 17 Nov 2026): the painting full bleed, the badge large in the
 * middle, the achievement's name in its tier colour under it, then who earned it, the tier and the description, and the catalogue
 * progress as a thin bar along the bottom. Two or three unlocks stand side by side; more use the list layout (renderBodyCard).
 */
export async function renderUnlockHero(spec: UnlockHeroSpec): Promise<RenderedCard> {
  const c = new CardCanvas(), { tint } = ACCENTS.achievement, mid = CARD_W / 2, shown = spec.unlocks.slice(0, 3);
  // Shade only where text sits, so the painting stays bright: a soft edge round the card, a pill behind the label, and a band under the badge.
  c.raw(`<defs><radialGradient id="vig" cx="50%" cy="42%" r="78%"><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></radialGradient></defs><rect width="${CARD_W}" height="${CARD_H}" fill="url(#vig)"/>`);
  c.rect(mid - 230, 16, 460, 50, "#000", { opacity: 0.78, rx: 25 });
  c.gradient(0, 236, CARD_W, CARD_H - 236, "v", [[0, "#000", 0], [0.16, "#000", 0.84], [1, "#000", 0.88]]);
  await c.text(spec.label, mid, 26, { size: 28, face: "title", color: tint, spacing: 800, anchor: "c", maxW: 700 });
  if (shown.length === 1) {
    const u = shown[0]!;
    c.raw(medallion("hero0", mid, 192, 112, u.color, u.icon));
    await c.text(u.name, mid, 318, { size: 60, face: "title", color: u.color, anchor: "c", maxW: 1060 });
    // "WoW Forever" is the only edition left, so a group that just says it adds nothing next to the name.
    const group = u.group && !/^(wow )?forever$/i.test(u.group.trim()) ? u.group : undefined;
    await c.text([spec.player, u.tier, group].filter(Boolean).join("  ·  "), mid, 396, { size: 32, face: "bold", anchor: "c", maxW: 1060 });
    if (u.detail) {
      // A description that needs two lines is split near the middle, not left with one orphan word on the second.
      const lines = wrapLines(u.detail, u.detail.length > 70 ? Math.min(70, Math.ceil(u.detail.length / 2) + 6) : 70, 2);
      for (const [i, line] of lines.entries()) await c.text(line, mid, 444 + i * 36, { size: 28, color: SUB, anchor: "c", maxW: 1080 });
    }
  } else {
    const step = shown.length === 2 ? 420 : 370;
    for (const [i, u] of shown.entries()) {
      const cx = Math.round(mid + (i - (shown.length - 1) / 2) * step);
      c.raw(medallion(`hero${i}`, cx, 186, 92, u.color, u.icon));
      await c.text(u.name, cx, 300, { size: 32, face: "bold", color: u.color, anchor: "c", maxW: step - 30 });
      const meta = [u.tier, u.group].filter(Boolean).join(" · ");
      if (meta) await c.text(meta, cx, 342, { size: 24, color: SUB, anchor: "c", maxW: step - 30 });
    }
    await c.text(spec.player, mid, 410, { size: 38, face: "title", anchor: "c", maxW: 1000 });
  }
  if (spec.progress) {
    await c.text(spec.progress.text, mid, 532, { size: 26, color: SUB, anchor: "c", maxW: 1000 });
    const w = 560, x = mid - w / 2, fill = Math.max(8, Math.round(w * Math.min(1, Math.max(0, spec.progress.ratio))));
    c.rect(x, 574, w, 16, "#ffffff", { opacity: 0.18, rx: 8 });
    c.rect(x, 574, fill, 16, "#ffd100", { rx: 8 });
  }
  const layers: OverlayLayer[] = [];
  if (spec.portrait) {
    const size = 104, left = PAD - 16, top = 24;
    try {
      const face = await sharp(spec.portrait).resize(size, size, { fit: "cover" }).composite([{ input: Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}"/></svg>`), blend: "dest-in" }]).png().toBuffer();
      c.raw(`<circle cx="${left + size / 2}" cy="${top + size / 2}" r="${size / 2 + 3}" fill="none" stroke="${tint}" stroke-width="3"/>`);
      layers.push({ input: face, left, top });
    } catch { /* an unreadable picture is skipped */ }
    if (spec.chip) {
      // The rank sits on the painting: a pill of its own behind it, or the contrast guard darkens the whole card for this one word.
      const w = Math.min(240, await c.width(spec.chip.text, 24)) + 24;
      // Clear of the avatar's ring (3 px) with a gap of its own, centred under it, but never past the card's left edge (22 Nov 2026 audit:
      // a long rank such as "Goldmaking Moderator" was cut off).
      const pillX = Math.max(16, left + size / 2 - w / 2);
      c.rect(pillX, top + size + 14, w, 36, "#000", { opacity: 0.78, rx: 18 });
      await c.text(spec.chip.text, pillX + w / 2, top + size + 18, { size: 24, color: spec.chip.color, anchor: "c", maxW: 240 });
    }
  }
  const art = await sharp(spec.art).resize(CARD_W, CARD_H, { fit: "cover" }).removeAlpha().toBuffer();
  return c.finish([{ input: art, left: 0, top: 0 }, ...layers]);
}
