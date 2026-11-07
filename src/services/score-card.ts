import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import type { WebResponse } from "./web-app.js";
import type { RosterVisual } from "./roster-visual.js";

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
/** One bar on the race-to-60 card: `color` is the class colour, `note` a short right-hand text (for example +3 this week). */
export interface CardRaceBar { name: string; color: string; level: number; max: number; note?: string | undefined; done?: boolean | undefined }
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
  /** Race layout (8.5): class-coloured level bars in two columns, up to 14. */
  race?: CardRaceBar[];
  /** 9.1: the dungeon completion layout (themed art, party with role icons, optional death map). */
  dungeon?: DungeonVisual }

export type DungeonMotif = "cave" | "fire" | "sea" | "keep" | "mine" | "thorn";
/** One party member on a dungeon card. `guild` false marks an outsider; `color` is the class colour. */
export interface DungeonCardMember { name: string; color: string; role?: "TANK" | "HEALER" | "DPS" | undefined; roleLabel?: string | undefined; sub?: string | undefined; guild: boolean }
/**
 * Dungeon art is generated from `theme` (two colours, a silhouette motif and a seed), never copied from the game.
 * `deathPoints` are 0..1 positions on a flat map (x right, y down) and switch the death map on.
 */
export interface DungeonVisual { theme: { a: string; b: string; motif: DungeonMotif; seed: number }; party: DungeonCardMember[];
  guildLabel: string; outsiderLabel: string; moreLabel: string; /** Slug of the dungeon; `site/dungeon-maps/<mapKey>.png` is the map the deaths are drawn on, when that file exists. */ mapKey?: string; deathPoints?: { x: number; y: number }[]; deathMapLabel?: string }

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

const chrome = (): string[] => {
  const shapes = [`<rect width="1200" height="630" fill="${th.bg}"/>`, `<rect width="12" height="630" fill="${th.bar}"/>`];
  if (th.frame) shapes.push(`<rect x="26" y="14" width="1160" height="602" rx="6" fill="none" stroke="${th.frame}" stroke-width="2"/>`, `<rect x="32" y="20" width="1148" height="590" rx="4" fill="none" stroke="${th.edge}" stroke-width="1"/>`);
  return shapes;
};

// The race-to-60 layout: a header, then up to 14 bars (two columns of seven), each filled to level/max in the class colour.
async function renderRace(card: ScoreCard): Promise<Buffer> {
  const shapes = chrome();
  const layers: Layer[] = [];
  const put = async (markup: string, size: number, left: number, top: number, maxWidth = 1080) => {
    const t = await text(markup, size, maxWidth); layers.push({ input: t.input, left: Math.round(left), top: Math.round(top) }); return t;
  };
  await put(caps(th.gold, clip(card.eyebrow ?? "Guilded", 44)), 20, 60, 36, 1080);
  await put(span(th.ink, clip(card.title, 30)), 54, 60, 62, 1080);
  await put(span(th.muted, clip(card.subtitle, 90)), 23, 60, 132, 1080);
  const bars = card.race!.slice(0, 14), colW = 520, rowH = 56, top = 180;
  for (const [i, bar] of bars.entries()) {
    const col = i < 7 ? 0 : 1, x = 60 + col * (colW + 40), y = top + (i % 7) * rowH;
    const fraction = Math.max(0, Math.min(1, bar.level / Math.max(1, bar.max))), bx = x + 200, bw = 210;
    shapes.push(rect(bx, y + 12, bw, 22, "#1a120a", th.edge, 8), `<rect x="${bx}" y="${y + 12}" width="${Math.max(6, Math.round(bw * fraction))}" height="22" rx="8" fill="${bar.color}" fill-opacity="${bar.done ? 1 : 0.85}"/>`);
    await put(span(bar.color, clip(`${i + 1}. ${bar.name}`, 18)), 22, x, y + 8, 190);
    await put(span(bar.done ? th.gold : th.ink, String(bar.level)), 22, bx + bw + 12, y + 8, 60);
    if (bar.note) await put(span(th.muted, clip(bar.note, 14)), 17, bx + bw + 58, y + 12, 130);
  }
  shapes.push(`<rect x="60" y="578" width="1080" height="1" fill="${th.edge}"/>`);
  await put(span(th.muted, clip(card.footer, 150)), 17, 60, 590);
  const base = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">${shapes.join("")}</svg>`);
  return sharp(base).composite(layers).png().toBuffer();
}

