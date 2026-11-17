import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import type { WebResponse } from "./web-app.js";
import type { RosterVisual } from "./roster-visual.js";
import type { DungeonArtTheme } from "./dungeon-art.js";
import { cardAltText } from "./card-alt.js";
import { cardBackdropArt, BANNER_HEIGHT, type CardBackdrop } from "./card-backdrop.js";
import { withBadgeImages } from "./badge-art.js";
import { cardDateTime } from "./card-format.js";
import type { RecordVisual } from "./record-card.js";
import type { TrendVisual } from "./member-trend.js";

/**
 * A 1200x630 share card, two columns. Left: what it is (eyebrow, title, subtitle), one big headline
 * stat and up to two smaller ones, trust badges. Right: a panel of rows (a run's party, or a
 * character's recent runs). Fine print along the bottom.
 */
export interface CardStat { label: string; value: string; note?: string | undefined; accent?: "gold" | "green" | "red" | undefined }
export interface CardRow { name: string; color?: string | undefined; sub?: string | undefined; right?: string | undefined; rightTone?: "gold" | "green" | "red" | undefined; icon?: string | undefined }
export interface CardBadge { text: string; tone?: "ok" | "warn" | "muted" }
/** One achievement on an unlock card: `icon` is badge artwork (64x64 grid), `color` the tier colour. */
export interface CardUnlock { name: string; group: string; detail: string; tier: string; color: string; icon: string }
export interface CardProgress { label: string; value: number; max: number; note?: string | undefined }
export interface CardTierCount { label: string; color: string; count: number }
/**
 * The shared leaderboard ("ladder") layout, used by every ranking card (race to 60, dungeon season, duels, battlegrounds).
 * Columns are listed left to right after the rank and name; `kind: "bar"` draws the row's `bar` instead of a value and
 * `kind: "move"` draws the row's `move` as an up/down arrow. The first `primary` column is drawn in gold.
 */
export interface LadderColumn { label: string; width: number; kind?: "text" | "bar" | "move" | undefined; primary?: boolean | undefined }
export interface LadderRow { rank: number; name: string; color: string; sub?: string | undefined; values: string[];
  bar?: { value: number; max: number } | undefined;
  /** Movement shown in a "move" column: a positive number is up (green), negative down (red), "new" a new entry. */
  move?: number | "new" | undefined; moveLabel?: string | undefined }
export interface LadderBoard { title?: string | undefined; rows: LadderRow[] }
export interface LadderVisual { columns: LadderColumn[]; boards: LadderBoard[];
  /** Under the title, right-aligned: the season and the updated-at time (already formatted). */
  meta?: string | undefined; empty?: string | undefined }
/**
 * The optional `unlocks` list switches a card to the achievement-unlocked layout (a hero badge for one,
 * a list or grid for several). Every field after `footer` is optional so card definitions queued before
 * it existed still draw: without `unlocks` the two-column layout above is used.
 */
export interface ScoreCard { eyebrow?: string; title: string; subtitle: string; stats: CardStat[]; rowsLabel?: string; rows?: CardRow[]; badges?: CardBadge[]; footer: string;
  /** Added at delivery from Discord, never stored: a base64 PNG avatar and the member's highest role. */
  portrait?: string; rank?: { label: string; color: string };
  unlocks?: CardUnlock[]; unlocksMore?: number; moreLabel?: string; progress?: CardProgress; tierCounts?: CardTierCount[];
  /** 8.5: the roster picture (class counts by level band + profession grid, roster-visual.ts); switches to its own layout. */
  roster?: RosterVisual; rosterProfessionsLabel?: string;
  /** The roster card's words: one and several crafters, the "no crafter" lead-in, and the name of the merged last class row. */
  rosterLabels?: { crafter: string; crafters: string; none: string; other?: string };
  /** Leaderboard layout (every ranking card): medals, class colours, aligned columns; the image grows with the row count. */
  ladder?: LadderVisual;
  /** 9.1: the dungeon completion layout (themed art, party with role icons, optional death map). */
  dungeon?: DungeonVisual;
  /** 9.1: the daily recap layout (painted scene, a stats strip, up to three section panels of rows). */
  recap?: RecapVisual;
  /** 9.1: the new guild record card, drawn by card-next-recap.ts. */
  record?: RecordVisual;
  /** Officer member-trend card (member-trend.ts), drawn by member-trend-card.ts. */
  trend?: TrendVisual;
  /** 9.2: an approved painting for this card (card-backdrop.ts, site/card-art/<kind>/<key>.jpg). Cards without it, or without a file, draw as before. */
  backdrop?: CardBackdrop }

