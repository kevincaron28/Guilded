import sharp from "sharp";
import { roleEmblem, type RoleStyle } from "./card-roles.js";
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
export interface CardSpecLadderRow { rank: number; name: string; color: string; score: string; record?: string | undefined; /** Rank movement: positive up, negative down, "new" a new entry (drawn as a small triangle or dot, not text). */ move?: number | "new" | undefined }
export interface CardSpecBoard { title?: string | undefined; rows: CardSpecLadderRow[] }
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
  /** Several boards side by side (at most two, six rows each, each under its own title). Wins over `ladder`. */
  boards?: CardSpecBoard[] | undefined;
  /** Small print along the bottom (date, context). Messages carry the legal wording, not the image. */
  strip?: string | undefined;
  /** The painting: any image buffer; it is fitted to 1200x630 here. */
  art: Buffer;
  /** For the banner: which part of the painting's height to show, 0 (top) to 1 (bottom). Default 0.5. */
  bannerFocus?: number | undefined;
}
export interface RenderedCard { png: Buffer; report: TextReport[]; scrim: number }

// Concurrency and caching are scoreCardPng's (score-card.ts): it holds at most two distinct renders and caches by content, and the
// new layouts are only ever called from inside it, so old and new renders share ONE bound on the 1 GB server. No queue of our own.
const serial = <T,>(job: () => Promise<T>): Promise<T> => job();

const fitted = (art: Buffer) => sharp(art).resize(CARD_W, CARD_H, { fit: "cover" }).removeAlpha().jpeg({ quality: 90 }).toBuffer();

