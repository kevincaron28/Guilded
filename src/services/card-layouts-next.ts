import sharp from "sharp";
import { MAP_GRID, mapView } from "./score-card.js";
import { ACCENTS, CARD_H, CARD_W, CardCanvas, GOOD, INK, SUB, type AccentKey, type EmblemKind, type TextReport } from "./card-kit.js";

/**
 * The two redesigned layouts (owner-approved 13 Nov 2026), drawn from a neutral spec so every existing card definition can be
 * mapped onto them without changing the stored definition:
 *  - renderResultCard: "art first". The painting full bleed, text only on its dark left third (type label, title, ONE hero line,
 *    names, at most three stats, a short list), a slim bottom strip for the small print.
 *  - renderBannerCard: "banner and body" for data cards. The painting as a banner (45 % of the height, 30 % for a ladder), a flat
 *    body below with rows (left) and stats (right), or a two-column ladder.
 * Nothing here is wired to a card yet.
 */
export interface CardLine { text: string; color?: string | undefined }
export interface CardSpecRow { name: string; color?: string | undefined; sub?: string | undefined; right?: string | undefined }
export interface CardSpecLadderRow { rank: number; name: string; color: string; score: string; record?: string | undefined }
export interface CardSpecStat { value: string; label: string }
export interface NextCardSpec {
  type: AccentKey; emblem: EmblemKind;
  /** Short upper-case type label next to the emblem ("DUEL", "WEEKLY REPORT"). */
  label: string;
  /** The italic card title ("Warsong Gulch", "This week"). */
  title: string;
  hero: string; heroColor?: string | undefined; heroNote?: string | undefined;
  names?: CardLine[] | undefined;
  stats?: CardSpecStat[] | undefined;
  rows?: CardSpecRow[] | undefined;
  ladder?: CardSpecLadderRow[] | undefined;
  /** Small print along the bottom (date, context). Messages carry the legal wording, not the image. */
  strip?: string | undefined;
  /** The painting: any image buffer; it is fitted to 1200x630 here. */
  art: Buffer;
  /** For the banner: which part of the painting's height to show, 0 (top) to 1 (bottom). Default 0.5. */
  bannerFocus?: number | undefined;
}
export interface RenderedCard { png: Buffer; report: TextReport[] }

// Concurrency and caching are scoreCardPng's (score-card.ts): it holds at most two distinct renders and caches by content, and the
// new layouts are only ever called from inside it, so old and new renders share ONE bound on the 1 GB server. No queue of our own.
const serial = <T,>(job: () => Promise<T>): Promise<T> => job();

const fitted = (art: Buffer) => sharp(art).resize(CARD_W, CARD_H, { fit: "cover" }).removeAlpha().jpeg({ quality: 90 }).toBuffer();

const RESULT_LIMIT = 540;
export function renderResultCard(spec: NextCardSpec): Promise<RenderedCard> {
  return serial(async () => {
    const c = new CardCanvas(), { accent, tint } = ACCENTS[spec.type], x = 56, colW = 410;
    c.gradient(0, 0, 720, CARD_H, "h", [[0, "#000", 0.88], [0.6, "#000", 0.7], [1, "#000", 0]]);
    c.rect(0, 548, CARD_W, 82, "#060504", { opacity: 0.66 });
    c.rect(0, 546, CARD_W, 3, accent, { opacity: 0.9 });
    c.emblem(spec.emblem, x, 36, 44, tint);
    await c.text(spec.label, x + 58, 42, { size: 26, face: "bold", color: tint, spacing: 1500, maxW: colW - 58 });
    await c.text(spec.title, x, 96, { size: 44, face: "serif", maxW: colW });
    let y = 154;
    const hero = await c.text(spec.hero, x, y, { size: 84, face: "bold", color: spec.heroColor ?? GOOD, maxW: colW });
    y += hero.h + 2;
    if (spec.heroNote) { const n = await c.text(spec.heroNote, x, y, { size: 30, color: SUB, maxW: colW }); y += n.h + 8; }
    // Vertical budget: everything must end above RESULT_LIMIT (the strip starts at 546). Priority: stats, then names, then rows; what does not fit is dropped.
    let room = RESULT_LIMIT - y - 12;
    const stats = (spec.stats ?? []).slice(0, Math.min(3, Math.max(0, Math.floor(room / 50))));
    room -= stats.length * 50;
    const names = (spec.names ?? []).slice(0, Math.min(3, Math.max(0, Math.floor(room / 40))));
    room -= names.length * 40;
    const rows = (spec.rows ?? []).slice(0, Math.min(4, Math.max(0, Math.floor(room / 44))));
    for (const line of names) { await c.text(line.text, x, y, { size: 32, color: line.color ?? INK, maxW: colW }); y += 40; }
    y += 12;
    for (const stat of stats) {
      const a = await c.text(stat.value, x, y, { size: 40, face: "bold", maxW: 200 });
      await c.text(stat.label, x + a.w + 14, y + 9, { size: 26, color: SUB, maxW: colW - a.w - 14 });
      y += 50;
    }
    for (const row of rows) {
      const n = await c.text(row.name, x, y, { size: 32, face: "bold", color: row.color ?? INK, maxW: 240 });
      if (row.sub) await c.text(row.sub, x + n.w + 12, y + 3, { size: 28, color: SUB, maxW: 130 });
      if (row.right) await c.text(row.right, x + colW, y, { size: 32, face: "bold", anchor: "r", maxW: 140 });
      y += 44;
    }
    if (spec.strip) await c.text(spec.strip, x, 575, { size: 26, color: SUB, maxW: CARD_W - 112 });
    return c.finish([{ input: await fitted(spec.art), left: 0, top: 0 }]);
  });
}