/** A recap: up to three panels, each a title and up to five rows (name in its colour, a line under it, a value on the right). */
export interface RecapVisual { theme: DungeonArtTheme; sections: { title: string; rows: CardRow[] }[] }

export type DungeonMotif = "cave" | "fire" | "sea" | "keep" | "mine" | "thorn";
/**
 * One party member on a dungeon card. `guild` false marks an outsider; `color` is the class colour. `score` is the
 * right-hand number when the card has a score column (`scoreLabel`), with an optional `scoreNote` under it (+35).
 */
export interface DungeonCardMember { name: string; color: string; role?: "TANK" | "HEALER" | "DPS" | undefined; roleLabel?: string | undefined; sub?: string | undefined; guild: boolean;
  score?: string | undefined; scoreNote?: string | undefined;
  /** 9.3.2: the player's level, the score this run added to their season score (0 when it added nothing) and their season total. Only set when the bot knows them: never estimated. */
  level?: number | undefined; gain?: number | undefined; total?: number | undefined;
  /** 9.1: the addon's name for this player, so delivery can find the guild character's picture (card-pictures.ts). */
  character?: string | undefined;
  /** 9.3: the guild the recorder's game client showed for a player outside this server's guild (display text only: clipped, never used for links, ranking or matching). */
  guildName?: string | undefined;
  /** Added at delivery, never stored: the character's picture thumb (base64 WebP), drawn in place of the role disc. */
  portrait?: string | undefined }
/**
 * Dungeon art is painted from `theme` (a scene for the dungeon, or a motif on cards queued before scenes existed, and a
 * seed), never copied from the game: see dungeon-art.ts. `deathPoints` are 0..1 positions on a flat map (x right, y down)
 * and switch the death map on.
 */
export interface DungeonVisual { theme: DungeonArtTheme; party: DungeonCardMember[]; scoreLabel?: string | undefined;
  /** 9.3.2: column headers of the party rows (level, score added this run, season total). */ columns?: { level: string; gain: string; total: string } | undefined;
  guildLabel: string; outsiderLabel: string; moreLabel: string; /** Slug of the dungeon; `site/dungeon-maps/<mapKey>.png` is the map the deaths are drawn on, when that file exists. */ mapKey?: string; deathPoints?: { x: number; y: number }[]; deathMapLabel?: string;
  /** The traced outline of the death map's floor: walked cells of a 200 x 200 grid (key = column * 200 + row), see dungeon-map-grid.ts. */
  mapOutline?: { map: number; cells: number[] } }

const fontfile = fileURLToPath(new URL("../../site/fonts/source-serif-latin.ttf", import.meta.url));
const images = new Map<string, Buffer>();
const pending = new Map<string, Promise<Buffer>>();
/**
 * The bundled card font is a Latin subset, so decorative symbols (a fleur-de-lis around a guild name, say),
 * emoji and invisible joiners draw as empty boxes. Drop them; letters, accents, digits and ordinary
 * punctuation stay. When something was dropped the leftover gaps are tidied.
 */
