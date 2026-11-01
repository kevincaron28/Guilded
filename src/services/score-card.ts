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
export interface CardRow { name: string; color?: string | undefined; sub?: string | undefined; right?: string | undefined; rightTone?: "gold" | "green" | "red" | undefined }
export interface CardBadge { text: string; tone?: "ok" | "warn" | "muted" }
export interface ScoreCard { eyebrow?: string; title: string; subtitle: string; stats: CardStat[]; rowsLabel?: string; rows?: CardRow[]; badges?: CardBadge[]; footer: string }

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

async function render(card: ScoreCard): Promise<Buffer> {
  const accent = { gold: th.gold, green: th.green, red: th.red } as const;
  const shapes: string[] = [`<rect width="1200" height="630" fill="${th.bg}"/>`, `<rect width="12" height="630" fill="${th.bar}"/>`];
  if (th.frame) shapes.push(`<rect x="26" y="14" width="1160" height="602" rx="6" fill="none" stroke="${th.frame}" stroke-width="2"/>`, `<rect x="32" y="20" width="1148" height="590" rx="4" fill="none" stroke="${th.edge}" stroke-width="1"/>`);
  const layers: Layer[] = [];
  const put = async (markup: string, size: number, left: number, top: number, maxWidth = 1080) => {
    const t = await text(markup, size, maxWidth); layers.push({ input: t.input, left: Math.round(left), top: Math.round(top) }); return t;
  };
  const hasRows = Boolean(card.rows?.length);
  const leftW = hasRows ? 500 : 1080;

  await put(caps(th.gold, clip(card.eyebrow ?? "Guilded · Dungeons", 44)), 20, 60, 40, leftW);
  await put(span(th.ink, clip(card.title, hasRows ? 17 : 38)), hasRows ? ([...card.title].length > 12 ? 50 : 62) : 62, 58, 68, leftW);
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
      shapes.push(`<rect x="${px + 28}" y="${ry + 4}" width="5" height="54" rx="2.5" fill="${color}"/>`);
      await put(span(color, clip(row.name, 22)), 27, px + 48, ry, 330);
      if (row.sub) await put(span(th.muted, clip(row.sub, 34)), 17, px + 48, ry + 36, 330);
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

// Only call after the route has checked public visibility. Cache by the complete
// facts, not a player id, so changed scores immediately get a different image.
// Bound both memory (32 images) and concurrent render work (2 distinct images).
export async function scoreCardResponse(card: ScoreCard, head = false): Promise<WebResponse> {
  const headers = { "content-type": "image/png", "cache-control": "no-store", "x-content-type-options": "nosniff" };
  if (head) return { status: 200, headers, body: "" };
  const key = createHash("sha256").update(JSON.stringify(card)).digest("hex");
  const cached = images.get(key);
  if (cached) return { status: 200, headers, body: "", binaryBody: cached };
  let work = pending.get(key);
  if (!work) {
    if (pending.size >= 2) return { status: 503, headers: { ...headers, "retry-after": "2" }, body: "" };
    work = render(card);
    pending.set(key, work);
  }
  try {
    const binaryBody = await work;
    images.set(key, binaryBody);
    while (images.size > 32) images.delete(images.keys().next().value!);
    return { status: 200, headers, body: "", binaryBody };
  } finally { if (pending.get(key) === work) pending.delete(key); }
}