async function render(card: ScoreCard): Promise<Buffer> {
  if (card.dungeon) return renderDungeon(card);
  if (card.roster) return renderRoster(card);
  if (card.unlocks?.length) return renderUnlock(card);
  if (card.race?.length) return renderRace(card);
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

const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/** Generated dungeon backdrop: a two-colour wash plus a simple silhouette motif. Original shapes, no game art. */
export function dungeonArt(theme: DungeonVisual["theme"]): string {
  const rand = rng(theme.seed), out: string[] = [];
  out.push(`<defs><linearGradient id="wash" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${theme.a}"/><stop offset="1" stop-color="${theme.b}"/></linearGradient></defs>`, `<rect width="1200" height="630" fill="url(#wash)"/>`);
  const tone = `fill="#000" fill-opacity=".38"`, light = `fill="${theme.b}" fill-opacity=".3"`;
  if (theme.motif === "cave") {
    for (let i = 0; i < 16; i++) { const x = i * 80 + rand() * 40, w = 30 + rand() * 50, h = 50 + rand() * 120; out.push(`<path d="M${x} 0L${x + w} 0L${x + w / 2} ${h}Z" ${tone}/>`); }
    for (let i = 0; i < 14; i++) { const x = i * 90 + rand() * 50, w = 40 + rand() * 60, h = 40 + rand() * 100; out.push(`<path d="M${x} 630L${x + w} 630L${x + w / 2} ${630 - h}Z" ${tone}/>`); }
    out.push(`<ellipse cx="${300 + rand() * 200}" cy="520" rx="260" ry="40" ${light}/>`);
  } else if (theme.motif === "fire") {
    out.push(`<defs><radialGradient id="lava" cx="50%" cy="100%" r="70%"><stop offset="0" stop-color="#ffb347" stop-opacity=".75"/><stop offset="1" stop-color="#ff5a1a" stop-opacity="0"/></radialGradient></defs>`, `<rect width="1200" height="630" fill="url(#lava)"/>`);
    let d = "M0 630L0 560"; for (let x = 0; x <= 1200; x += 60) d += `L${x} ${540 + rand() * 70}`; out.push(`<path d="${d}L1200 630Z" ${tone}/>`);
    for (let i = 0; i < 46; i++) out.push(`<circle cx="${rand() * 1200}" cy="${200 + rand() * 400}" r="${1 + rand() * 3.5}" fill="#ffb347" fill-opacity="${0.25 + rand() * 0.5}"/>`);
  } else if (theme.motif === "sea") {
    for (let row = 0; row < 6; row++) { let d = `M0 ${300 + row * 55}`; for (let x = 0; x <= 1200; x += 60) d += `Q${x + 30} ${300 + row * 55 + (row % 2 ? 22 : -22)} ${x + 60} ${300 + row * 55}`; out.push(`<path d="${d}" fill="none" stroke="${theme.b}" stroke-opacity="${0.18 + row * 0.04}" stroke-width="3"/>`); }
    for (let i = 0; i < 24; i++) out.push(`<circle cx="${rand() * 1200}" cy="${rand() * 630}" r="${2 + rand() * 7}" fill="none" stroke="#fff" stroke-opacity=".18"/>`);
  } else if (theme.motif === "keep") {
    out.push(`<circle cx="${880 + rand() * 200}" cy="${110 + rand() * 40}" r="54" fill="#fff" fill-opacity=".12"/>`);
    let x = 0; while (x < 1200) { const w = 70 + rand() * 90, h = 120 + rand() * 170; out.push(`<rect x="${x}" y="${630 - h}" width="${w}" height="${h}" ${tone}/>`); for (let c = 0; c < w - 10; c += 24) out.push(`<rect x="${x + c}" y="${630 - h - 14}" width="14" height="14" ${tone}/>`); x += w + 6; }
  } else if (theme.motif === "mine") {
    for (let i = 0; i < 6; i++) { const x = 70 + i * 210; out.push(`<rect x="${x}" y="0" width="22" height="630" ${tone}/>`, `<rect x="${x - 10}" y="${70 + rand() * 40}" width="230" height="20" ${tone}/>`); }
    out.push(`<circle cx="${300 + rand() * 600}" cy="${180 + rand() * 120}" r="150" fill="#ffd27a" fill-opacity=".1"/>`);
  } else {
    for (let i = 0; i < 26; i++) { const x = rand() * 1200, y = 630, h = 120 + rand() * 330, bend = (rand() - 0.5) * 220; out.push(`<path d="M${x} ${y}Q${x + bend} ${y - h / 2} ${x + bend * 1.6} ${y - h}" fill="none" stroke="#000" stroke-opacity=".34" stroke-width="${3 + rand() * 6}"/>`); }
  }
  return out.join("");
}

const roleIcon = (role: DungeonCardMember["role"], cx: number, cy: number): string => {
  if (role === "TANK") return `<path transform="translate(${cx} ${cy}) scale(1.05)" d="M0-11L10-7V2C10 8 4 11 0 13C-4 11-10 8-10 2V-7Z" fill="#5aa0e0" stroke="#cfe6ff" stroke-width="1.5"/>`;
  if (role === "HEALER") return `<path transform="translate(${cx} ${cy}) scale(.95)" d="M-3-11h6v8h8v6h-8v8h-6v-8h-8v-6h8z" fill="#6fdc4f" stroke="#d6ffc8" stroke-width="1.2"/>`;
  if (role === "DPS") return `<g transform="translate(${cx} ${cy})" stroke="#ffb09f" stroke-width="1"><rect x="-2.5" y="-13" width="5" height="22" rx="1.5" transform="rotate(40)" fill="#ff6a52"/><rect x="-2.5" y="-13" width="5" height="22" rx="1.5" transform="rotate(-40)" fill="#ff6a52"/></g>`;
  return `<circle cx="${cx}" cy="${cy}" r="5" fill="${th.muted}"/>`;
};

/**
 * The dungeon completion card: generated dungeon art behind a left column (time, final boss, deaths) and a party panel
 * (role icon, full name in class colour, class/spec/deaths, an "outside guild" mark for outsiders). With death positions
 * a small map under the party shows where the group fell; without them the card is the same, minus the map.
 */
async function renderDungeon(card: ScoreCard): Promise<Buffer> {
  const visual = card.dungeon!, accent = { gold: th.gold, green: th.green, red: th.red } as const;
  const shapes: string[] = [dungeonArt(visual.theme)], layers: Layer[] = [];
  shapes.push(`<defs><linearGradient id="shade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".72"/><stop offset=".55" stop-color="#000" stop-opacity=".5"/><stop offset="1" stop-color="#000" stop-opacity=".62"/></linearGradient></defs>`,
    `<rect width="1200" height="630" fill="url(#shade)"/>`, `<rect width="12" height="630" fill="${th.bar}"/>`,
    `<rect x="26" y="14" width="1160" height="602" rx="6" fill="none" stroke="${th.frame}" stroke-width="2"/>`);
  const put = async (markup: string, size: number, left: number, top: number, maxWidth = 1080) => {
    const t = await text(markup, size, maxWidth); layers.push({ input: t.input, left: Math.round(left), top: Math.round(top) }); return t;
  };
  const putRight = async (markup: string, size: number, right: number, top: number) => {
    const t = await text(markup, size, 300); layers.push({ input: t.input, left: Math.round(right - t.width), top: Math.round(top) }); return t;
  };
  const leftW = 500, titleLen = [...drawable(card.title)].length, titleSize = titleLen <= 12 ? 62 : titleLen <= 17 ? 50 : 40;
  await put(caps(th.gold, clip(card.eyebrow ?? "Guilded", 44)), 20, 60, 40, leftW);
  await put(span(th.ink, clip(card.title, 26)), titleSize, 58, 68 + (62 - titleSize) / 2, leftW);
  await put(span(th.muted, clip(card.subtitle, 40)), 25, 60, 146, leftW);

  const [time, boss, deaths] = card.stats;
  if (time) {
    shapes.push(`<rect x="60" y="218" width="4" height="24" rx="2" fill="${accent[time.accent ?? "gold"]}"/>`);
    await put(caps(th.muted, clip(time.label, 30)), 17, 76, 220, leftW);
    await put(span(accent[time.accent ?? "gold"], clip(time.value, 8)), 104, 56, 244, leftW);
    if (time.note) await put(span(th.ink, clip(time.note, 38)), 20, 60, 366, leftW);
  }
  const small = async (stat: CardStat | undefined, x: number, w: number, chars: number) => {
    if (!stat) return;
    shapes.push(`<rect x="${x}" y="420" width="4" height="20" rx="2" fill="${accent[stat.accent ?? "gold"]}"/>`);
    await put(caps(th.muted, clip(stat.label, 16)), 15, x + 14, 420, w);
    await put(span(accent[stat.accent ?? "gold"], clip(stat.value, chars)), stat.value.length > 16 ? 24 : 32, x - 1, 444, w);
    if (stat.note) await put(span(th.ink, clip(stat.note, 24)), 16, x + 1, 488, w);
  };
  await small(boss, 60, 310, 28);
  await small(deaths, 390, 150, 6);

  // Party panel.
  const px = 600, pw = 540, top = 60, hasMap = Boolean(visual.deathPoints?.length), maxRows = hasMap ? 5 : 6, rowH = hasMap ? 52 : 60;
  shapes.push(`<rect x="${px}" y="${top}" width="${pw}" height="450" rx="14" fill="${th.panel}" fill-opacity=".9" stroke="${th.edge}" stroke-width="1.5"/>`);
  await put(caps(th.muted, clip(card.rowsLabel ?? "", 40)), 17, px + 28, top + 22, pw - 56);
  shapes.push(`<rect x="${px + 28}" y="${top + 54}" width="${pw - 56}" height="1" fill="${th.edge}"/>`);
  const shown = visual.party.slice(0, visual.party.length > maxRows ? maxRows - 1 : maxRows);
  for (const [i, member] of shown.entries()) {
    const ry = top + 64 + i * rowH;
    if (!member.guild) shapes.push(`<rect x="${px + 16}" y="${ry - 2}" width="${pw - 32}" height="${rowH - 6}" rx="8" fill="none" stroke="${th.edge}" stroke-dasharray="5 4"/>`);
    shapes.push(roleIcon(member.role, px + 42, ry + 22));
    await put(span(member.color, clip(member.name, 24)), 24, px + 72, ry, 300);
    if (member.sub) await put(span(th.muted, clip(member.sub, 38)), 16, px + 72, ry + 29, 330);
    if (member.roleLabel) await putRight(span(th.ink, clip(member.roleLabel, 12)), 19, px + pw - 30, ry + 2);
    await putRight(member.guild ? span(th.gold, visual.guildLabel) : span(th.muted, visual.outsiderLabel), 14, px + pw - 30, ry + 30);
  }
  const hidden = visual.party.length - shown.length;
  if (hidden > 0) await put(span(th.muted, `+${hidden} ${visual.moreLabel}`), 18, px + 72, top + 64 + shown.length * rowH + 4, 300);

  if (hasMap) {
    const mx = px + 28, my = top + 64 + maxRows * rowH + 6, mw = pw - 56, mh = 450 - (my - top) - 14;
    shapes.push(`<rect x="${mx}" y="${my}" width="${mw}" height="${mh}" rx="8" fill="#140e08" stroke="${th.edge}"/>`);
    // The dungeon's own map, when one was added to site/dungeon-maps/; otherwise the plain grid below.
    const mapFile = visual.mapKey && /^[a-z0-9-]{1,60}$/.test(visual.mapKey) ? fileURLToPath(new URL(`../../site/dungeon-maps/${visual.mapKey}.png`, import.meta.url)) : null;
    if (mapFile) {
      try {
        const map = await sharp(mapFile).resize(mw - 2, mh - 2, { fit: "contain", background: "#140e08" }).png().toBuffer();
        shapes.push(`<image x="${mx + 1}" y="${my + 1}" width="${mw - 2}" height="${mh - 2}" opacity=".85" href="data:image/png;base64,${map.toString("base64")}"/>`);
      } catch { /* no map file: grid only */ }
    }
    for (let g = 1; g < 8; g++) shapes.push(`<line x1="${mx + (mw * g) / 8}" y1="${my}" x2="${mx + (mw * g) / 8}" y2="${my + mh}" stroke="${th.edge}" stroke-opacity=".35"/>`);
    for (let g = 1; g < 3; g++) shapes.push(`<line x1="${mx}" y1="${my + (mh * g) / 3}" x2="${mx + mw}" y2="${my + (mh * g) / 3}" stroke="${th.edge}" stroke-opacity=".35"/>`);
    shapes.push(`<defs><radialGradient id="heat"><stop offset="0" stop-color="#ff3b1f" stop-opacity=".75"/><stop offset="1" stop-color="#ff3b1f" stop-opacity="0"/></radialGradient></defs>`);
    for (const point of visual.deathPoints!.slice(0, 200)) {
      const x = mx + Math.min(1, Math.max(0, point.x)) * mw, y = my + Math.min(1, Math.max(0, point.y)) * mh;
      shapes.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="22" fill="url(#heat)"/>`, `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="#ffd0c8"/>`);
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
  await put(span(th.muted, clip(card.footer, 150)), 17, 60, 590);
  const base = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">${shapes.join("")}</svg>`);
  return sharp(base).composite(layers).png().toBuffer();
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
