import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import type { WebResponse } from "./web-app.js";

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
  /** Race layout (8.5): class-coloured level bars in two columns, up to 14. */
  race?: CardRaceBar[] }

const fontfile = fileURLToPath(new URL("../../site/fonts/source-serif-latin.ttf", import.meta.url));
const images = new Map<string, Buffer>();
const pending = new Map<string, Promise<Buffer>>();
const escapeText = (text: string) => text.replace(/\p{Cc}/gu, " ").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
const clip = (text: string, max: number) => { const chars = [...text]; return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : text; };

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
  const titleLen = [...card.title].length, titleSize = !hasRows || titleLen <= 12 ? 62 : titleLen <= 17 ? 50 : 40;
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
