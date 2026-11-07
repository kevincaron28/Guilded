import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import type { WebResponse } from "./web-app.js";
import type { RosterVisual } from "./roster-visual.js";
import { dungeonArt, type DungeonArtTheme } from "./dungeon-art.js";

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
  /** Leaderboard layout (every ranking card): medals, class colours, aligned columns; the image grows with the row count. */
  ladder?: LadderVisual;
  /** 9.1: the dungeon completion layout (themed art, party with role icons, optional death map). */
  dungeon?: DungeonVisual;
  /** 9.1: the daily recap layout (painted scene, a stats strip, up to three section panels of rows). */
  recap?: RecapVisual }

/** A recap: up to three panels, each a title and up to five rows (name in its colour, a line under it, a value on the right). */
export interface RecapVisual { theme: DungeonArtTheme; sections: { title: string; rows: CardRow[] }[] }

export type DungeonMotif = "cave" | "fire" | "sea" | "keep" | "mine" | "thorn";
/**
 * One party member on a dungeon card. `guild` false marks an outsider; `color` is the class colour. `score` is the
 * right-hand number when the card has a score column (`scoreLabel`), with an optional `scoreNote` under it (+35).
 */
export interface DungeonCardMember { name: string; color: string; role?: "TANK" | "HEALER" | "DPS" | undefined; roleLabel?: string | undefined; sub?: string | undefined; guild: boolean;
  score?: string | undefined; scoreNote?: string | undefined }
/**
 * Dungeon art is painted from `theme` (a scene for the dungeon, or a motif on cards queued before scenes existed, and a
 * seed), never copied from the game: see dungeon-art.ts. `deathPoints` are 0..1 positions on a flat map (x right, y down)
 * and switch the death map on.
 */
export interface DungeonVisual { theme: DungeonArtTheme; party: DungeonCardMember[]; scoreLabel?: string | undefined;
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
  const kept = text.replace(/[\p{So}\p{Sk}\p{Cf}\p{Co}\p{Cn}\uFE00-\uFE0F]/gu, c => (c.codePointAt(0)! <= 0xff ? c : ""));
  return kept === text ? text : kept.replace(/\s{2,}/g, " ").trim();
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

/** Rendered text sized to its own content, so pills can be fitted around it. */
async function text(markup: string, size: number, maxWidth: number) {
  const { data, info } = await sharp({ text: { text: markup, font: `Source Serif 4 ${size}`, fontfile, width: maxWidth, rgba: true, wrap: "none" } }).png().toBuffer({ resolveWithObject: true });
  return { input: data, width: info.width, height: info.height };
}
const span = (color: string, body: string, extra = "") => `<span foreground="${color}"${extra}>${escapeText(body || " ")}</span>`;
const caps = (color: string, body: string) => span(color, body.toUpperCase(), ' letter_spacing="1800"');

const chrome = (height = 630): string[] => {
  const shapes = [`<rect width="1200" height="${height}" fill="${th.bg}"/>`, `<rect width="12" height="${height}" fill="${th.bar}"/>`];
  if (th.frame) shapes.push(`<rect x="26" y="14" width="1160" height="${height - 28}" rx="6" fill="none" stroke="${th.frame}" stroke-width="2"/>`, `<rect x="32" y="20" width="1148" height="${height - 40}" rx="4" fill="none" stroke="${th.edge}" stroke-width="1"/>`);
  return shapes;
};

// The leaderboard layout, shared by every ranking card. A header (eyebrow, title, subtitle, and the season / updated-at line on
// the right), then one or more panels laid out like a ranking site: a column header, a rank column with gold, silver and bronze
// medals for the top 3, the name in its class colour with a quiet second line, right-aligned numeric columns, an optional level
// bar and movement arrow, zebra rows and a highlighted first place. One board longer than LADDER_SPLIT rows is split into two
// side-by-side panels when the names still fit (ranks continue); several boards sit two per row. The image is as tall as its rows need (at least 630).
export const LADDER_SPLIT = 14, LADDER_MAX_ROWS = 50;
/** The ladder's top-right line: the season (when there is one) and when the board was drawn, in UTC. */
export function ladderMeta(lang: "en" | "fr", updatedAt: Date, season?: string | null): string {
  const when = updatedAt.toISOString().slice(0, 16).replace("T", " ");
  return [season, lang === "fr" ? `Mis à jour ${when} UTC` : `Updated ${when} UTC`].filter(Boolean).join(" · ");
}
const MEDAL = ["#ffd100", "#c9d1d9", "#d08a4a"] as const;
async function renderLadder(card: ScoreCard): Promise<Buffer> {
  const visual = card.ladder!, layers: Layer[] = [], body: string[] = [];
  const put = async (markup: string, size: number, left: number, y: number, maxWidth = 1080) => {
    const t = await text(markup, size, maxWidth); layers.push({ input: t.input, left: Math.round(left), top: Math.round(y) }); return t;
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
  const height = Math.max(630, y + (panels.length ? 52 : 120));
  const shapes = chrome(height);
  await put(caps(th.gold, clip(card.eyebrow ?? "Guilded", 44)), 20, 60, 36, 700);
  await put(span(th.ink, clip(card.title, 34)), 52, 58, 62, 760);
  await put(span(th.muted, clip(card.subtitle, 70)), 22, 60, 130, 760);
  if (visual.meta) await putRight(span(th.muted, clip(visual.meta, 46)), 17, 1140, 44, 420);
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
      if (column.kind === "bar") await put(caps(th.muted, clip(column.label, 14)), 12, colX[c]! - column.width, hy + 4, column.width);
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
      } else await putCentre(span(th.muted, String(row.rank)), 17, x + 32, mid);
      // Name in the class colour, the second line muted.
      const chars = Math.max(8, Math.floor(nameW / 9.6));
      await put(span(row.color, clip(row.name, chars)), 20, nameX, row.sub ? ry + 4 : mid - 13, nameW);
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
  await put(span(th.muted, clip(card.footer, 150)), 17, 60, height - 40);
  const base = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height}">${shapes.join("")}</svg>`);
  return sharp(base).composite(layers).png().toBuffer();
}

