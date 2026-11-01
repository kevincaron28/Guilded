import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import type { WebResponse } from "./web-app.js";

/**
 * A 1200x630 share card. Reading order: what it is (eyebrow, title, subtitle), the headline
 * numbers (1-3 labelled stats), who was there (party), how far to trust it (badges), the fine print.
 */
export interface CardStat { label: string; value: string; note?: string | undefined; accent?: "gold" | "green" | "red" | undefined }
export interface CardPlayer { name: string; className?: string | null; role?: string | null }
export interface CardBadge { text: string; tone?: "ok" | "warn" | "muted" }
export interface ScoreCard { eyebrow?: string; title: string; subtitle: string; stats: CardStat[]; party?: CardPlayer[]; partyLabel?: string; badges?: CardBadge[]; footer: string }

const fontfile = fileURLToPath(new URL("../../site/fonts/source-serif-latin.ttf", import.meta.url));
const images = new Map<string, Buffer>();
const pending = new Map<string, Promise<Buffer>>();
const escapeText = (text: string) => text.replace(/\p{Cc}/gu, " ").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
const clip = (text: string, max: number) => { const chars = [...text]; return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : text; };

const INK = "#f3f1e8", MUTED = "#a9b4a7", GOLD = "#d4af37", GREEN = "#7fcf8a", RED = "#e8806f";
const ACCENT = { gold: GOLD, green: GREEN, red: RED } as const;
const TONE = { ok: { fill: "#1d3324", edge: "#3f7a50", ink: GREEN }, warn: { fill: "#352c18", edge: "#8a6e25", ink: GOLD }, muted: { fill: "#1a241d", edge: "#3a4639", ink: MUTED } } as const;
// Blizzard's class colours, keyed by the lowercase letters of the class name.
const CLASS_COLOR: Record<string, string> = { warrior: "#c79c6e", paladin: "#f58cba", hunter: "#abd473", rogue: "#fff569", priest: "#ffffff", deathknight: "#c41f3b",
  shaman: "#0070de", mage: "#69ccf0", warlock: "#9482c9", monk: "#00ff96", druid: "#ff7d0a", demonhunter: "#a330c9", evoker: "#33937f" };
export const classColor = (name: string | null | undefined) => CLASS_COLOR[(name ?? "").toLowerCase().replace(/[^a-z]/g, "")] ?? "#bfc9bd";

interface Layer { input: Buffer; left: number; top: number }
const rect = (x: number, y: number, w: number, h: number, fill: string, edge?: string, r = 12) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"${edge ? ` stroke="${edge}" stroke-width="1.5"` : ""}/>`;

/** Rendered text sized to its own content, so pills and chips can be fitted around it. */
async function text(markup: string, size: number, maxWidth: number) {
  const { data, info } = await sharp({ text: { text: markup, font: `Source Serif 4 ${size}`, fontfile, width: maxWidth, rgba: true, wrap: "none" } }).png().toBuffer({ resolveWithObject: true });
  return { input: data, width: info.width, height: info.height };
}
const span = (color: string, body: string, extra = "") => `<span foreground="${color}"${extra}>${escapeText(body || " ")}</span>`;
const caps = (color: string, body: string) => span(color, body.toUpperCase(), ' letter_spacing="1800"');

async function render(card: ScoreCard): Promise<Buffer> {
  const shapes: string[] = [`<rect width="1200" height="630" fill="#101713"/>`, `<rect width="12" height="630" fill="${GOLD}"/>`];
  const layers: Layer[] = [];
  const put = async (markup: string, size: number, left: number, top: number, maxWidth = 1080) => {
    const t = await text(markup, size, maxWidth); layers.push({ input: t.input, left: Math.round(left), top: Math.round(top) }); return t;
  };

  await put(caps(GOLD, clip(card.eyebrow ?? "Guilded · Dungeons", 60)), 21, 60, 34);
  await put(span(INK, clip(card.title, 38)), 62, 58, 62, 1080);
  await put(span(MUTED, clip(card.subtitle, 90)), 27, 60, 136);

  // Headline numbers: equal panels, label above the value, a plain-language note below.
  const stats = card.stats.slice(0, 3);
  const gap = 18, panelW = Math.floor((1080 - gap * (stats.length - 1)) / Math.max(1, stats.length)), panelTop = 196, panelH = 168;
  for (const [i, stat] of stats.entries()) {
    const x = 60 + i * (panelW + gap);
    shapes.push(rect(x, panelTop, panelW, panelH, "#17211b", "#2c382f", 14));
    shapes.push(`<rect x="${x}" y="${panelTop + 18}" width="4" height="26" rx="2" fill="${ACCENT[stat.accent ?? "gold"]}"/>`);
    await put(caps(MUTED, clip(stat.label, 26)), 18, x + 20, panelTop + 18, panelW - 36);
    const fit = [...stat.value].length > 11 ? 40 : [...stat.value].length > 7 ? 52 : 68;
    await put(span(ACCENT[stat.accent ?? "gold"], clip(stat.value, 28)), fit, x + 18, panelTop + 46, panelW - 30);
    if (stat.note) await put(span(INK, clip(stat.note, Math.floor(panelW / 11))), 21, x + 20, panelTop + panelH - 38, panelW - 36);
  }

  // Party: one chip per player, class-coloured, with the role underneath.
  const party = (card.party ?? []).slice(0, 5);
  let y = panelTop + panelH + 26;
  if (party.length) {
    await put(caps(MUTED, card.partyLabel ?? "Party"), 17, 62, y);
    y += 30;
    const chipGap = 14, chipW = Math.floor((1080 - chipGap * (party.length - 1)) / party.length), chipH = 62;
    for (const [i, p] of party.entries()) {
      const x = 60 + i * (chipW + chipGap), color = classColor(p.className);
      shapes.push(rect(x, y, chipW, chipH, "#17211b", "#2c382f", 12), `<rect x="${x}" y="${y + 10}" width="5" height="${chipH - 20}" rx="2.5" fill="${color}"/>`);
      await put(span(color, clip(p.name, Math.max(8, Math.floor(chipW / 13)))), 25, x + 20, y + 5, chipW - 28);
      const sub = [p.className, p.role].filter(Boolean).join(" · ");
      if (sub) await put(span(MUTED, clip(sub, Math.max(8, Math.floor(chipW / 10)))), 16, x + 20, y + 37, chipW - 28);
    }
    y += chipH + 20;
  }

  // Trust badges sit in a row of pills sized to their text.
  let bx = 60;
  for (const badge of card.badges ?? []) {
    const tone = TONE[badge.tone ?? "muted"];
    const t = await text(span(tone.ink, clip(badge.text, 44)), 20, 600);
    const w = t.width + 44;
    if (bx + w > 1140) break;
    shapes.push(rect(bx, y, w, 38, tone.fill, tone.edge, 19), `<circle cx="${bx + 20}" cy="${y + 19}" r="5" fill="${tone.ink}"/>`);
    layers.push({ input: t.input, left: bx + 34, top: y + 19 - Math.round(t.height / 2) });
    bx += w + 12;
  }

  shapes.push(`<rect x="60" y="578" width="1080" height="1" fill="#2c382f"/>`);
  await put(span(MUTED, clip(card.footer, 150)), 18, 60, 589);

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