export const drawable = (text: string) => {
  // Styled names ("𝓕𝓻𝓾𝓶𝓹𝔂™") are read as plain letters first: NFKC turns the mathematical alphabets into Latin and ™ into TM.
  // Latin text and ordinary punctuation (U+0020-024F, U+2010-2027) stay as written (NFKC would turn "…" into "...").
  text = text.replace(/[^\u0020-\u024F\u2010-\u2027]/gu, c => c.normalize("NFKC"));
  const kept = text.replace(/[\p{So}\p{Sk}\p{Cf}\p{Co}\p{Cn}\uFE00-\uFE0F]/gu, c => (c.codePointAt(0)! <= 0xff ? c : ""));
  // "Name(Character)" reads as "Name (Character)": a space before an opening bracket glued to a word ("(s)" plural marks excepted).
  const spaced = (value: string) => value.replace(/([^\s(])\((?!e?s?\)|x\))/gu, "$1 (");
  return spaced(kept === text ? text : kept.replace(/\s{2,}/g, " ").trim());
};
const escapeText = (text: string) => drawable(text).replace(/\p{Cc}/gu, " ").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
const clip = (text: string, max: number) => { text = drawable(text); const chars = [...text]; return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : text; };

interface Theme { bg: string; bar: string; panel: string; edge: string; ink: string; muted: string; gold: string; green: string; red: string; frame: string | null;
  ok: { fill: string; edge: string }; warn: { fill: string; edge: string }; quiet: { fill: string; edge: string } }
// WoW Classic's tooltip look: dark brown stone, parchment text, bright gold, bronze trim.
const th: Theme = { bg: "#120d08", bar: "#ffd100", panel: "#21180f", edge: "#6b5322", ink: "#f5e6c0", muted: "#b9a77f", gold: "#ffd100", green: "#6fdc4f", red: "#ff6a52", frame: "#8a6a2b",
  ok: { fill: "#1b2b14", edge: "#4c8a35" }, warn: { fill: "#3a2a0d", edge: "#a67c1a" }, quiet: { fill: "#21180f", edge: "#5a4721" } };
// Blizzard's class colours, keyed by the lowercase letters of the class name.
const CLASS_COLOR: Record<string, string> = { warrior: "#c79c6e", paladin: "#f58cba", hunter: "#abd473", rogue: "#fff569", priest: "#ffffff", deathknight: "#c41f3b",
  shaman: "#0070de", mage: "#69ccf0", warlock: "#9482c9", monk: "#00ff96", druid: "#ff7d0a", demonhunter: "#a330c9", evoker: "#33937f" };
export const classColor = (name: string | null | undefined) => CLASS_COLOR[(name ?? "").toLowerCase().replace(/[^a-z]/g, "")] ?? "#bfc9bd";

interface Layer { input: Buffer; left: number; top: number }
const rect = (x: number, y: number, w: number, h: number, fill: string, edge?: string, r = 12) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"${edge ? ` stroke="${edge}" stroke-width="1.5"` : ""}/>`;

const MIN_FIT = 0.62;
async function drawText(markup: string, size: number, maxWidth: number) {
  const { data, info } = await sharp({ text: { text: markup, font: `Source Serif 4 ${size}`, fontfile, width: maxWidth, rgba: true, wrap: "none" } }).png().toBuffer({ resolveWithObject: true });
  return { input: data, width: info.width, height: info.height };
}
/**
 * Rendered text sized to its own content, so pills can be fitted around it, and never wider than `maxWidth`: sharp does not
 * enforce the width on unwrapped text, so a long name used to run into the next panel. Too wide, it is drawn smaller (down to
 * MIN_FIT of its size, on the same baseline), then cut with an ellipsis. `fixed` (names in a column) skips the shrinking: one size, cut by measured width.
 */