async function render(card: ScoreCard): Promise<Buffer> {
  if (card.dungeon) return renderDungeon(card);
  if (card.recap) return renderRecap(card);
  if (card.roster) return renderRoster(card);
  if (card.unlocks?.length) return renderUnlock(card);
  if (card.ladder) return renderLadder(card);
  const accent = { gold: th.gold, green: th.green, red: th.red } as const;
  const shapes = chrome();
  const layers: Layer[] = [];
  const put = async (markup: string, size: number, left: number, top: number, maxWidth = 1080) => {
    const t = await text(markup, size, maxWidth); layers.push({ input: t.input, left: Math.round(left), top: Math.round(top) }); return t;
  };
  const hasRows = Boolean(card.rows?.length);
  const leftW = hasRows ? 500 : 1080;

  // The title shrinks to fit the narrower left column rather than being cut short.
  const titleLen = [...drawable(card.title)].length, titleSize = !hasRows || titleLen <= 12 ? 62 : titleLen <= 17 ? 50 : 40;
  await put(caps(th.gold, clip(card.eyebrow ?? "Guilded · Dungeons", 44)), 20, 60, 40, leftW);
  await put(span(th.ink, clip(card.title, hasRows ? 26 : 38)), titleSize, 58, 68 + (62 - titleSize) / 2, leftW);
  await put(span(th.muted, clip(card.subtitle, hasRows ? 38 : 90)), 25, 60, 146, leftW);

  // Headline: the first stat is large, the next two sit side by side underneath.
  const [big, ...small] = card.stats.slice(0, 3);
  let y = 214;
  if (big) {
    shapes.push(`<rect x="60" y="${y + 4}" width="4" height="24" rx="2" fill="${accent[big.accent ?? "gold"]}"/>`);
    await put(caps(th.muted, clip(big.label, 30)), 17, 76, y + 6, leftW);
    await put(span(accent[big.accent ?? "gold"], clip(big.value, hasRows ? 10 : 20)), hasRows ? 100 : 120, 56, y + 34, leftW);
    if (big.note) await put(span(th.ink, clip(big.note, hasRows ? 38 : 80)), 21, 60, y + 146, leftW);
    y += 200;
  }
  const smallW = hasRows ? Math.floor((leftW - 20) / Math.max(1, small.length)) : 340;
  for (const [i, stat] of small.entries()) {
    const x = 60 + i * (smallW + 20);
    shapes.push(`<rect x="${x}" y="${y + 4}" width="4" height="20" rx="2" fill="${accent[stat.accent ?? "gold"]}"/>`);
    await put(caps(th.muted, clip(stat.label, hasRows ? 14 : 30)), 15, x + 14, y + 4, smallW - 14);
    const len = [...stat.value].length;
    await put(span(accent[stat.accent ?? "gold"], clip(stat.value, 18)), len > 11 ? 26 : len > 6 ? 34 : 54, x - 1, y + 26, smallW);
    if (stat.note) await put(span(th.ink, clip(stat.note, Math.floor(smallW / 9))), 17, x + 1, y + 78, smallW);
  }

  // Right panel: one row per party member or run.
  if (hasRows) {
    const rows = card.rows!.slice(0, 5), px = 600, pw = 540, top = 60;
    shapes.push(rect(px, top, pw, 450, th.panel, th.edge, 14));
    await put(caps(th.muted, clip(card.rowsLabel ?? "", 40)), 17, px + 28, top + 22, pw - 56);
    shapes.push(`<rect x="${px + 28}" y="${top + 54}" width="${pw - 56}" height="1" fill="${th.edge}"/>`);
    for (const [i, row] of rows.entries()) {
      const ry = top + 70 + i * 74, color = row.color ?? th.gold;
      // An icon (badge artwork, 64x64 grid) replaces the colour bar and pushes the text right.
      const tx = row.icon ? px + 100 : px + 48;
      shapes.push(row.icon ? `<svg x="${px + 28}" y="${ry + 1}" width="60" height="60" viewBox="0 0 64 64">${row.icon}</svg>` : `<rect x="${px + 28}" y="${ry + 4}" width="5" height="54" rx="2.5" fill="${color}"/>`);
      await put(span(color, clip(row.name, row.icon ? 22 : 26)), row.icon ? 24 : 27, tx, ry + (row.icon ? 2 : 0), 330);
      if (row.sub) await put(span(th.muted, clip(row.sub, row.icon ? 30 : 34)), 17, tx, ry + 36, 330);
      if (row.right) {
        const t = await text(span(row.rightTone ? accent[row.rightTone] : th.ink, clip(row.right, 14)), 23, 200);
        layers.push({ input: t.input, left: px + pw - 28 - t.width, top: ry + 14 });
      }
    }
  }

  // Trust badges: pills sized to their text, along the bottom of the left column or the full width.
  let bx = 60;
  const badgeY = 526;
  for (const badge of card.badges ?? []) {
    const tone = badge.tone === "ok" ? th.ok : badge.tone === "warn" ? th.warn : th.quiet;
    const ink = badge.tone === "ok" ? th.green : badge.tone === "warn" ? th.gold : th.muted;
    const t = await text(span(ink, clip(badge.text, 44)), 19, 600);
    const w = t.width + 42;
    if (bx + w > 1140) break;
    shapes.push(rect(bx, badgeY, w, 36, tone.fill, tone.edge, 18), `<circle cx="${bx + 19}" cy="${badgeY + 18}" r="5" fill="${ink}"/>`);
    layers.push({ input: t.input, left: bx + 32, top: badgeY + 18 - Math.round(t.height / 2) });
    bx += w + 12;
  }

  shapes.push(`<rect x="60" y="578" width="1080" height="1" fill="${th.edge}"/>`);
  await put(span(th.muted, clip(card.footer, 150)), 17, 60, 590);

  const base = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">${shapes.join("")}</svg>`);
  return sharp(base).composite(layers).png().toBuffer();
}

/** Role colours on the dark card: steel blue, leaf green and ember red, all at about the same brightness. */
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

/**
 * The dungeon completion card: a painted backdrop for the dungeon (dungeon-art.ts) behind a left column (time, final boss,
 * deaths, record or guild rank) and a frosted party panel: role mark, full name in class colour, class/spec/deaths, the
 * member's score when the run carries one, the role and a Guild / Outside guild tag. With death positions a small map
 * under the party shows where the group fell; without them the card is the same, minus the map.
 */