export function renderBannerCard(spec: NextCardSpec): Promise<RenderedCard> {
  return serial(async () => {
    const c = new CardCanvas(), { accent, tint } = ACCENTS[spec.type];
    const ladder = spec.ladder && spec.ladder.length > 0 ? spec.ladder.slice(0, 12) : null;
    const bh = ladder ? 190 : 285;
    c.gradient(0, 0, 760, bh, "h", [[0, "#000", 0.82], [0.7, "#000", 0.4], [1, "#000", 0]]);
    c.rect(0, bh, CARD_W, CARD_H - bh, "#15110d");
    c.rect(0, bh, CARD_W, 5, accent);
    c.emblem(spec.emblem, 56, 28, 44, tint);
    await c.text(spec.label, 116, 34, { size: 26, face: "bold", color: tint, spacing: 1500, maxW: 420 });
    if (ladder) {
      await c.text(spec.title, 56, 84, { size: 46, face: "serif", maxW: 420 });
      const hero = await c.text(spec.hero, 56, 130, { size: 40, face: "bold", color: spec.heroColor ?? INK, maxW: 420 });
      if (spec.heroNote) await c.text(spec.heroNote, 56 + hero.w + 16, 140, { size: 28, color: SUB, maxW: 330 });
      const perColumn = ladder.length > 6 ? 6 : ladder.length, colw = ladder.length > 6 ? 560 : 1120, rowh = 56;
      for (const [i, r] of ladder.entries()) {
        const col = Math.floor(i / perColumn), row = i % perColumn, x = 56 + col * (colw + 24), y = bh + 22 + row * rowh;
        c.rect(x - 8, y - 4, colw, rowh - 6, "#ffffff", { opacity: row % 2 ? 0 : 0.05, rx: 8 });
        await c.text(String(r.rank), x + 30, y + 2, { size: 30, face: "bold", color: r.rank <= 3 ? tint : SUB, anchor: "r" });
        await c.text(r.name, x + 50, y + 2, { size: 32, color: r.color, maxW: colw - 50 - (r.record ? 250 : 130) });
        if (r.record) await c.text(r.record, x + colw - 130, y + 6, { size: 26, color: SUB, anchor: "r", maxW: 110 });
        await c.text(r.score, x + colw - 24, y + 2, { size: 34, face: "bold", anchor: "r", maxW: 100 });
      }
      if (spec.strip) await c.text(spec.strip, 56, 586, { size: 24, color: SUB, maxW: CARD_W - 112 });
    } else {
      await c.text(spec.title, 56, 84, { size: 54, face: "serif", maxW: 560 });
      await c.text(spec.hero, 56, 154, { size: 76, face: "bold", color: spec.heroColor ?? INK, maxW: 560 });
      let y = bh + 28;
      for (const r of (spec.rows ?? []).slice(0, 3)) { // 3 rows end at y 553: the strip starts at 580
        c.rect(48, y - 8, 660, 66, "#ffffff", { opacity: 0.05, rx: 10 });
        const n = await c.text(r.name, 66, y, { size: 38, face: "bold", color: r.color ?? INK, maxW: 330 });
        if (r.sub) await c.text(r.sub, 66 + n.w + 14, y + 8, { size: 28, color: SUB, maxW: 150 });
        if (r.right) await c.text(r.right, 690, y, { size: 38, face: "bold", anchor: "r", maxW: 170 });
        y += 80;
      }
      let sy = bh + 28;
      for (const s of (spec.stats ?? []).slice(0, 3)) {
        const a = await c.text(s.value, 760, sy - 4, { size: 60, face: "bold", maxW: 220 });
        await c.text(s.label, 760 + a.w + 16, sy + 16, { size: 30, color: SUB, maxW: 1144 - 760 - a.w - 16 });
        sy += 92;
      }
      if (spec.strip) await c.text(spec.strip, 56, 580, { size: 26, color: SUB, maxW: CARD_W - 112 });
    }
    // The banner: the painting at full width, cropped vertically around `bannerFocus`.
    const full = await sharp(spec.art).resize(CARD_W, CARD_H, { fit: "cover" }).removeAlpha().toBuffer();
    const top = Math.round((CARD_H - bh) * Math.min(1, Math.max(0, spec.bannerFocus ?? 0.5)));
    const banner = await sharp(full).extract({ left: 0, top, width: CARD_W, height: bh }).toBuffer();
    return c.finish([{ input: banner, left: 0, top: 0 }]);
  });
}