const RESULT_LIMIT = 540;
/** One board of up to twelve rows: one wide column up to six rows, else two columns of six. */
function splitRows(rows: CardSpecLadderRow[], title?: string): CardSpecBoard[] {
  return rows.length > 6 ? [{ title, rows: rows.slice(0, 6) }, { rows: rows.slice(6, 12) }] : [{ title, rows }];
}
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
    y += hero.h + 10;
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
    // Ladder columns: several boards side by side (two at most), or one board of up to twelve rows split six and six.
    const boards = (spec.boards ?? []).filter((x) => x.rows.length > 0).slice(0, 2);
    const flat = spec.ladder && spec.ladder.length > 0 ? spec.ladder.slice(0, 12) : null;
    const columns: CardSpecBoard[] | null = boards.length > 1 ? boards.map((x) => ({ ...x, rows: x.rows.slice(0, 6) }))
      : boards.length === 1 ? splitRows(boards[0]!.rows.slice(0, 12), boards[0]!.title) : flat ? splitRows(flat) : null;
    const ladder = columns !== null;
    const bh = ladder ? 190 : 285;
    c.gradient(0, 0, 760, bh, "h", [[0, "#000", 0.82], [0.7, "#000", 0.4], [1, "#000", 0]]);
    c.rect(0, bh, CARD_W, CARD_H - bh, "#15110d");
    c.rect(0, bh, CARD_W, 5, accent);
    c.emblem(spec.emblem, 56, 28, 44, tint);
    await c.text(spec.label, 116, 34, { size: 26, face: "bold", color: tint, spacing: 1500, maxW: 420 });
    if (columns) {
      await c.text(spec.title, 56, 84, { size: 46, face: "serif", maxW: 420 });
      const hero = await c.text(spec.hero, 56, 130, { size: 40, face: "bold", color: spec.heroColor ?? INK, maxW: 420 });
      if (spec.heroNote) await c.text(spec.heroNote, 56 + hero.w + 16, 140, { size: 28, color: SUB, maxW: 330 });
      const colw = columns.length > 1 ? 560 : 1120, titled = columns.some((col) => col.title), rowh = titled ? 52 : 56, top = bh + 18 + (titled ? 34 : 0);
      for (const [ci, col] of columns.entries()) {
        const x = 56 + ci * (colw + 24);
        if (col.title) await c.text(col.title, x, bh + 14, { size: 26, face: "bold", color: tint, maxW: colw - 10 });
        const recW = colw > 600 ? 300 : 130;
        for (const [row, r] of col.rows.entries()) {
          const y = top + row * rowh;
          c.rect(x - 8, y - 4, colw, rowh - 6, "#ffffff", { opacity: row % 2 ? 0 : 0.05, rx: 8 });
          await c.text(String(r.rank), x + 30, y + 2, { size: 30, face: "bold", color: r.rank <= 3 ? tint : SUB, anchor: "r" });
          if (r.move === "new") c.raw(`<circle cx="${x + 43}" cy="${y + 19}" r="4.5" fill="${tint}"/>`);
          else if (typeof r.move === "number" && r.move !== 0) c.raw(`<path d="${r.move > 0 ? `M${x + 38} ${y + 24} L${x + 48} ${y + 24} L${x + 43} ${y + 14} Z` : `M${x + 38} ${y + 14} L${x + 48} ${y + 14} L${x + 43} ${y + 24} Z`}" fill="${r.move > 0 ? GOOD : "#ff8a7a"}"/>`);
          await c.text(r.name, x + 56, y + 2, { size: 32, color: r.color, maxW: colw - 56 - 24 - 110 - (r.record ? recW + 12 : 0) });
          if (r.record) await c.text(r.record, x + colw - 140, y + 6, { size: 26, color: SUB, anchor: "r", maxW: recW });
          await c.text(r.score, x + colw - 24, y + 2, { size: 34, face: "bold", anchor: "r", maxW: 100 });
        }
      }
      if (spec.strip) await c.text(spec.strip, 56, 586, { size: 24, color: SUB, maxW: CARD_W - 112 });
    } else {
      await c.text(spec.title, 56, 84, { size: 54, face: "serif", maxW: 560 });
      const hero = await c.text(spec.hero, 56, 154, { size: 76, face: "bold", color: spec.heroColor ?? INK, maxW: 560 });
      if (spec.heroNote) await c.text(spec.heroNote, 56 + hero.w + 18, 190, { size: 30, color: SUB, maxW: Math.max(120, 740 - (56 + hero.w + 18)) });
      let y = bh + 28;
      const rows = (spec.rows ?? []).slice(0, 4), withSub = rows.some((r) => r.sub), compact = rows.length > 3; // 4 compact rows end at y 561; 3 roomy ones at 565: the strip starts at 580
      for (const r of rows) {
        const maxW = r.right ? 450 : 620, nameSize = compact ? 30 : withSub ? 34 : 38;
        c.rect(48, y - 8, 660, compact ? 58 : withSub ? 76 : 66, "#ffffff", { opacity: 0.05, rx: 10 });
        if (withSub) {
          await c.text(r.name, 66, y - (compact ? 6 : 2), { size: nameSize, face: "bold", color: r.color ?? INK, maxW });
          if (r.sub) await c.text(r.sub, 66, y + (compact ? 22 : 34), { size: compact ? 24 : 26, color: SUB, maxW });
        } else await c.text(r.name, 66, y, { size: nameSize, face: "bold", color: r.color ?? INK, maxW });
        if (r.right) await c.text(r.right, 690, y + (withSub && !compact ? 8 : 0), { size: compact ? 30 : 38, face: "bold", anchor: "r", maxW: 170 });
        y += compact ? 62 : withSub ? 84 : 80;
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

export interface DungeonPartyRow {
  name: string; color: string; role?: "tank" | "healer" | "dps" | undefined;
  /** The one-figure score column of cards queued before 9.3.2 (drawn in the total column). */
  score?: string | undefined; guild?: string | null | undefined;
  /** 9.3.2: level, what this run added to the player's season score (0 draws "+0" in grey; undefined draws nothing) and the season total. */
  level?: number | undefined; gain?: number | undefined; total?: string | undefined;
}
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
  /** Column headers (level, guild, score added this run, season total). Without them no header row is drawn. */
  columns?: { level: string; guild: string; gain: string; total: string } | undefined;
  /** Role emblem look: "medal" (default) or "frame" (the approved painted frame). */
  roleStyle?: RoleStyle | undefined;
  /** The death map, drawn without a box on the painting. Only numbers (and one image buffer made by the caller from a repo file) go in; the kit builds the SVG. */
  map?: DungeonMapSpec | undefined;
  strip?: string | undefined;
  art: Buffer;
}

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

/** Result card for a dungeon run: the painting full bleed, the left side carries time, record, facts and the party table (role, name, level, guild, +gained, season total), the death map floats on the painting. */
export function renderDungeonCard(spec: DungeonCardSpec): Promise<RenderedCard> {
  return serial(async () => {
    const c = new CardCanvas(), { accent, tint } = ACCENTS.dungeon, x = 56, colW = 722;
    c.gradient(0, 0, 870, CARD_H, "h", [[0, "#000", 0.9], [0.84, "#000", 0.82], [1, "#000", 0]]);
    c.rect(0, 548, CARD_W, 82, "#060504", { opacity: 0.66 });
    c.rect(0, 546, CARD_W, 3, accent, { opacity: 0.9 });
    c.emblem("gate", x, 26, 36, tint);
    await c.text(spec.label, x + 50, 28, { size: 26, face: "bold", color: tint, spacing: 1500, maxW: colW - 50 });
    await c.text(spec.title, x, 66, { size: 42, face: "serif", maxW: colW });
    const hero = await c.text(spec.hero, x, 114, { size: 68, face: "bold", color: spec.heroColor ?? GOOD, maxW: 280 });
    if (spec.heroNote) await c.text(spec.heroNote, x + hero.w + 18, 140, { size: 28, color: SUB, maxW: colW - hero.w - 18 });
    let y = 114 + hero.h + 8;
    if (spec.facts.length) { await c.text(spec.facts.join("  ·  "), x, y, { size: 28, color: INK, maxW: colW }); y += 40; }
    // Column edges (right edges for numbers). Emblem 38 px, then name, level, guild, +gain, season total.
    const E = x + 38 + 12, nameW = 214, levelR = E + nameW + 44, guildX = levelR + 14, gainR = x + colW - 104, totalR = x + colW, guildW = gainR - 82 - guildX;
    const party = spec.party.slice(0, 5), pitch = 50;
    if (spec.columns) {
      y += 4;
      const head = { size: 24, color: SUB } as const;
      await c.text(spec.columns.level, levelR, y, { ...head, anchor: "r", maxW: 44 });
      await c.text(spec.columns.guild, guildX, y, { ...head, maxW: guildW });
      await c.text(spec.columns.gain, gainR, y, { ...head, anchor: "r", maxW: 100 });
      await c.text(spec.columns.total, totalR, y, { ...head, anchor: "r", maxW: 108 });
      c.rect(x, y + 30, colW, 2, "#ffffff", { opacity: 0.22 });
      y += 40;
    } else y += 6;
    const used = new Set<string>();
    let stripe = false;
    for (const p of party) {
      if (stripe) c.rect(x - 10, y - 8, colW + 20, pitch - 2, "#ffffff", { opacity: 0.05, rx: 8 });
      stripe = !stripe;
      if (p.role) c.raw(await roleEmblem(p.role, spec.roleStyle ?? "medal", x, y - 3, 38, used));
      const tag = guildTag(p.guild).replace(/^<|>$/g, ""); // the Guild column header says what it is
      const hasCols = p.level !== undefined || p.gain !== undefined || p.total !== undefined || p.score !== undefined || !!tag;
      await c.text(p.name, E, y, { size: 30, face: "bold", color: p.color, maxW: hasCols ? nameW : colW - 46 });
      if (p.level !== undefined) await c.text(String(p.level), levelR, y + 1, { size: 28, color: INK, anchor: "r", maxW: 44 });
      if (tag) await c.text(tag, guildX, y + 3, { size: 24, color: SUB, maxW: guildW });
      if (p.gain !== undefined) await c.text(`+${p.gain}`, gainR, y, { size: 30, face: "bold", color: p.gain > 0 ? GOOD : SUB, anchor: "r", maxW: 100 });
      const total = p.total ?? p.score;
      if (total) await c.text(total, totalR, y, { size: 30, face: "bold", color: INK, anchor: "r", maxW: 108 });
      y += pitch;
    }
    if (spec.map) await drawDeathMap(c, spec.map);
    if (spec.strip) await c.text(spec.strip, x, 575, { size: 26, color: SUB, maxW: CARD_W - 112 });
    return c.finish([{ input: await fitted(spec.art), left: 0, top: 0 }]);
  });
}