async function renderDungeon(card: ScoreCard): Promise<Buffer> {
  const visual = card.dungeon!, accent = { gold: th.gold, green: th.green, red: th.red } as const, layers: Layer[] = [];
  const px = 600, pw = 540, top = 60, ph = 450;
  const art = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">${dungeonArt(visual.theme)}</svg>`)).png().toBuffer();
  // Frosted glass: the art behind the panel, blurred and darkened, so the panel carries the dungeon's colours without noise.
  const frost = await sharp(art).extract({ left: px, top, width: pw, height: ph }).blur(14).modulate({ brightness: 0.5, saturation: 0.95 })
    .composite([{ input: Buffer.from(`<svg width="${pw}" height="${ph}"><rect width="${pw}" height="${ph}" rx="14"/></svg>`), blend: "dest-in" }]).png().toBuffer();
  const shapes: string[] = [`<defs><linearGradient id="shade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".62"/><stop offset=".3" stop-color="#000" stop-opacity=".46"/><stop offset=".48" stop-color="#000" stop-opacity=".2"/><stop offset=".56" stop-color="#000" stop-opacity=".08"/><stop offset="1" stop-color="#000" stop-opacity=".2"/></linearGradient>`
    + `<linearGradient id="foot" x1="0" y1="0" x2="0" y2="1"><stop offset=".88" stop-color="#000" stop-opacity="0"/><stop offset=".95" stop-color="#000" stop-opacity=".4"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></linearGradient></defs>`,
    `<rect width="1200" height="630" fill="url(#shade)"/>`, `<rect width="1200" height="630" fill="url(#foot)"/>`, `<rect width="12" height="630" fill="${th.bar}"/>`,
    `<rect x="26" y="14" width="1160" height="602" rx="6" fill="none" stroke="${th.frame}" stroke-width="2"/>`,
    `<image x="${px}" y="${top}" width="${pw}" height="${ph}" href="data:image/png;base64,${frost.toString("base64")}"/>`,
    `<rect x="${px}" y="${top}" width="${pw}" height="${ph}" rx="14" fill="${th.bg}" fill-opacity=".3" stroke="${th.edge}" stroke-width="1.5"/>`,
    `<rect x="${px + 14}" y="${top + 1.5}" width="${pw - 28}" height="1" fill="${th.gold}" fill-opacity=".25"/>`];
  // Text over the painted art (the left column and footer) gets a soft dark shadow, so it stays readable on any scene.
  const shadowed = async (t: { input: Buffer; width: number; height: number }, left: number, y: number) => {
    const pad = 8, shadow = await sharp(t.input).extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .linear([0, 0, 0, 0.85], [0, 0, 0, 0]).blur(3.5).png().toBuffer();
    layers.push({ input: shadow, left: Math.round(left) - pad + 1, top: Math.round(y) - pad + 2 }, { input: t.input, left: Math.round(left), top: Math.round(y) });
  };
  const put = async (markup: string, size: number, left: number, y: number, maxWidth = 1080, shade = false) => {
    const t = await text(markup, size, maxWidth);
    if (shade) await shadowed(t, left, y); else layers.push({ input: t.input, left: Math.round(left), top: Math.round(y) });
    return t;
  };
  const putRight = async (markup: string, size: number, right: number, y: number) => {
    const t = await text(markup, size, 300); layers.push({ input: t.input, left: Math.round(right - t.width), top: Math.round(y) }); return t;
  };
  const leftW = 500, titleLen = [...drawable(card.title)].length, titleSize = titleLen <= 12 ? 62 : titleLen <= 17 ? 50 : 40;
  await put(caps(th.gold, clip(card.eyebrow ?? "Guilded", 44)), 20, 60, 40, leftW, true);
  await put(span(th.ink, clip(card.title, 26)), titleSize, 58, 68 + (62 - titleSize) / 2, leftW, true);
  await put(span(th.muted, clip(card.subtitle, 40)), 25, 60, 146, leftW, true);

  const [time, boss, deaths] = card.stats;
  if (time) {
    shapes.push(`<rect x="60" y="218" width="4" height="24" rx="2" fill="${accent[time.accent ?? "gold"]}"/>`);
    await put(caps(th.muted, clip(time.label, 30)), 17, 76, 220, leftW, true);
    await put(span(accent[time.accent ?? "gold"], clip(time.value, 8)), 104, 56, 244, leftW, true);
    if (time.note) await put(span(th.ink, clip(time.note, 38)), 20, 60, 366, leftW, true);
  }
  const small = async (stat: CardStat | undefined, x: number, w: number, chars: number) => {
    if (!stat) return;
    shapes.push(`<rect x="${x}" y="420" width="4" height="20" rx="2" fill="${accent[stat.accent ?? "gold"]}"/>`);
    await put(caps(th.muted, clip(stat.label, 16)), 15, x + 14, 420, w, true);
    await put(span(accent[stat.accent ?? "gold"], clip(stat.value, chars)), stat.value.length > 16 ? 24 : 32, x - 1, 444, w, true);
    if (stat.note) await put(span(th.ink, clip(stat.note, 24)), 16, x + 1, 488, w, true);
  };
  await small(boss, 60, 310, 28);
  await small(deaths, 390, 150, 6);

  // Party panel. The score column appears only when the card carries scores.
  // A traced map gets a taller box: the party rows are set tighter (z scales the row text).
  const hasMap = Boolean(visual.deathPoints?.length), traced = hasMap && Boolean(visual.mapOutline?.cells.length);
  const maxRows = hasMap ? 5 : 6, rowH = traced ? 44 : hasMap ? 52 : 60, z = traced ? 0.86 : 1;
  const hasScore = Boolean(visual.scoreLabel), scoreX = px + pw - 128, nameW = hasScore ? scoreX - 84 - (px + 72) : 300;
  await put(caps(th.muted, clip(card.rowsLabel ?? "", hasScore ? 28 : 40)), 17, px + 28, top + 22, hasScore ? 330 : pw - 56);
  if (hasScore) await putRight(caps(th.muted, clip(visual.scoreLabel!, 16)), 13, scoreX, top + 26);
  shapes.push(`<rect x="${px + 28}" y="${top + 54}" width="${pw - 56}" height="1" fill="${th.edge}"/>`);
  const shown = visual.party.slice(0, visual.party.length > maxRows ? maxRows - 1 : maxRows);
  for (const [i, member] of shown.entries()) {
    const ry = top + 64 + i * rowH;
    if (!member.guild) shapes.push(`<rect x="${px + 16}" y="${ry - 2}" width="${pw - 32}" height="${rowH - 6}" rx="8" fill="none" stroke="${th.edge}" stroke-dasharray="5 4"/>`);
    shapes.push(roleGlyph(member.role, px + 44, ry + Math.round(23 * z), traced ? 14 : hasMap ? 16 : 17));
    await put(span(member.color, clip(member.name, hasScore ? 21 : 24)), Math.round(24 * z), px + 72, ry, nameW);
    if (member.sub) await put(span(th.muted, clip(member.sub, hasScore ? 36 : 38)), Math.round(16 * z), px + 72, ry + Math.round(29 * z), hasScore ? nameW + 46 : 330);
    if (hasScore && member.score) {
      await putRight(span(th.gold, clip(member.score, 8)), Math.round(22 * z), scoreX, ry + 1);
      if (member.scoreNote) await putRight(span(th.green, clip(member.scoreNote, 10)), Math.round(14 * z), scoreX, ry + Math.round(30 * z));
    }
    if (member.roleLabel) await putRight(span(member.role ? ROLE_COLOR[member.role] : th.ink, clip(member.roleLabel, 12)), Math.round(19 * z), px + pw - 30, ry + 2);
    await putRight(member.guild ? span(th.gold, visual.guildLabel) : span(th.muted, visual.outsiderLabel), Math.round(14 * z), px + pw - 30, ry + Math.round(30 * z));
  }
  const hidden = visual.party.length - shown.length;
  if (hidden > 0) await put(span(th.muted, `+${hidden} ${visual.moreLabel}`), 18, px + 72, top + 64 + shown.length * rowH + 4, 300);

  if (hasMap) {
    const mx = px + 28, my = top + 64 + maxRows * rowH + 6, mw = pw - 56, mh = ph - (my - top) - 14;
    shapes.push(`<rect x="${mx}" y="${my}" width="${mw}" height="${mh}" rx="8" fill="#140e08" fill-opacity="${visual.mapOutline?.cells.length ? 0.85 : 0.45}" stroke="${th.edge}"/>`);
    const outline = visual.mapOutline?.cells.length ? visual.mapOutline : null;
    shapes.push(`<defs><radialGradient id="heat"><stop offset="0" stop-color="#ff3b1f" stop-opacity=".75"/><stop offset="1" stop-color="#ff3b1f" stop-opacity="0"/></radialGradient></defs>`);
    if (outline) {
      // The traced map: the floor's walked cells, framed on what was walked (and where the deaths are), at the map's 3:2 shape.
      const view = mapView(outline.cells, visual.deathPoints!, mx + 6, my + 18, mw - 12, mh - 24);
      const ink: string[] = [], floor: string[] = [];
      for (const key of outline.cells) {
        const { x, y } = view.at((Math.floor(key / MAP_GRID) + 0.5) / MAP_GRID, (key % MAP_GRID + 0.5) / MAP_GRID);
        ink.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(view.radius + 1.4).toFixed(2)}"/>`);
        floor.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${view.radius.toFixed(2)}"/>`);
      }
      shapes.push(`<g fill="${th.gold}" fill-opacity=".55">${ink.join("")}</g>`, `<g fill="#2b2115">${floor.join("")}</g>`);
      for (const point of visual.deathPoints!.slice(0, 200)) {
        const { x, y } = view.at(point.x, point.y);
        shapes.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="16" fill="url(#heat)"/>`, `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="#ffd0c8"/>`);
      }
    } else {
      // No traced outline yet: the dungeon's own map file when one was added to site/dungeon-maps/, else the painted scene
      // shows through a light grid.
      const mapFile = visual.mapKey && /^[a-z0-9-]{1,60}$/.test(visual.mapKey) ? fileURLToPath(new URL(`../../site/dungeon-maps/${visual.mapKey}.png`, import.meta.url)) : null;
      if (mapFile) {
        try {
          const map = await sharp(mapFile).resize(mw - 2, mh - 2, { fit: "contain", background: "#140e08" }).png().toBuffer();
          shapes.push(`<image x="${mx + 1}" y="${my + 1}" width="${mw - 2}" height="${mh - 2}" opacity=".85" href="data:image/png;base64,${map.toString("base64")}"/>`);
        } catch { /* no map file: grid only */ }
      }
      for (let g = 1; g < 8; g++) shapes.push(`<line x1="${mx + (mw * g) / 8}" y1="${my}" x2="${mx + (mw * g) / 8}" y2="${my + mh}" stroke="${th.edge}" stroke-opacity=".35"/>`);
      for (let g = 1; g < 3; g++) shapes.push(`<line x1="${mx}" y1="${my + (mh * g) / 3}" x2="${mx + mw}" y2="${my + (mh * g) / 3}" stroke="${th.edge}" stroke-opacity=".35"/>`);
      for (const point of visual.deathPoints!.slice(0, 200)) {
        const x = mx + Math.min(1, Math.max(0, point.x)) * mw, y = my + Math.min(1, Math.max(0, point.y)) * mh;
        shapes.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="22" fill="url(#heat)"/>`, `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="#ffd0c8"/>`);
      }
    }
    await put(caps(th.muted, clip(visual.deathMapLabel ?? "", 34)), 13, mx + 8, my + 4, mw - 16);
  }

  let bx = 60;
  for (const badge of card.badges ?? []) {
    const tone = badge.tone === "ok" ? th.ok : badge.tone === "warn" ? th.warn : th.quiet, ink = badge.tone === "ok" ? th.green : badge.tone === "warn" ? th.gold : th.muted;
    const t = await text(span(ink, clip(badge.text, 44)), 19, 600), w = t.width + 42;
    if (bx + w > 580) break;
    shapes.push(rect(bx, 526, w, 36, tone.fill, tone.edge, 18), `<circle cx="${bx + 19}" cy="544" r="5" fill="${ink}"/>`);
    layers.push({ input: t.input, left: bx + 32, top: 544 - Math.round(t.height / 2) });
    bx += w + 12;
  }
  shapes.push(`<rect x="60" y="578" width="1080" height="1" fill="${th.edge}"/>`);
  await put(span(th.muted, clip(card.footer, 150)), 17, 60, 590, 1080, true);
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">${shapes.join("")}</svg>`);
  return sharp(art).composite([{ input: overlay, left: 0, top: 0 }, ...layers]).png().toBuffer();
}