async function text(markup: string, size: number, maxWidth: number, fixed = false) {
  // sharp refuses a text with nothing visible (an empty value, or an emoji the card font drops): draw nothing rather than fail the card.
  if (!markup.replace(/<[^>]*>/g, "").replace(/&#160;|&nbsp;/g, " ").trim()) {
    const blank = await sharp({ create: { width: 1, height: Math.round(size * 1.3), channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    return { input: blank, width: 1, height: Math.round(size * 1.3) };
  }
  const full = await drawText(markup, size, maxWidth);
  if (full.width <= maxWidth) return full;
  const smaller = fixed ? size : Math.max(Math.ceil(size * MIN_FIT), Math.floor((size * maxWidth) / full.width));
  let fitted = await drawText(markup, smaller, maxWidth);
  const parts = /^(<span[^>]*>)([\s\S]*)(<\/span>)$/.exec(markup);
  if (fitted.width > maxWidth && parts) {
    // One span of escaped text: drop characters (an entity counts as one) until it fits with an ellipsis.
    const chars = parts[2]!.match(/&[a-z]+;|&#\d+;|[\s\S]/gu) ?? [];
    let low = 0, high = chars.length - 1, best: typeof fitted | null = null;
    while (low <= high) {
      const keep = (low + high) >> 1, attempt = await drawText(`${parts[1]}${chars.slice(0, keep).join("").trimEnd()}…${parts[3]}`, smaller, maxWidth);
      if (attempt.width <= maxWidth) { best = attempt; low = keep + 1; } else high = keep - 1;
    }
    if (best) fitted = best;
  }
  // Keep the baseline where the full-size text had it, so a shrunk title does not jump up.
  const lift = Math.max(0, Math.round((full.height - fitted.height) * 0.8));
  if (!lift) return fitted;
  const input = await sharp(fitted.input).extend({ top: lift, bottom: 0, left: 0, right: 0, background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  return { input, width: fitted.width, height: fitted.height + lift };
}
const span = (color: string, body: string, extra = "") => `<span foreground="${color}"${extra}>${escapeText(body || " ")}</span>`;
const caps = (color: string, body: string) => span(color, body.toUpperCase(), ' letter_spacing="1800"');

const chrome = (height = 630): string[] => {
  const shapes = [`<rect width="1200" height="${height}" fill="${th.bg}"/>`, `<rect width="12" height="${height}" fill="${th.bar}"/>`];
  if (th.frame) shapes.push(`<rect x="26" y="14" width="1160" height="${height - 28}" rx="6" fill="none" stroke="${th.frame}" stroke-width="2"/>`, `<rect x="32" y="20" width="1148" height="${height - 40}" rx="4" fill="none" stroke="${th.edge}" stroke-width="1"/>`);
  return shapes;
};

/** A prepared backdrop (card-backdrop.ts) as an SVG image, drawn right after the card's flat background so the frame and panels sit on top. */
const artImage = (art: Buffer, height: number) => `<image x="0" y="0" width="1200" height="${height}" href="data:image/jpeg;base64,${art.toString("base64")}"/>`;
const withArt = (shapes: string[], art: Buffer | null, height: number) => { if (art) shapes.splice(1, 0, artImage(art, height)); };

// The leaderboard layout, shared by every ranking card. A header (eyebrow, title, subtitle, and the season / updated-at line on
// the right), then one or more panels laid out like a ranking site: a column header, a rank column with gold, silver and bronze
// medals for the top 3, the name in its class colour with a quiet second line, right-aligned numeric columns, an optional level
// bar and movement arrow, zebra rows and a highlighted first place. One board longer than LADDER_SPLIT rows is split into two
// side-by-side panels when the names still fit (ranks continue); several boards sit two per row. The image is as tall as its rows need (at least 630).
export const LADDER_SPLIT = 14, LADDER_MAX_ROWS = 50;
/** The ladder's top-right line: the season (when there is one) and when the board was drawn, in the guild's time zone. */
export function ladderMeta(lang: "en" | "fr", updatedAt: Date, season?: string | null, timeZone?: string): string {
  const when = cardDateTime(updatedAt, lang, timeZone);
  return [season, lang === "fr" ? `Mis à jour ${when}` : `Updated ${when}`].filter(Boolean).join(" · ");
}
const MEDAL = ["#ffd100", "#c9d1d9", "#d08a4a"] as const;
async function renderLadder(card: ScoreCard): Promise<Buffer> {
  const visual = card.ladder!, layers: Layer[] = [], body: string[] = [];
  const put = async (markup: string, size: number, left: number, y: number, maxWidth = 1080, fixed = false) => {
    const t = await text(markup, size, maxWidth, fixed); layers.push({ input: t.input, left: Math.round(left), top: Math.round(y) }); return t;
  };
  const putRight = async (markup: string, size: number, right: number, y: number, maxWidth = 400) => {
    const t = await text(markup, size, maxWidth); layers.push({ input: t.input, left: Math.round(right - t.width), top: Math.round(y) }); return t;
  };
  const putCentre = async (markup: string, size: number, centre: number, middle: number) => {
    const t = await text(markup, size, 120); layers.push({ input: t.input, left: Math.round(centre - t.width / 2), top: Math.round(middle - t.height / 2) }); return t;
  };

  // Panels: a long single board is split in two columns; several boards each get a panel (15 rows at most).
  type Panel = { title?: string | undefined; rows: LadderRow[] };
  const boards = visual.boards.filter(board => board.rows.length);
  const panels: Panel[] = [];
  if (boards.length === 1) {
    const rows = boards[0]!.rows.slice(0, LADDER_MAX_ROWS);
    // Split only when a half-width panel still leaves the names room (at least 170 px after the value columns).
    const halfNameW = 530 - 80 - visual.columns.reduce((sum, column) => sum + column.width + 14, 0);
    if (rows.length > LADDER_SPLIT && halfNameW >= 170) { const half = Math.ceil(rows.length / 2); panels.push({ title: boards[0]!.title, rows: rows.slice(0, half) }, { rows: rows.slice(half) }); }
    else panels.push({ title: boards[0]!.title, rows });
  } else for (const board of boards.slice(0, 6)) panels.push({ title: board.title, rows: board.rows.slice(0, 15) });
  const twoUp = panels.length > 1, pw = twoUp ? 530 : 1080, withSub = panels.some(panel => panel.rows.some(row => row.sub));
  const rowH = withSub ? 48 : 38, titled = panels.some(panel => panel.title), headH = (titled ? 34 : 0) + 30;
  const panelH = (panel: Panel) => headH + panel.rows.length * rowH + 10;

  // Header.
  const top = 176;
  let y = top;
  const placed: { panel: Panel; x: number; y: number }[] = [];
  for (let i = 0; i < panels.length; i += twoUp ? 2 : 1) {
    const pair = panels.slice(i, i + (twoUp ? 2 : 1));
    pair.forEach((panel, k) => placed.push({ panel, x: 60 + k * (pw + 20), y }));
    y += Math.max(...pair.map(panelH)) + 18;
  }
  const height = Math.max(630, y + (panels.length ? 60 : 120));
  const shapes = chrome(height);
  withArt(shapes, await cardBackdropArt(card.backdrop, "banner"), BANNER_HEIGHT);
  await put(caps(th.gold, clip(card.eyebrow ?? "Guilded", 44)), 20, 60, 36, 700);
  await put(span(th.ink, clip(card.title, 34)), 52, 58, 62, 760);
  await put(span(th.muted, clip(card.subtitle, 70)), 22, 60, 130, 760);
  if (visual.meta) {
    // The "updated" stamp sits on the painting: a dark pill behind it keeps it readable on a bright banner.
    const meta = await putRight(span(th.ink, clip(visual.meta, 46)), 17, 1140, 44, 420);
    shapes.push(`<rect x="${1140 - meta.width - 12}" y="38" width="${meta.width + 24}" height="${meta.height + 12}" rx="10" fill="#000" fill-opacity=".55"/>`);
  }
  if (!panels.length) await put(span(th.muted, clip(visual.empty ?? "—", 90)), 24, 60, top + 20);

  for (const { panel, x, y: py } of placed) {
    body.push(rect(x, py, pw, panelH(panel), th.panel, th.edge, 12));
    let hy = py + 10;
    if (panel.title) { await put(caps(th.gold, clip(panel.title, twoUp ? 34 : 70)), 15, x + 18, hy + 2, pw - 36); hy += 34; }
    // Columns, placed right to left from the panel's right edge.
    const right = x + pw - 18, colX: number[] = [];
    let edge = right;
    for (let c = visual.columns.length - 1; c >= 0; c--) { colX[c] = edge; edge -= visual.columns[c]!.width + 14; }
    const nameX = x + 62, nameW = Math.max(120, edge - nameX);
    await put(caps(th.muted, "#"), 12, x + 24, hy + 4, 30);
    for (const [c, column] of visual.columns.entries()) {
      if (column.kind === "bar") await put(caps(th.muted, clip(column.label, 14)), 12, colX[c]! - column.width, hy + 4, column.width + 40);
      else await putRight(caps(th.muted, clip(column.label, 14)), 12, colX[c]!, hy + 4, column.width + 40);
    }
    body.push(`<rect x="${x + 12}" y="${hy + 24}" width="${pw - 24}" height="1" fill="${th.edge}"/>`);
    const firstRow = hy + 30;
    for (const [i, row] of panel.rows.entries()) {
      const ry = firstRow + i * rowH, mid = ry + rowH / 2;
      if (row.rank === 1) body.push(`<rect x="${x + 6}" y="${ry + 1}" width="${pw - 12}" height="${rowH - 2}" rx="6" fill="${th.gold}" fill-opacity=".1"/>`, `<rect x="${x + 6}" y="${ry + 1}" width="3" height="${rowH - 2}" rx="1.5" fill="${th.gold}"/>`);
      else if (i % 2) body.push(`<rect x="${x + 6}" y="${ry + 1}" width="${pw - 12}" height="${rowH - 2}" rx="6" fill="#ffffff" fill-opacity=".035"/>`);
      // Rank: a medal for the top 3, a plain number after.
      const medal = MEDAL[row.rank - 1];
      if (medal) {
        body.push(`<circle cx="${x + 32}" cy="${mid}" r="14" fill="${medal}"/><circle cx="${x + 32}" cy="${mid}" r="10.5" fill="none" stroke="#120d08" stroke-opacity=".35" stroke-width="1.5"/>`);
        await putCentre(span("#1a1206", String(row.rank)), 15, x + 32, mid);
      } else await putCentre(span(th.muted, (row.rank > 0 ? String(row.rank) : "·")), 17, x + 32, mid);
      // Name in the class colour, the second line muted.
      await put(span(row.color, clip(row.name, 80)), 20, nameX, row.sub ? ry + 4 : mid - 13, nameW, true);
      if (row.sub) await put(span(th.muted, clip(row.sub, Math.floor(nameW / 7.2))), 13, nameX, ry + 28, nameW);
      // Value columns.
      for (const [c, column] of visual.columns.entries()) {
        const cx = colX[c]!;
        if (column.kind === "bar") {
          if (!row.bar) continue;
          const fraction = Math.max(0, Math.min(1, row.bar.value / Math.max(1, row.bar.max))), bx = cx - column.width;
          body.push(`<rect x="${bx}" y="${mid - 5}" width="${column.width}" height="10" rx="5" fill="#1a120a" stroke="${th.edge}"/>`,
            `<rect x="${bx}" y="${mid - 5}" width="${Math.max(10, Math.round(column.width * fraction))}" height="10" rx="5" fill="${fraction >= 1 ? th.gold : row.color}" fill-opacity=".9"/>`);
        } else if (column.kind === "move") {
          if (row.move === undefined || row.move === 0) { await putRight(span(th.muted, "–"), 16, cx, mid - 11); continue; }
          if (row.move === "new") { await putRight(caps(th.gold, row.moveLabel ?? "new"), 11, cx, mid - 8, column.width + 20); continue; }
          const up = row.move > 0, tone = up ? th.green : th.red;
          const t = await putRight(span(tone, row.moveLabel ?? String(Math.abs(row.move))), 16, cx, mid - 11, column.width);
          const ax = cx - t.width - 12;
          body.push(up ? `<path d="M${ax - 5} ${mid + 4}L${ax + 5} ${mid + 4}L${ax} ${mid - 5}Z" fill="${tone}"/>` : `<path d="M${ax - 5} ${mid - 4}L${ax + 5} ${mid - 4}L${ax} ${mid + 5}Z" fill="${tone}"/>`);
        } else {
          const value = row.values[c] ?? "";
          if (!value) continue;
          await putRight(span(column.primary ? th.gold : th.ink, clip(value, 12)), column.primary ? 21 : 18, cx, mid - (column.primary ? 14 : 12), column.width + 40);
        }
      }
    }
  }
  shapes.push(...body, `<rect x="60" y="${height - 52}" width="1080" height="1" fill="${th.edge}"/>`);
  await put(span(th.muted, clip(card.footer, 260)), 17, 60, height - 40);
  const base = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height}">${shapes.join("")}</svg>`);
  return sharp(base).composite(layers).png().toBuffer();
}

/**
 * Draws a card. Every card has a banner layout (card-next.ts); the officer trend chart (member-trend-card.ts) draws its own picture,
 * and a ladder of more than 25 rows (the race board's top 50) keeps the long ladder above.
 */
async function render(card: ScoreCard, branded: boolean): Promise<Buffer> {
  if (card.trend) return (await import("./member-trend-card.js")).renderTrendCard(card);
  const next = await import("./card-next.js").then((m) => m.renderNextCard(card, { branded }));
  return next ?? renderLadder(card);
}

export const ROLE_COLOR = { TANK: "#6aa8ff", HEALER: "#58d68d", DPS: "#ff7a5c" } as const;
const r2 = (v: number) => Math.round(v * 100) / 100;
/**
 * A role mark: a tinted disc with a ring, and one solid glyph in the role colour (a heater shield, a cross, crossed
 * swords). Every glyph fits the same 21 px box and shares one dark 1 px outline, so the three read as one set.
 */
export function roleGlyph(role: DungeonCardMember["role"], cx: number, cy: number, r = 17): string {
  const color = role ? ROLE_COLOR[role] : th.muted;
  const disc = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" fill-opacity=".13" stroke="${color}" stroke-opacity=".75" stroke-width="1.5"/>`;
  const ink = `fill="${color}" stroke="#120d08" stroke-width="1" stroke-linejoin="round"`;
  const sword = (turn: number) => `<g transform="rotate(${turn})"><path d="M0-11.4L2.6-8V3.6H-2.6V-8Z" ${ink}/><rect x="-6" y="3.4" width="12" height="3" rx="1.5" ${ink}/><rect x="-1.5" y="6.2" width="3" height="5" rx="1.2" ${ink}/></g>`;
  const glyph = role === "TANK" ? `<path d="M0-10.2L8.6-7V-.6C8.6 5 4.8 8.6 0 10.6C-4.8 8.6-8.6 5-8.6-.6V-7Z" ${ink}/><path d="M0-7.4V7.8" stroke="#120d08" stroke-opacity=".55" stroke-width="1.6"/>`
    : role === "HEALER" ? `<path d="M-2.8-9.4H2.8V-2.8H9.4V2.8H2.8V9.4H-2.8V2.8H-9.4V-2.8H-2.8Z" ${ink}/>`
    : role === "DPS" ? `${sword(-45)}${sword(45)}`
    : `<circle r="3.2" fill="${color}"/>`;
  return `${disc}<g transform="translate(${cx} ${cy}) scale(${r2(r / 17)})">${glyph}</g>`;
}

/** A base64 image cut to a circle of `size` px, or null when it cannot be read (the caller draws its fallback). */
export async function circleImage(base64: string, size: number): Promise<Buffer | null> {
  try {
    return await sharp(Buffer.from(base64, "base64"), { limitInputPixels: 4096 * 4096 }).resize(size, size, { fit: "cover" })
      .composite([{ input: Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}"/></svg>`), blend: "dest-in" }]).png().toBuffer();
  } catch { return null; }
}

/** The traced map grid (dungeon-map-grid.ts): 200 x 200 cells over the floor's map. WoW map frames are 3:2, so a unit of x is 1.5 units of y. */
export const MAP_GRID = 200, MAP_ASPECT = 1.5;
/**
 * Pure: where a traced floor sits in a box. The view frames the walked cells and the death points (with a margin), keeps the
 * map's 3:2 proportions and centres the result; `at` turns map fractions (0..1) into card pixels, `radius` is a cell's draw radius.
 */
export function mapView(cells: readonly number[], points: readonly { x: number; y: number }[], left: number, top: number, width: number, height: number) {
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  const grow = (x: number, y: number) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  for (const key of cells) { const cx = Math.floor(key / MAP_GRID), cy = key % MAP_GRID; grow(cx / MAP_GRID, cy / MAP_GRID); grow((cx + 1) / MAP_GRID, (cy + 1) / MAP_GRID); }
  for (const point of points) grow(Math.min(1, Math.max(0, point.x)), Math.min(1, Math.max(0, point.y)));
  const margin = 3 / MAP_GRID;
  x0 = Math.max(0, x0 - margin); y0 = Math.max(0, y0 - margin); x1 = Math.min(1, x1 + margin); y1 = Math.min(1, y1 + margin);
  const spanX = Math.max(1 / MAP_GRID, x1 - x0) * MAP_ASPECT, spanY = Math.max(1 / MAP_GRID, y1 - y0);
  const scale = Math.min(width / spanX, height / spanY);
  const ox = left + (width - spanX * scale) / 2, oy = top + (height - spanY * scale) / 2;
  return {
    scale, radius: Math.max(1.2, (scale * MAP_ASPECT) / MAP_GRID * 0.95),
    at: (x: number, y: number) => ({ x: ox + (x - x0) * MAP_ASPECT * scale, y: oy + (y - y0) * scale })
  };
}

/** Alt text of each drawn picture, kept by the buffer itself so the image goes out with its description (card-alt.ts). */
const altTexts = new WeakMap<Buffer, string>();
export const altTextOf = (png: Buffer): string | undefined => altTexts.get(png);

// Cache by the complete facts, not a player id, so changed scores immediately get a different image.
// Bound both memory (32 images) and concurrent render work (2 distinct images); null means busy.
/**
 * Cards posted in a Discord server carry no product branding ("Guilded ·" before the eyebrow, "guildedwow.com" in the footer): the
 * server's own members are reading them. The website's own share images keep it (`branded`).
 */
export function unbrandCard(card: ScoreCard): ScoreCard {
  const eyebrow = card.eyebrow?.replace(/^Guilded\s*·\s*/i, "");
  const footer = card.footer.replace(/\s*·\s*guildedwow\.com\s*$/i, "").replace(/^Guilded\s*·\s*/i, "");
  return { ...card, ...(eyebrow && eyebrow !== "Guilded" ? { eyebrow } : { eyebrow: card.title }), footer };
}

export async function scoreCardPng(source: ScoreCard, options: { branded?: boolean } = {}): Promise<Buffer | null> {
  const card = options.branded ? source : unbrandCard(source);
  const key = createHash("sha256").update(JSON.stringify(card)).digest("hex") + (options.branded ? "b" : "");
  const cached = images.get(key);
  if (cached) return cached;
  let work = pending.get(key);
  if (!work) {
    if (pending.size >= 2) return null;
    work = withBadgeImages(card).then(prepared => render(prepared, Boolean(options.branded)));
    pending.set(key, work);
  }
  try {
    const binaryBody = await work;
    images.set(key, binaryBody);
    altTexts.set(binaryBody, cardAltText(card));
    while (images.size > 32) images.delete(images.keys().next().value!);
    return binaryBody;
  } finally { if (pending.get(key) === work) pending.delete(key); }
}

// Only call after the route has checked public visibility.
export async function scoreCardResponse(card: ScoreCard, head = false): Promise<WebResponse> {
  const headers = { "content-type": "image/png", "cache-control": "no-store", "x-content-type-options": "nosniff" };
  if (head) return { status: 200, headers, body: "" };
  const binaryBody = await scoreCardPng(card, { branded: true });
  return binaryBody ? { status: 200, headers, body: "", binaryBody } : { status: 503, headers: { ...headers, "retry-after": "2" }, body: "" };
}
