import { fileURLToPath } from "node:url";
import sharp, { type OverlayOptions } from "sharp";

/**
 * Drawing kit of the redesigned Discord cards (13 Nov 2026, owner-approved mock-ups "A art first" and "C banner and body").
 * It is deliberately free of any card definition: card-layouts-next.ts builds the two layouts on top of it and, later, the
 * existing ScoreCard types are switched to them one group at a time.
 *
 * Rules every string obeys (both are enforced here and by tests/card-kit.test.ts):
 *  - never smaller than MIN_TEXT_PX (24 px: about 8 px when Discord shows a 1200 px card 400 px wide). Long strings shrink to the
 *    floor, then end with an ellipsis;
 *  - at least MIN_CONTRAST:1 against the brightest 5 % of the pixels behind the string (painting, overlays and panels, measured
 *    before the text is drawn).
 * Upright Carlito (SIL OFL, site/fonts/CARLITO-LICENSE.txt) is the face for hero lines, names and numbers; the shipped Source Serif
 * italic stays for card titles only.
 */
export const CARD_W = 1200, CARD_H = 630;
export const MIN_TEXT_PX = 24;
export const MIN_CONTRAST = 4.5;
export const INK = "#f8f1e1", SUB = "#ddd4c0", GOOD = "#86e66a";

const font = (file: string) => fileURLToPath(new URL(`../../site/fonts/${file}`, import.meta.url));
const FACES = {
  serif: { family: "Source Serif 4", file: font("source-serif-latin.ttf") },
  sans: { family: "Carlito", file: font("Carlito-Regular.ttf") },
  bold: { family: "Carlito Bold", file: font("Carlito-Bold.ttf") }
} as const;
export type Face = keyof typeof FACES;

/** Accent colour per card type; `tint` is the lighter shade used for small coloured text so it keeps its contrast. */
export const ACCENTS = {
  duel: { accent: "#ff4d4d", tint: "#ff8f80" },
  battleground: { accent: "#e0265a", tint: "#ff7fa6" },
  dungeon: { accent: "#22b8a8", tint: "#6fe3d6" },
  crafting: { accent: "#cd8a4b", tint: "#e8aa72" },
  weekly: { accent: "#ffd100", tint: "#ffd100" },
  raid: { accent: "#ff9a2e", tint: "#ffb366" },
  roster: { accent: "#6aa8ff", tint: "#9cc4ff" },
  achievement: { accent: "#c084fc", tint: "#d8b4fe" }
} as const;
export type AccentKey = keyof typeof ACCENTS;

const EMBLEMS = {
  duel: '<path d="M10 54 L46 14 M54 54 L18 14 M6 46 L22 58 M58 46 L42 58"/><path d="M46 14 L54 8 M18 14 L10 8"/>',
  flag: '<path d="M16 8 V58"/><path d="M16 10 H52 L43 22 L52 34 H16 Z"/>',
  cup: '<path d="M20 10 H44 V26 Q44 40 32 42 Q20 40 20 26 Z"/><path d="M32 42 V52 M22 57 H42 M20 14 H10 Q10 28 20 30 M44 14 H54 Q54 28 44 30"/>',
  bars: '<rect x="8" y="34" width="14" height="22"/><rect x="25" y="14" width="14" height="42"/><rect x="42" y="26" width="14" height="30"/>',
  flame: '<path d="M32 5 C40 20 52 26 50 42 C48 54 40 59 32 59 C22 59 14 53 14 42 C14 32 22 28 26 18 C28 24 30 26 32 29 C35 20 32 12 32 5 Z"/>',
  gate: '<path d="M10 58 V26 Q10 8 32 8 Q54 8 54 26 V58 Z"/><path d="M32 8 V58 M10 36 H54"/>',
  anvil: '<path d="M8 20 H50 Q56 20 56 28 H40 Q36 34 36 40 V46 H44 V54 H20 V46 H28 V40 Q28 34 24 28 H8 Z"/>',
  star: '<path d="M32 6 L39 24 L58 25 L43 37 L48 56 L32 45 L16 56 L21 37 L6 25 L25 24 Z"/>',
  crown: '<path d="M8 48 L12 20 L24 34 L32 14 L40 34 L52 20 L56 48 Z"/><path d="M8 56 H56"/>',
  people: '<circle cx="24" cy="22" r="9"/><path d="M6 54 Q6 36 24 36 Q42 36 42 54 Z"/><circle cx="46" cy="26" r="7"/><path d="M40 40 Q58 38 58 54 H46"/>'
} as const;
export type EmblemKind = keyof typeof EMBLEMS;

export interface TextOptions { size: number; color?: string; face?: Face; maxW?: number; anchor?: "l" | "r" | "c"; spacing?: number }
export interface DrawnText { data: Buffer; left: number; top: number; w: number; h: number; color: string; size: number; str: string }
export interface TextReport { text: string; size: number; ratio: number }

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function luminance(r: number, g: number, b: number): number {
  const lin = [r, g, b].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }) as [number, number, number];
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
const hexLum = (hex: string) => luminance(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16));
export const contrastRatio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