// The daily recap: the painted scene behind everything, the header top left, a strip of up to four stats, then one frosted
// panel per section side by side (one to three), each with up to five rows.
async function renderRecap(card: ScoreCard): Promise<Buffer> {
  const visual = card.recap!, accent = { gold: th.gold, green: th.green, red: th.red } as const, layers: Layer[] = [];
  const art = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">${dungeonArt(visual.theme)}</svg>`)).png().toBuffer();
  const shapes: string[] = [`<defs><linearGradient id="rshade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".55"/><stop offset=".45" stop-color="#000" stop-opacity=".35"/><stop offset="1" stop-color="#000" stop-opacity=".6"/></linearGradient></defs>`,
    `<rect width="1200" height="630" fill="url(#rshade)"/>`, `<rect width="12" height="630" fill="${th.bar}"/>`,
    `<rect x="26" y="14" width="1160" height="602" rx="6" fill="none" stroke="${th.frame}" stroke-width="2"/>`];
  const shadowed = async (t: { input: Buffer; width: number; height: number }, left: number, y: number) => {
    const pad = 8, shadow = await sharp(t.input).extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .linear([0, 0, 0, 0.85], [0, 0, 0, 0]).blur(3.5).png().toBuffer();
    layers.push({ input: shadow, left: Math.round(left) - pad + 1, top: Math.round(y) - pad + 2 }, { input: t.input, left: Math.round(left), top: Math.round(y) });
  };
  const put = async (markup: string, size: number, left: number, y: number, maxWidth = 1080, shade = false) => {
    const t = await text(markup, size, maxWidth);
    if (shade) await shadowed(t, left, y); else layers.push({ input: t.input, left: Math.round(left), top: Math.round(y) });
    return t;
  };
  const putRight = async (markup: string, size: number, right: number, y: number) => {
    const t = await text(markup, size, 200); layers.push({ input: t.input, left: Math.round(right - t.width), top: Math.round(y) }); return t;
  };
  await put(caps(th.gold, clip(card.eyebrow ?? "Guilded", 44)), 20, 60, 38, 700, true);
  const titleLen = [...drawable(card.title)].length;
  await put(span(th.ink, clip(card.title, 34)), titleLen <= 20 ? 52 : 40, 58, 64, 1080, true);
  await put(span(th.muted, clip(card.subtitle, 60)), 24, 60, 132, 1080, true);

  // Stats strip.
  const stats = card.stats.slice(0, 4);
  const sw = stats.length ? Math.floor((1080 - (stats.length - 1) * 16) / stats.length) : 0;
  for (const [i, stat] of stats.entries()) {
    const x = 60 + i * (sw + 16), color = accent[stat.accent ?? "gold"];
    shapes.push(rect(x, 178, sw, 92, th.bg, th.edge, 12).replace("/>", ' fill-opacity=".62"/>'), `<rect x="${x + 16}" y="196" width="4" height="20" rx="2" fill="${color}"/>`);
    await put(caps(th.muted, clip(stat.label, 26)), 14, x + 28, 196, sw - 40);
    await put(span(color, clip(stat.value, 10)), 38, x + 16, 218, sw - 32);
  }

  // Section panels: frosted art behind each.
  const sections = visual.sections.slice(0, 3), top = 290, ph = 276;
  const pw = sections.length ? Math.floor((1080 - (sections.length - 1) * 20) / sections.length) : 0;
  for (const [i, section] of sections.entries()) {
    const px = 60 + i * (pw + 20);
    const frost = await sharp(art).extract({ left: px, top, width: pw, height: ph }).blur(14).modulate({ brightness: 0.5, saturation: 0.95 })
      .composite([{ input: Buffer.from(`<svg width="${pw}" height="${ph}"><rect width="${pw}" height="${ph}" rx="14"/></svg>`), blend: "dest-in" }]).png().toBuffer();
    shapes.push(`<image x="${px}" y="${top}" width="${pw}" height="${ph}" href="data:image/png;base64,${frost.toString("base64")}"/>`,
      `<rect x="${px}" y="${top}" width="${pw}" height="${ph}" rx="14" fill="${th.bg}" fill-opacity=".35" stroke="${th.edge}" stroke-width="1.5"/>`,
      `<rect x="${px + 20}" y="${top + 44}" width="${pw - 40}" height="1" fill="${th.edge}"/>`);
    const chars = Math.max(12, Math.floor(pw / 12.5)), subChars = Math.max(16, Math.floor((pw - 40) / 7.5));
    await put(caps(th.gold, clip(section.title, Math.floor(pw / 12))), 15, px + 20, top + 16, pw - 40);
    const hasRight = section.rows.some(row => row.right);
    for (const [r, row] of section.rows.slice(0, 5).entries()) {
      const ry = top + 56 + r * 44;
      await put(span(row.color ?? th.ink, clip(row.name, hasRight ? chars - 6 : chars)), 20, px + 20, ry, pw - (hasRight ? 110 : 40));
      if (row.sub) await put(span(th.muted, clip(row.sub, subChars)), 14, px + 20, ry + 24, pw - 40);
      if (row.right) await putRight(span(accent[row.rightTone ?? "gold"], clip(row.right, 8)), 22, px + pw - 20, ry + 2);
    }
  }
  shapes.push(`<rect x="60" y="578" width="1080" height="1" fill="${th.edge}"/>`);
  await put(span(th.muted, clip(card.footer, 150)), 17, 60, 590, 1080, true);
  const overlay = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">${shapes.join("")}</svg>`);
  return sharp(art).composite([{ input: overlay, left: 0, top: 0 }, ...layers]).png().toBuffer();
}

