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
export interface CardSpecLadderRow { rank: number; name: string; color: string; score: string; /** Dropped before the name is cut (the bracket of a dungeon-season player). */ extra?: string | undefined; record?: string | undefined; /** Rank movement: positive up, negative down, "new" a new entry (drawn as a small triangle or dot, not text). */ move?: number | "new" | undefined }
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
  /** Ticked rows (the bosses a raid killed), drawn in the left body in one or two columns instead of `rows`. */
  checks?: string[] | undefined;
  ladder?: CardSpecLadderRow[] | undefined;
  /** Names of the ladder's two figure columns, drawn as a header row (the old footer legend). */
  heads?: { record?: string | undefined; score?: string | undefined } | undefined;
  /** The word after "+N" on the line that says rows exist beyond the ones drawn ("autres", "more"). */
  moreWord?: string | undefined;
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
    await c.text(spec.label, x + 58, 42, { size: 30, face: "title", color: tint, spacing: 800, maxW: colW - 58 });
    await c.text(spec.title, x, 96, { size: 51, face: "title", maxW: colW });
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
    if (rows.length) y += 8;
    for (const row of rows) {
      const n = await c.text(row.name, x, y, { size: 32, face: "bold", color: row.color ?? INK, maxW: row.sub || row.right ? 240 : colW, ellipsis: true });
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
    const bh = ladder ? 180 : 285;
    c.gradient(0, 0, 760, bh, "h", [[0, "#000", 0.82], [0.7, "#000", 0.4], [1, "#000", 0]]);
    c.rect(0, bh, CARD_W, CARD_H - bh, "#15110d");
    c.rect(0, bh, CARD_W, 5, accent);
    c.emblem(spec.emblem, 56, 24, 44, tint);
    await c.text(spec.label, 116, 28, { size: 30, face: "title", color: tint, spacing: 800, maxW: 420 });
    if (columns) {
      await c.text(spec.title, 56, 68, { size: 53, face: "title", maxW: 420 });
      const hero = await c.text(spec.hero, 56, 134, { size: 34, face: "bold", color: spec.heroColor ?? INK, maxW: 420 });
      if (spec.heroNote) await c.text(spec.heroNote, 56 + hero.w + 16, 140, { size: 28, color: SUB, maxW: 330 });
      const colw = columns.length > 1 ? 560 : 1120, tallest = Math.max(...columns.map((col) => col.rows.length)), rowh = tallest <= 3 ? 84 : tallest === 4 ? 68 : tallest === 5 ? 58 : 50, pad = (rowh - 50) / 2, headY = bh + 10, top = bh + 44, heads = spec.heads, headed = Boolean(heads?.record || heads?.score);
      let drawn = 0;
      for (const [ci, col] of columns.entries()) {
        const x = 56 + ci * (colw + 24), edge = x + colw - 24;
        // The widest score and record of the column decide how much of the row is left for the name.
        const scoreW = Math.max(0, ...await Promise.all(col.rows.map((r) => c.width(r.score, 34, "bold"))));
        const recW = Math.max(0, ...await Promise.all(col.rows.map((r) => (r.record ? c.width(r.record, 26) : Promise.resolve(0)))));
        const recR = edge - Math.min(scoreW, 100) - 22, nameX = x + 56, nameR = recW ? recR - recW - 16 : recR;
        if (col.title) await c.text(col.title, x, headY, { size: 26, face: "bold", color: tint, maxW: colw / 2 });
        if (headed || col.title) {
          if (heads?.score) await c.text(heads.score, edge, headY + 2, { size: 24, color: SUB, anchor: "r", maxW: 120 });
          if (heads?.record && recW) await c.text(heads.record, recR, headY + 2, { size: 24, color: SUB, anchor: "r", maxW: Math.max(recW, 130) + 80 });
        }
        for (const [row, r] of col.rows.entries()) {
          const y = top + row * rowh + pad;
          c.rect(x - 8, y - 4 - pad, colw, rowh - 4, "#ffffff", { opacity: row % 2 ? 0 : 0.05, rx: 8 });
          await c.text(String(r.rank), x + 30, y + 2, { size: 30, face: "bold", color: r.rank <= 3 ? tint : SUB, anchor: "r" });
          if (r.move === "new") c.raw(`<circle cx="${x + 43}" cy="${y + 19}" r="4.5" fill="${tint}"/>`);
          else if (typeof r.move === "number" && r.move !== 0) c.raw(`<path d="${r.move > 0 ? `M${x + 38} ${y + 24} L${x + 48} ${y + 24} L${x + 43} ${y + 14} Z` : `M${x + 38} ${y + 14} L${x + 48} ${y + 14} L${x + 43} ${y + 24} Z`}" fill="${r.move > 0 ? GOOD : "#ff8a7a"}"/>`);
          // Full name first; the extra (bracket, Discord part) is shown only when it fits beside it, never instead of a letter of the name.
          const nameW = await c.text(r.name, nameX, y + 2, { size: 32, color: r.color, ellipsis: true, maxW: nameR - nameX });
          if (r.extra && nameW.right + 14 + 100 < nameR) await c.text(r.extra, nameW.right + 14, y + 6, { size: 24, color: SUB, ellipsis: true, maxW: nameR - nameW.right - 14 });
          if (r.record) await c.text(r.record, recR, y + 6, { size: 26, color: SUB, anchor: "r", maxW: recW + 4 });
          await c.text(r.score, edge, y + 2, { size: 34, face: "bold", anchor: "r", maxW: 120 });
          drawn++;
        }
      }
      const total = boards.length > 1 ? boards.reduce((n, b) => n + b.rows.length, 0) : boards.length === 1 ? boards[0]!.rows.length : (spec.ladder?.length ?? 0);
      if (total - drawn > 0) await c.text(`+${total - drawn} ${spec.moreWord ?? "more"}`, CARD_W - 56, top + 6 * rowh + 2, { size: 24, color: SUB, anchor: "r" });
      if (spec.strip) await c.text(spec.strip, 56, 586, { size: 24, color: SUB, maxW: CARD_W - 112 });
    } else {
      await c.text(spec.title, 56, 84, { size: 62, face: "title", maxW: 560 });
      const hero = await c.text(spec.hero, 56, 154, { size: 76, face: "bold", color: spec.heroColor ?? INK, maxW: 560 });
      if (spec.heroNote) await c.text(spec.heroNote, 56 + hero.w + 18, 190, { size: 30, color: SUB, maxW: Math.max(120, 740 - (56 + hero.w + 18)) });
      let y = bh + 28;
      const checks = (spec.checks ?? []).filter(Boolean);
      if (checks.length) {
        // Two columns of four from five names on; a longer list ends with "+N more". Each name keeps its own tick.
        const two = checks.length > 4, cap = two ? 8 : 4, listed = checks.length > cap ? [...checks.slice(0, cap - 1), `+${checks.length - cap + 1} ${spec.moreWord ?? "more"}`] : checks;
        const per = two ? 4 : listed.length, step = two ? 58 : 70, cw = two ? 330 : 660;
        for (const [i, name] of listed.entries()) {
          const cx = 56 + Math.floor(i / per) * (cw + 10), cy = bh + 24 + (i % per) * step, more = i === cap - 1 && checks.length > cap;
          if (!more) c.raw(`<path d="M${cx} ${cy + 20} L${cx + 11} ${cy + 31} L${cx + 30} ${cy + 8}" fill="none" stroke="${GOOD}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`);
          await c.text(name, cx + (more ? 0 : 46), cy, { size: two ? 32 : 38, face: "bold", color: more ? SUB : INK, maxW: cw - (more ? 0 : 56), ellipsis: true });
        }
      }
      const rows = checks.length ? [] : (spec.rows ?? []).slice(0, 4), withSub = rows.some((r) => r.sub), compact = rows.length > 3, sparse = rows.length > 0 && rows.length <= 2; // 4 compact rows end at y 561; 3 roomy ones at 565: the strip starts at 580
      for (const r of rows) {
        const maxW = r.right ? 450 : 620, nameSize = compact ? 30 : withSub ? (sparse ? 40 : 34) : sparse ? 44 : 38;
        c.rect(48, y - 8, 660, compact ? 58 : withSub ? (sparse ? 100 : 76) : sparse ? 82 : 66, "#ffffff", { opacity: 0.05, rx: 10 });
        if (withSub) {
          await c.text(r.name, 66, y - (compact ? 6 : 2), { size: nameSize, face: "bold", color: r.color ?? INK, maxW, ellipsis: true });
          if (r.sub) await c.text(r.sub, 66, y + (compact ? 22 : sparse ? 44 : 34), { size: compact ? 24 : 26, color: SUB, maxW });
        } else await c.text(r.name, 66, y, { size: nameSize, face: "bold", color: r.color ?? INK, maxW, ellipsis: true });
        if (r.right) await c.text(r.right, 690, y + (withSub && !compact ? 8 : 0), { size: compact ? 30 : 38, face: "bold", anchor: "r", maxW: 170 });
        y += compact ? 62 : withSub ? (sparse ? 112 : 84) : sparse ? 96 : 80;
      }
      // Each figure is a small label over its value, in one column 384 px wide: a long label is cut by measured width, never mixed up with the value.
      let sy = bh + 20;
      for (const s of (spec.stats ?? []).slice(0, 3)) {
        await c.text(s.label, 760, sy, { size: 26, color: SUB, maxW: 384 });
        await c.text(s.value, 760, sy + 28, { size: 52, face: "bold", maxW: 384 });
        sy += 88;
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
  /** A player of the posting guild: the row gets a soft gold highlight (outsiders stay neutral). */
  member?: boolean | undefined;
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
  /** Why the run earned no score, one line under the facts. */
  reason?: string | undefined;
  party: DungeonPartyRow[];
  /** Column headers (level, guild, score added this run, season total). Level, gain and total are drawn only when some player has the figure; the guild column always is. Without them no header row is drawn. */
  columns?: { level: string; guild: string; gain: string; total: string } | undefined;
  /** Role emblem look: "medal" (default) or "frame" (the approved painted frame). */
  roleStyle?: RoleStyle | undefined;
  /** The death map, drawn without a box on the painting. Only numbers (and one image buffer made by the caller from a repo file) go in; the kit builds the SVG. */
  map?: DungeonMapSpec | undefined;
  /** A PvP group: the PvP icon, the party in two columns (role icon, name in class colour, level) and the waiting list as one line under them. */
  pvp?: { waiting?: string | undefined; levelLabel: string } | undefined;
  strip?: string | undefined;
  art: Buffer;
}

/** Top right, beside the title: the party table below runs the full width of the card. */
const MAP_BOX = { left: 800, top: 18, width: 350, height: 196 };
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

/** Result card for a dungeon run: the painting full bleed, time, record, facts and the party table (role, name, level, guild, +gained, season total) across the card, the death map in the top right corner. */
export function renderDungeonCard(spec: DungeonCardSpec): Promise<RenderedCard> {
  return serial(async () => {
    const c = new CardCanvas(), { accent, tint } = ACCENTS[spec.pvp ? "battleground" : "dungeon"], x = 56, colW = 1000, headW = 722;
    c.gradient(0, 0, 1000, CARD_H, "h", [[0, "#000", 0.66], [0.8, "#000", 0.5], [1, "#000", 0.2]]);
    c.rect(0, 548, CARD_W, 82, "#060504", { opacity: 0.66 });
    c.rect(0, 546, CARD_W, 3, accent, { opacity: 0.9 });
    c.emblem(spec.pvp ? "duel" : "gate", x, 26, 36, tint);
    await c.text(spec.label, x + 50, 28, { size: 30, face: "title", color: tint, spacing: 800, maxW: headW - 50 });
    await c.text(spec.title, x, 62, { size: 48, face: "title", maxW: headW });
    const hero = await c.text(spec.hero, x, 126, { size: 68, face: "bold", color: spec.heroColor ?? GOOD, maxW: 280 });
    if (spec.heroNote) await c.text(spec.heroNote, x + hero.w + 18, 152, { size: 28, color: SUB, maxW: headW - hero.w - 18 });
    let y = 126 + hero.h + 6;
    if (spec.facts.length) { await c.text(spec.facts.join("  ·  "), x, y, { size: 28, color: INK, maxW: colW }); y += 38; }
    if (spec.reason) { await c.text(spec.reason, x, y, { size: 26, color: SUB, maxW: colW }); y += 32; }
    if (spec.map) await drawDeathMap(c, spec.map);
    if (spec.pvp) await drawPvpParty(c, spec, y, x, colW);
    else await drawDungeonParty(c, spec, y, x, colW);
    if (spec.strip) await c.text(spec.strip, x, 575, { size: 26, color: SUB, maxW: CARD_W - 112 });
    return c.finish([{ input: await fitted(spec.art), left: 0, top: 0 }]);
  });
}

const TABLE_END = 540;
async function drawDungeonParty(c: CardCanvas, spec: DungeonCardSpec, top: number, x: number, colW: number): Promise<void> {
  // Column edges (right edges for numbers). Role emblem 38 px, then name, level, guild, +gain, season total. The Guild column is always there
  // (a dash when nobody told its guild); level and the two score columns only when some player has the figure, so no header sits over empty cells.
  const party = spec.party.slice(0, 5), real = (p: DungeonPartyRow) => !p.name.startsWith("+");
  const showLevel = party.some((p) => p.level !== undefined);
  const showScore = party.some((p) => p.gain !== undefined || p.total !== undefined || p.score !== undefined);
  const headed = spec.columns !== undefined;
  let y = top + (headed ? 4 : 6);
  const base = party.length <= 2 ? 72 : party.length === 3 ? 60 : 50;
  const bodyTop = y + (headed ? 40 : 0), pitch = Math.min(base, Math.max(42, Math.floor((TABLE_END - bodyTop) / Math.max(1, party.length)))), extra = pitch - 50;
  const E = x + 50, totalR = x + colW, gainR = totalR - 140, nameW = 290;
  const levelR = showLevel ? E + nameW + 44 : E + nameW - 40, guildX = levelR + (showLevel ? 20 : 52), guildW = (showScore ? gainR - 100 : totalR) - guildX;
  c.rect(x - 14, y - 8, colW + 28, (bodyTop - y) + party.length * pitch + 6, "#000", { opacity: 0.4, rx: 12 });
  if (spec.columns) {
    const head = { size: 24, color: SUB } as const;
    if (showLevel) await c.text(spec.columns.level, levelR, y, { ...head, anchor: "r", maxW: 52 });
    await c.text(spec.columns.guild, guildX, y, { ...head, maxW: guildW });
    if (showScore) {
      await c.text(spec.columns.gain, gainR, y, { ...head, anchor: "r", maxW: 100 });
      await c.text(spec.columns.total, totalR, y, { ...head, anchor: "r", maxW: 150 });
    }
    c.rect(x, y + 30, colW, 2, "#ffffff", { opacity: 0.22 });
    y += 40;
  }
  const anyMember = party.some((p) => p.member), allMembers = party.every((p) => p.member || !real(p));
  const used = new Set<string>();
  let stripe = false;
  for (const p of party) {
    const by = y; y += extra / 2;
    // Guildmates get a soft gold band with an accent bar; the grey alternate stripe is used only when the highlight is not telling rows apart.
    if (p.member) { c.rect(x - 10, by - 8, colW + 20, pitch - 2, "#e0b84a", { opacity: 0.16, rx: 8 }); c.rect(x - 10, by - 8, 5, pitch - 2, "#f2cf63", { opacity: 0.95, rx: 2 }); }
    else if (stripe && (!anyMember || allMembers)) c.rect(x - 10, by - 8, colW + 20, pitch - 2, "#ffffff", { opacity: 0.05, rx: 8 });
    stripe = !stripe;
    if (p.role) c.raw(await roleEmblem(p.role, spec.roleStyle ?? "painted", x, y - 3, 38, used));
    const tag = guildTag(p.guild, 28).replace(/^<|>$/g, ""); // the Guild column header says what it is
    await c.text(p.name, E, y, { size: 30, face: "bold", color: p.color, ellipsis: true, maxW: real(p) ? nameW : colW - 60 });
    if (!real(p)) { y = by + pitch; continue; } // the "+N more" row has no columns
    if (p.level !== undefined && showLevel) await c.text(String(p.level), levelR, y + 1, { size: 28, color: INK, anchor: "r", maxW: 52 });
    if (tag) await c.text(tag, guildX, y + 3, { size: 24, color: SUB, ellipsis: true, maxW: guildW });
    else await c.text("—", guildX, y, { size: 30, face: "bold", color: SUB, maxW: guildW });
    if (showScore) {
      // A rated player shows what this run added and the season total; "—" when there is no score (calibration, unrated).
      const unscored = p.gain === 0 && (!p.total || p.total === "0");
      if (p.gain !== undefined && !unscored) await c.text(`+${p.gain}`, gainR, y, { size: 30, face: "bold", color: p.gain > 0 ? GOOD : SUB, anchor: "r", maxW: 100 });
      else await c.text("—", gainR, y, { size: 30, face: "bold", color: SUB, anchor: "r", maxW: 100 });
      const total = p.total === "0" && unscored ? undefined : p.total ?? p.score;
      if (total) await c.text(total, totalR, y, { size: 30, face: "bold", color: INK, anchor: "r", maxW: 108 });
      else await c.text("—", totalR, y, { size: 30, face: "bold", color: SUB, anchor: "r", maxW: 108 });
    }
    y = by + pitch;
  }
}

/** The PvP group's party: two columns, filled column by column, so a group of ten shows every name; the waiting list is one line under them. */
async function drawPvpParty(c: CardCanvas, spec: DungeonCardSpec, top: number, x: number, colW: number): Promise<void> {
  const waiting = spec.pvp?.waiting, max = waiting ? 10 : 12;
  const all = spec.party.filter((p) => !p.name.startsWith("+")), shown = all.length > max ? all.slice(0, max - 1) : all;
  const moreWord = spec.party.find((p) => p.name.startsWith("+"))?.name.split(" ").slice(1).join(" ");
  const rows: DungeonPartyRow[] = shown.length < all.length ? [...shown, { name: `+${all.length - shown.length} ${moreWord || "more"}`, color: SUB }] : shown;
  const perCol = Math.max(1, Math.ceil(rows.length / 2)), pitch = perCol <= 4 ? 56 : perCol <= 5 ? 50 : 46, gap = 24, w = (colW - gap) / 2, y0 = top + 8;
  c.rect(x - 14, y0 - 8, colW + 28, perCol * pitch + 6, "#000", { opacity: 0.4, rx: 12 });
  const used = new Set<string>();
  for (const [i, p] of rows.entries()) {
    const cx = x + Math.floor(i / perCol) * (w + gap), slot = i % perCol, y = y0 + slot * pitch + (pitch - 46) / 2;
    if (slot % 2 === 1) c.rect(cx - 8, y0 + slot * pitch - 6, w + 16, pitch - 2, "#ffffff", { opacity: 0.05, rx: 8 });
    if (p.role) c.raw(await roleEmblem(p.role, spec.roleStyle ?? "painted", cx, y - 1, 38, used));
    const more = p.name.startsWith("+");
    const lvl = p.level !== undefined ? `${spec.pvp?.levelLabel ?? "Lv"} ${p.level}` : "";
    const lw = lvl ? Math.min(110, await c.width(lvl, 26)) : 0;
    await c.text(p.name, cx + (more ? 0 : 50), y, { size: 30, face: "bold", color: p.color, ellipsis: true, maxW: w - (more ? 0 : 50) - lw - 14 });
    if (lvl) await c.text(lvl, cx + w, y + 3, { size: 26, color: SUB, anchor: "r", maxW: 110 });
  }
  if (waiting) await c.text(waiting, x, y0 + perCol * pitch + 4, { size: 26, color: SUB, maxW: colW });
}