async function drawRaw(str: string, color: string, size: number, face: Face, spacing?: number) {
  const f = FACES[face];
  const markup = `<span foreground="${color}"${spacing ? ` letter_spacing="${spacing}"` : ""}>${esc(str)}</span>`;
  const { data, info } = await sharp({ text: { text: markup, font: `${f.family} ${size}`, fontfile: f.file, rgba: true, wrap: "none" } }).png().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

/** One card being drawn: shapes (one SVG layer) and text (drawn last, so the contrast can be measured against everything behind it). */
export class CardCanvas {
  private svg = "";
  private n = 0;
  readonly texts: DrawnText[] = [];

  private id(prefix: string) { return `${prefix}${this.n++}`; }
  raw(markup: string) { this.svg += markup; }
  rect(x: number, y: number, w: number, h: number, fill: string, o: { rx?: number; opacity?: number; stroke?: string; strokeWidth?: number } = {}) {
    this.svg += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${o.rx ?? 0}" fill="${fill}"${o.opacity != null ? ` fill-opacity="${o.opacity}"` : ""}${o.stroke ? ` stroke="${o.stroke}" stroke-width="${o.strokeWidth ?? 2}"` : ""}/>`;
  }
  /** A black gradient: `dir` "h" runs left to right, "v" top to bottom; stops are [offset 0-1, colour, opacity]. */
  gradient(x: number, y: number, w: number, h: number, dir: "h" | "v", stops: [number, string, number][]) {
    const id = this.id("g");
    this.svg += `<defs><linearGradient id="${id}" x1="0" y1="0" x2="${dir === "h" ? 1 : 0}" y2="${dir === "v" ? 1 : 0}">${stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join("")}</linearGradient></defs><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${id})"/>`;
  }
  emblem(kind: EmblemKind, x: number, y: number, size: number, color: string) {
    this.svg += `<g transform="translate(${x} ${y}) scale(${size / 64})" fill="none" stroke="${color}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round">${EMBLEMS[kind]}</g>`;
  }
  /** Draws a string at (x, y = top of its box). Below MIN_TEXT_PX is a programming error; too wide shrinks to the floor, then ends with an ellipsis. */
  async text(str: string, x: number, y: number, o: TextOptions): Promise<{ w: number; h: number; right: number; bottom: number }> {
    if (o.size < MIN_TEXT_PX) throw new Error(`Card text "${str}" is ${o.size}px, below the ${MIN_TEXT_PX}px floor.`);
    const color = o.color ?? INK, face = o.face ?? "sans";
    let size = o.size, s = [...str].join("");
    let r = await drawRaw(s, color, size, face, o.spacing);
    while (o.maxW && r.w > o.maxW && size > MIN_TEXT_PX) { size = Math.max(MIN_TEXT_PX, size - 2); r = await drawRaw(s, color, size, face, o.spacing); }
    while (o.maxW && r.w > o.maxW && s.length > 2) { s = `${s.slice(0, -2).trimEnd()}…`; r = await drawRaw(s, color, size, face, o.spacing); }
    const left = Math.round(o.anchor === "r" ? x - r.w : o.anchor === "c" ? x - r.w / 2 : x);
    this.texts.push({ data: r.data, left, top: Math.round(y), w: r.w, h: r.h, color, size, str: s });
    return { w: r.w, h: r.h, right: left + r.w, bottom: y + r.h };
  }

  /** Composites `layers` (the painting first), then the shapes, then the text; returns the PNG and the contrast report of every string. */
  async finish(layers: OverlayOptions[]): Promise<{ png: Buffer; report: TextReport[] }> {
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_W}" height="${CARD_H}">${this.svg}</svg>`);
    const base = await sharp({ create: { width: CARD_W, height: CARD_H, channels: 3, background: "#0b0907" } }).composite([...layers, { input: svg, left: 0, top: 0 }]).png().toBuffer();
    const px = await sharp(base).removeAlpha().raw().toBuffer();
    const report = this.texts.map((t) => ({ text: t.str, size: t.size, ratio: contrastRatio(hexLum(t.color), backdropLuminance(px, t)) }));
    const png = await sharp(base).composite(this.texts.map((t) => ({ input: t.data, left: t.left, top: t.top }))).png().toBuffer();
    return { png, report };
  }
}

/** The 95th-percentile luminance of the pixels under a string's box (sampled every second pixel). */
function backdropLuminance(px: Buffer, t: { left: number; top: number; w: number; h: number }): number {
  const values: number[] = [];
  for (let y = Math.max(0, t.top); y < Math.min(CARD_H, t.top + t.h); y += 2) for (let x = Math.max(0, t.left); x < Math.min(CARD_W, t.left + t.w); x += 2) {
    const i = (y * CARD_W + x) * 3;
    values.push(luminance(px[i] ?? 0, px[i + 1] ?? 0, px[i + 2] ?? 0));
  }
  values.sort((a, b) => a - b);
  return values.length ? values[Math.floor(values.length * 0.95)] ?? 0 : 0;
}

/** Throws a readable error when any string breaks the size or contrast rule (used by the tests and by preview scripts). */
export function assertCardRules(report: TextReport[]): void {
  const small = report.find((r) => r.size < MIN_TEXT_PX);
  if (small) throw new Error(`"${small.text}" is ${small.size}px (minimum ${MIN_TEXT_PX}px)`);
  const dim = report.find((r) => r.ratio < MIN_CONTRAST);
  if (dim) throw new Error(`"${dim.text}" has contrast ${dim.ratio.toFixed(2)}:1 (minimum ${MIN_CONTRAST}:1)`);
}