/** Words wrapped to at most `maxLines` lines of about `chars` characters; the last line ends in an ellipsis if text is left over. */
function wrap(body: string, chars: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of body.split(/\s+/).filter(Boolean)) {
    if (line && [...line].length + 1 + [...word].length > chars) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = clip(`${kept[maxLines - 1]} ${lines[maxLines]}`, chars);
  return kept;
}
/** Role colours can be near-black on this dark card: mix dark ones toward white so the pill stays readable. */
function legible(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return th.muted;
  const channels = [0, 2, 4].map(i => parseInt(m[1]!.slice(i, i + 2), 16));
  const luma = (0.299 * channels[0]! + 0.587 * channels[1]! + 0.114 * channels[2]!) / 255;
  const mix = luma < 0.45 ? (0.45 - luma) * 1.6 : 0;
  return `#${channels.map(c => Math.round(c + (255 - c) * mix).toString(16).padStart(2, "0")).join("")}`;
}
const sparkle = (cx: number, cy: number, r: number, color: string, opacity: number) =>
  `<path d="M${cx} ${cy - r}Q${cx} ${cy} ${cx + r} ${cy}Q${cx} ${cy} ${cx} ${cy + r}Q${cx} ${cy} ${cx - r} ${cy}Q${cx} ${cy} ${cx} ${cy - r}Z" fill="${color}" fill-opacity="${opacity}"/>`;