/** A guild name seen by the recorder's game client: display text only. Trimmed, clipped to 24 characters, shown as "<Name>". Empty when unknown. */
export function guildTag(guild: string | null | undefined, max = 24): string {
  const g = (guild ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
  if (!g) return "";
  const chars = [...g];
  return `<${chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : g}>`;
}

export interface DungeonPartyRow { name: string; color: string; role: "tank" | "healer" | "dps"; score?: string | undefined; guild?: string | null | undefined }
/** Traced floor cells (200 x 200 grid, key = column * 200 + row), death points as 0..1 map fractions, optionally the dungeon's own map image (PNG buffer). */
export interface DungeonMapSpec { cells: readonly number[]; points: readonly { x: number; y: number }[]; image?: Buffer | undefined }
export interface DungeonCardSpec {
  /** "DUNGEON · HEROIC" style label. */
  label: string;
  /** Dungeon name. */
  title: string;
  /** The time (or "Failed"/"Abandoned"). */
  hero: string; heroColor?: string | undefined;
  /** The record line under the time ("New guild record, was 24:10"). */
  heroNote?: string | undefined;
  /** "2 deaths", "Score 1840": shown together on one line. */
  facts: string[];
  party: DungeonPartyRow[];
  /** The death map, drawn without a box on the painting. Only numbers (and one image buffer made by the caller from a repo file) go in; the kit builds the SVG. */
  map?: DungeonMapSpec | undefined;
  strip?: string | undefined;
  art: Buffer;
}

const ROLE_COLOR = { tank: "#7fb2ff", healer: "#86e66a", dps: "#ff9a8a" } as const;
const ROLE_GLYPH = {
  tank: '<path d="M32 6 L54 14 V32 Q54 50 32 60 Q10 50 10 32 V14 Z"/>',
  healer: '<path d="M24 8 H40 V24 H56 V40 H40 V56 H24 V40 H8 V24 H24 Z"/>',
  dps: '<path d="M14 54 L50 14 M44 8 L56 20 M10 50 L18 58"/>'
} as const;

const MAP_BOX = { left: 790, top: 300, width: 340, height: 226 };
const num = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);
async function drawDeathMap(c: CardCanvas, map: DungeonMapSpec): Promise<void> {
  const { left, top, width, height } = MAP_BOX;
  const cells = map.cells.filter((k) => Number.isInteger(k) && k >= 0 && k < MAP_GRID * MAP_GRID).slice(0, 12_000);
  const points = map.points.slice(0, 200).map((p) => ({ x: num(p.x, 0, 1), y: num(p.y, 0, 1) }));
  if (!cells.length && !points.length) return;
  let svg = `<defs><radialGradient id="heat"><stop offset="0" stop-color="#ff3b1f" stop-opacity=".8"/><stop offset="1" stop-color="#ff3b1f" stop-opacity="0"/></radialGradient></defs>`;
  if (cells.length) {
    const view = mapView(cells, points, left, top, width, height), halo: string[] = [], floor: string[] = [];
    for (const key of cells) {
      const { x, y } = view.at((Math.floor(key / MAP_GRID) + 0.5) / MAP_GRID, ((key % MAP_GRID) + 0.5) / MAP_GRID);
      halo.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(view.radius + 2.4).toFixed(2)}"/>`);
      floor.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${view.radius.toFixed(2)}"/>`);
    }
    svg += `<g fill="#000" fill-opacity=".55">${halo.join("")}</g><g fill="#efe1b8" fill-opacity=".92">${floor.join("")}</g>`;
    for (const p of points) { const { x, y } = view.at(p.x, p.y); svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="18" fill="url(#heat)"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.4" fill="#ffd0c8"/>`; }
  } else {
    if (map.image) {
      const img = await sharp(map.image).resize(width, height, { fit: "contain", background: "#00000000" }).png().toBuffer();
      svg += `<image x="${left}" y="${top}" width="${width}" height="${height}" opacity=".7" href="data:image/png;base64,${img.toString("base64")}"/>`;
    }
    for (const p of points) { const x = left + p.x * width, y = top + p.y * height; svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="22" fill="url(#heat)"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.4" fill="#ffd0c8"/>`; }
  }
  c.raw(svg);
}

/** Result card for a dungeon run: the painting full bleed, the left half carries time, record, facts and the party, the death map floats on the painting. */
export function renderDungeonCard(spec: DungeonCardSpec): Promise<RenderedCard> {
  return serial(async () => {
    const c = new CardCanvas(), { accent, tint } = ACCENTS.dungeon, x = 56, colW = 610;
    c.gradient(0, 0, 830, CARD_H, "h", [[0, "#000", 0.9], [0.82, "#000", 0.82], [1, "#000", 0]]);
    c.rect(0, 548, CARD_W, 82, "#060504", { opacity: 0.66 });
    c.rect(0, 546, CARD_W, 3, accent, { opacity: 0.9 });
    c.emblem("gate", x, 30, 40, tint);
    await c.text(spec.label, x + 54, 34, { size: 26, face: "bold", color: tint, spacing: 1500, maxW: colW - 54 });
    await c.text(spec.title, x, 78, { size: 44, face: "serif", maxW: colW });
    const hero = await c.text(spec.hero, x, 126, { size: 84, face: "bold", color: spec.heroColor ?? GOOD, maxW: 300 });
    if (spec.heroNote) await c.text(spec.heroNote, x + hero.w + 18, 164, { size: 28, color: SUB, maxW: colW - hero.w - 18 });
    let y = 126 + hero.h + 18;
    if (spec.facts.length) { await c.text(spec.facts.join("  ·  "), x, y, { size: 30, color: INK, maxW: colW }); y += 46; }
    y += 6;
    const pitch = 40;
    for (const p of spec.party.slice(0, 5)) {
      c.raw(`<g transform="translate(${x} ${y + 3}) scale(${26 / 64})" fill="none" stroke="${ROLE_COLOR[p.role]}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">${ROLE_GLYPH[p.role]}</g>`);
      const scoreW = p.score ? 80 : 0;
      const tag = guildTag(p.guild);
      const n = await c.text(p.name, x + 38, y, { size: 30, face: "bold", color: p.color, maxW: tag ? 230 : colW - 38 - scoreW });
      if (tag) await c.text(tag, x + 38 + 244, y + 3, { size: 24, color: SUB, maxW: colW - 38 - 244 - scoreW - 10 });
      if (p.score) await c.text(p.score, x + colW, y, { size: 30, face: "bold", anchor: "r", maxW: scoreW });
      y += pitch; void n;
    }
    if (spec.map) await drawDeathMap(c, spec.map);
    if (spec.strip) await c.text(spec.strip, x, 575, { size: 26, color: SUB, maxW: CARD_W - 112 });
    return c.finish([{ input: await fitted(spec.art), left: 0, top: 0 }]);
  });
}