/**
 * The achievement-unlocked card. One unlock: the badge is the hero, in a tier-coloured glow, with the name,
 * description and tier ribbon beside it. Several: a "+N" headline, progress and tier counts on the left, and
 * a list (up to 4) or a grid (up to 8, then "+N more") of the new achievements on the right.
 */
async function renderUnlock(card: ScoreCard): Promise<Buffer> {
  const all = card.unlocks!, shapes = chrome(), layers: Layer[] = [];
  const put = async (markup: string, size: number, left: number, top: number, maxWidth = 1080) => {
    const t = await text(markup, size, maxWidth); layers.push({ input: t.input, left: Math.round(left), top: Math.round(top) }); return t;
  };
  const putRight = async (markup: string, size: number, right: number, top: number) => {
    const t = await text(markup, size, 400); layers.push({ input: t.input, left: Math.round(right - t.width), top: Math.round(top) }); return t;
  };
  const putCentre = async (markup: string, size: number, centre: number, top: number) => {
    const t = await text(markup, size, 300); layers.push({ input: t.input, left: Math.round(centre - t.width / 2), top: Math.round(top) });
  };
  /** A pill sized to its text: tinted with a diamond for a tier, quiet with a dot otherwise. Returns its width. */
  const pill = async (x: number, y: number, label: string, color: string, tinted: boolean) => {
    const t = await text(tinted ? caps(color, clip(label, 28)) : span(color, clip(label, 28)), tinted ? 17 : 19, 400);
    const w = t.width + 52;
    shapes.push(`<rect x="${x}" y="${y}" width="${w}" height="38" rx="19" fill="${tinted ? color : th.quiet.fill}" fill-opacity="${tinted ? 0.16 : 1}" stroke="${tinted ? color : th.quiet.edge}" stroke-width="1.5"/>`,
      tinted ? `<path d="M${x + 22} ${y + 12}l7 7-7 7-7-7z" fill="${color}"/>` : `<circle cx="${x + 22}" cy="${y + 19}" r="4.5" fill="${th.muted}"/>`);
    layers.push({ input: t.input, left: x + 38, top: y + 19 - Math.round(t.height / 2) });
    return w;
  };
  const progressBar = (x: number, y: number, w: number, h: number, ratio: number) => {
    const fill = Math.max(h, Math.round(w * Math.min(1, Math.max(0, ratio))));
    shapes.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="#1a120a" stroke="${th.edge}" stroke-width="1.5"/>`,
      `<rect x="${x + 2}" y="${y + 2}" width="${fill - 4}" height="${h - 4}" rx="${(h - 4) / 2}" fill="url(#bar)"/>`);
  };
  shapes.push(`<defs><linearGradient id="bar" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#a87a14"/><stop offset="1" stop-color="${th.gold}"/></linearGradient></defs>`);

  // Header: eyebrow, member name (shrinks with its length), subtitle.
  const single = all.length === 1, lead = single ? 1080 : 500, len = [...card.title].length;
  const size = len <= 14 ? 62 : len <= 22 ? 54 : len <= 30 ? 46 : 40;
  // A Discord avatar (added at delivery) sits left of the name in a gold ring; an unreadable image is skipped.
  let nameX = 58;
  if (card.portrait) {
    try {
      const avatar = await sharp(Buffer.from(card.portrait, "base64")).resize(80, 80, { fit: "cover" })
        .composite([{ input: Buffer.from(`<svg width="80" height="80"><circle cx="40" cy="40" r="40"/></svg>`), blend: "dest-in" }]).png().toBuffer();
      shapes.push(`<circle cx="100" cy="104" r="44" fill="${th.panel}" stroke="${th.gold}" stroke-width="2.5"/>`);
      layers.push({ input: avatar, left: 60, top: 64 });
      nameX = 162;
    } catch { /* no avatar */ }
  }
  await put(caps(th.gold, clip(card.eyebrow ?? "Guilded", 44)), 20, 60, 40, lead);
  await put(span(th.ink, clip(card.title, single ? 36 : 24)), nameX > 100 ? Math.min(size, 50) : size, nameX, 68 + (62 - (nameX > 100 ? Math.min(size, 50) : size)) / 2 + (nameX > 100 ? 10 : 0), lead - nameX);
  // Discord role as a pill at the right of the header (single-unlock layout; the batch layouts have no room).
  if (single && card.rank) {
    const color = legible(card.rank.color), t = await text(span(color, clip(card.rank.label, 24)), 21, 400), w = t.width + 52, x = 1140 - w;
    shapes.push(`<rect x="${x}" y="76" width="${w}" height="40" rx="20" fill="${color}" fill-opacity=".14" stroke="${color}" stroke-width="1.5"/>`, `<circle cx="${x + 22}" cy="96" r="6" fill="${color}"/>`);
    layers.push({ input: t.input, left: x + 38, top: 96 - Math.round(t.height / 2) });
  }
  await put(span(th.muted, clip(card.subtitle, single ? 90 : 38)), 25, 60, nameX > 100 ? 156 : 146, lead);

  const progress = card.progress;
  if (single) {
    const hero = all[0]!, cx = 255, cy = 392, color = hero.color;
    // Glow, a ring with tick marks, a few sparkles, then the badge itself.
    shapes.push(`<defs><radialGradient id="glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${color}" stop-opacity=".55"/><stop offset=".55" stop-color="${color}" stop-opacity=".16"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient></defs>`,
      `<circle cx="${cx}" cy="${cy}" r="215" fill="url(#glow)"/>`,
      `<circle cx="${cx}" cy="${cy}" r="158" fill="${th.panel}" fill-opacity=".65" stroke="${color}" stroke-opacity=".55" stroke-width="2"/>`,
      ...Array.from({ length: 36 }, (_, i) => {
        const a = (i * Math.PI) / 18, outer = i % 3 === 0 ? 182 : 174;
        return `<line x1="${(cx + 166 * Math.cos(a)).toFixed(1)}" y1="${(cy + 166 * Math.sin(a)).toFixed(1)}" x2="${(cx + outer * Math.cos(a)).toFixed(1)}" y2="${(cy + outer * Math.sin(a)).toFixed(1)}" stroke="${color}" stroke-opacity="${i % 3 === 0 ? 0.55 : 0.3}" stroke-width="2"/>`;
      }),
      sparkle(cx + 150, cy - 140, 13, color, 0.9), sparkle(cx - 160, cy - 100, 8, th.ink, 0.7), sparkle(cx + 170, cy + 92, 9, th.ink, 0.6), sparkle(cx - 124, cy + 136, 11, color, 0.8),
      `<svg x="${cx - 128}" y="${cy - 128}" width="256" height="256" viewBox="0 0 64 64">${hero.icon}</svg>`);

    const x = 500, ribbon = await pill(x, 212, hero.tier, color, true);
    await pill(x + ribbon + 12, 212, hero.group, th.muted, false);
    const nlen = [...hero.name].length, nsize = nlen <= 14 ? 68 : nlen <= 20 ? 58 : 48;
    const name = await put(span(color, clip(hero.name, 30)), nsize, x - 2, 262, 650);
    let y = 262 + name.height + 6;
    for (const line of wrap(hero.detail, 44, 2)) { const t = await put(span(th.ink, line), 27, x, y, 650); y += t.height + 2; }
    if (progress) {
      shapes.push(`<rect x="${x}" y="444" width="4" height="22" rx="2" fill="${th.gold}"/>`);
      await put(caps(th.muted, clip(progress.label, 36)), 17, x + 16, 446, 640);
      const value = await put(span(th.gold, `${progress.value}/${progress.max}`), 58, x - 2, 470, 300);
      const bx = x + Math.max(150, value.width + 28);
      progressBar(bx, 494, 1140 - bx, 20, progress.value / Math.max(1, progress.max));
      if (progress.note) await putRight(span(th.muted, progress.note), 19, 1140, 522);
    }
  } else {
    // Left column: the "+N" headline, overall progress, tier counts.
    const [big] = card.stats;
    shapes.push(`<rect x="60" y="218" width="4" height="24" rx="2" fill="${th.gold}"/>`);
    await put(caps(th.muted, clip(big?.label ?? "", 30)), 17, 76, 220, lead);
    await put(span(th.gold, clip(big?.value ?? `+${all.length}`, 6)), 124, 54, 240, lead);
    if (progress) {
      shapes.push(`<rect x="60" y="404" width="4" height="20" rx="2" fill="${th.gold}"/>`);
      await put(caps(th.muted, clip(progress.label, 30)), 15, 76, 406, lead);
      await put(span(th.gold, `${progress.value}/${progress.max}`), 44, 58, 426, 300);
      if (progress.note) await putRight(span(th.muted, progress.note), 19, 500, 440);
      progressBar(60, 494, 440, 16, progress.value / Math.max(1, progress.max));
    }
    let bx = 60;
    for (const tier of card.tierCounts ?? []) {
      const w = await pill(bx, 526, `${tier.count} ${tier.label}`, tier.color, true);
      bx += w + 10;
      if (bx > 440) break;
    }

    // Right panel: a list of up to four large rows, or a grid of up to eight tiles ("+N more" takes the last one).
    const px = 560, pw = 580, top = 60, grid = all.length > 4, area = top + 70;
    const limit = grid ? ((card.unlocksMore ?? 0) > 0 || all.length > 8 ? 7 : 8) : 4, shown = all.slice(0, limit);
    const more = (card.unlocksMore ?? 0) + (grid ? all.length - shown.length : 0);
    shapes.push(rect(px, top, pw, 450, th.panel, th.edge, 14));
    await put(caps(th.muted, clip(card.rowsLabel ?? "", 40)), 17, px + 28, top + 22, pw - 56);
    shapes.push(`<rect x="${px + 28}" y="${top + 54}" width="${pw - 56}" height="1" fill="${th.edge}"/>`);
    if (!grid) {
      const rowH = Math.min(170, Math.floor(372 / shown.length)), big = rowH >= 120;
      for (const [i, row] of shown.entries()) {
        const ry = area + i * rowH, bs = Math.min(112, rowH - 16), tx = px + 28 + bs + 18, tw = pw - 56 - bs - 18;
        if (i) shapes.push(`<rect x="${px + 28}" y="${ry - 6}" width="${pw - 56}" height="1" fill="${th.edge}" fill-opacity=".6"/>`);
        shapes.push(`<svg x="${px + 28}" y="${ry + Math.round((rowH - 6 - bs) / 2)}" width="${bs}" height="${bs}" viewBox="0 0 64 64">${row.icon}</svg>`);
        const tier = await putRight(span(row.color, clip(row.tier, 12)), big ? 24 : 22, px + pw - 28, ry + (big ? 18 : 4));
        const nameT = await put(span(row.color, clip(row.name, 24)), big ? 29 : 27, tx, ry + (big ? 16 : 2), tw - tier.width - 10);
        let ty = ry + (big ? 16 : 2) + nameT.height + 6;
        for (const line of wrap(row.detail, 44, 2)) { const t = await put(span(th.muted, line), big ? 20 : 17, tx, ty, tw); ty += t.height + 1; }
      }
    } else {
      const tw = (pw - 56 - 16) / 2, tileH = 88, at = (i: number) => ({ x: px + 28 + (i % 2) * (tw + 16), y: area + Math.floor(i / 2) * (tileH + 6) });
      for (const [i, row] of shown.entries()) {
        const { x, y } = at(i);
        shapes.push(`<rect x="${x}" y="${y}" width="${tw}" height="${tileH}" rx="10" fill="#1a120a" stroke="${row.color}" stroke-opacity=".5" stroke-width="1.5"/>`,
          `<svg x="${x + 10}" y="${y + 14}" width="60" height="60" viewBox="0 0 64 64">${row.icon}</svg>`);
        let ty = y + 7;
        for (const line of wrap(row.name, 17, 2)) { await put(span(th.ink, line), 18, x + 80, ty, tw - 88); ty += 23; }
        await put(span(row.color, clip(row.tier, 12)), 16, x + 80, y + tileH - 28, tw - 88);
      }
      if (more > 0) {
        const { x, y } = at(shown.length);
        shapes.push(`<rect x="${x}" y="${y}" width="${tw}" height="${tileH}" rx="10" fill="none" stroke="${th.edge}" stroke-width="1.5" stroke-dasharray="6 5"/>`);
        await putCentre(span(th.gold, `+${more}`), 40, x + tw / 2, y + 6);
        await putCentre(caps(th.muted, card.moreLabel ?? "more"), 15, x + tw / 2, y + 58);
      }
    }
  }

  shapes.push(`<rect x="60" y="578" width="1080" height="1" fill="${th.edge}"/>`);
  await put(span(th.muted, clip(card.footer, 150)), 17, 60, 590);
  const base = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">${shapes.join("")}</svg>`);
  return sharp(base).composite(layers).png().toBuffer();
}

/**
 * The roster card: class rows with one bar segment per level band (class colour, darker = higher band) on the left,
 * the profession grid on the right (a profession nobody has is drawn red). Bounded: at most 13 class rows and 12
 * profession tiles, so 0, 1 or 150 members never overlap.
 */
async function renderRoster(card: ScoreCard): Promise<Buffer> {
  const data = card.roster!, shapes = chrome(), layers: Layer[] = [];
  const put = async (markup: string, size: number, left: number, top: number, maxWidth = 1080) => {
    const t = await text(markup, size, maxWidth); layers.push({ input: t.input, left: Math.round(left), top: Math.round(top) }); return t;
  };
  const putRight = async (markup: string, size: number, right: number, top: number) => {
    const t = await text(markup, size, 300); layers.push({ input: t.input, left: Math.round(right - t.width), top: Math.round(top) }); return t;
  };
  await put(caps(th.gold, clip(card.eyebrow ?? "Guilded", 44)), 20, 60, 40);
  await put(span(th.ink, clip(card.title, 40)), 56, 58, 66, 1080);
  await put(span(th.muted, clip(card.subtitle, 90)), 24, 60, 142);

  // Left panel: classes by level band.
  const lx = 60, ly = 188, lw = 590, lh = 372, opacity = [0.35, 0.55, 0.78, 1];
  shapes.push(rect(lx, ly, lw, lh, th.panel, th.edge, 14));
  data.bands.slice(0, 4).forEach((band, i) => shapes.push(`<rect x="${lx + 24 + i * 112}" y="${ly + 18}" width="14" height="14" rx="3" fill="${th.gold}" fill-opacity="${opacity[i] ?? 1}"/>`));
  for (const [i, band] of data.bands.slice(0, 4).entries()) await put(span(th.muted, clip(band, 8)), 16, lx + 44 + i * 112, ly + 14, 90);
  const classes = data.classes.slice(0, 13);
  if (!classes.length) {
    await put(span(th.muted, "—"), 30, lx + 24, ly + 120, lw - 48);
  } else {
    const rowH = Math.min(28, Math.floor((lh - 70) / classes.length)), barX = lx + 170, barW = lw - 170 - 70, max = Math.max(1, ...classes.map((c) => c.total));
    for (const [i, c] of classes.entries()) {
      const y = ly + 54 + i * rowH, color = legible(c.color);
      await putRight(span(color, clip(c.name, 14)), Math.min(20, rowH - 4), barX - 12, y);
      let x = barX;
      for (const [band, count] of c.byBand.entries()) {
        const w = count ? Math.max(2, Math.round((count / max) * barW)) : 0;
        if (w) shapes.push(`<rect x="${x}" y="${y + 2}" width="${w}" height="${Math.max(8, rowH - 8)}" fill="${c.color}" fill-opacity="${opacity[band] ?? 1}"/>`);
        x += w;
      }
      await put(span(th.ink, String(c.total)), Math.min(19, rowH - 5), x + 8, y, 60);
    }
  }

  // Right panel: profession grid, 3 columns.
  const rx = 674, rw = 466, tiles = data.professions.slice(0, 12), tw = Math.floor((rw - 48 - 16) / 3), th2 = 66;
  shapes.push(rect(rx, ly, rw, lh, th.panel, th.edge, 14));
  await put(caps(th.muted, card.rosterProfessionsLabel ?? "Professions"), 16, rx + 24, ly + 14, rw - 48);
  for (const [i, p] of tiles.entries()) {
    const x = rx + 24 + (i % 3) * (tw + 8), y = ly + 52 + Math.floor(i / 3) * (th2 + 8), gap = p.crafters === 0;
    shapes.push(`<rect x="${x}" y="${y}" width="${tw}" height="${th2}" rx="8" fill="${gap ? th.warn.fill : th.ok.fill}" stroke="${gap ? th.red : th.ok.edge}" stroke-width="1.5"/>`);
    await put(span(th.ink, clip(p.name, 14)), 16, x + 8, y + 6, tw - 10);
    await put(span(gap ? th.red : th.green, gap ? "0" : String(p.crafters)), 24, x + 10, y + 28, 60);
    if (!gap) await putRight(span(th.muted, String(p.maxSkill)), 17, x + tw - 10, y + 36);
  }

  shapes.push(`<rect x="60" y="578" width="1080" height="1" fill="${th.edge}"/>`);
  await put(span(th.muted, clip(card.footer, 150)), 17, 60, 590);
  const base = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">${shapes.join("")}</svg>`);
  return sharp(base).composite(layers).png().toBuffer();
}

// Cache by the complete facts, not a player id, so changed scores immediately get a different image.
// Bound both memory (32 images) and concurrent render work (2 distinct images); null means busy.
export async function scoreCardPng(card: ScoreCard): Promise<Buffer | null> {
  const key = createHash("sha256").update(JSON.stringify(card)).digest("hex");
  const cached = images.get(key);
  if (cached) return cached;
  let work = pending.get(key);
  if (!work) {
    if (pending.size >= 2) return null;
    work = render(card);
    pending.set(key, work);
  }
  try {
    const binaryBody = await work;
    images.set(key, binaryBody);
    while (images.size > 32) images.delete(images.keys().next().value!);
    return binaryBody;
  } finally { if (pending.get(key) === work) pending.delete(key); }
}

// Only call after the route has checked public visibility.
export async function scoreCardResponse(card: ScoreCard, head = false): Promise<WebResponse> {
  const headers = { "content-type": "image/png", "cache-control": "no-store", "x-content-type-options": "nosniff" };
  if (head) return { status: 200, headers, body: "" };
  const binaryBody = await scoreCardPng(card);
  return binaryBody ? { status: 200, headers, body: "", binaryBody } : { status: 503, headers: { ...headers, "retry-after": "2" }, body: "" };
}
