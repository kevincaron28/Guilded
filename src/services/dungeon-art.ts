import type { DungeonMotif } from "./score-card.js";

/**
 * Painted dungeon backdrops for the completion card (1200x630 SVG). Every scene is original procedural art built from
 * the dungeon's setting (layered gradients, silhouettes, mist and particles), never Blizzard artwork. A scene is
 * deterministic: the same dungeon always paints the same picture (the seed comes from its name).
 *
 * The card puts a dark shade over the left column and a frosted panel on the right, so the art is free to be rich; the
 * strongest shapes sit along the top, bottom and the middle gutter, where nothing is written.
 */
export type DungeonScene = "wailing" | "ragefire" | "deadmines" | "shadowfang" | "stockade" | "blackfathom" | "gnomeregan" | "razorfen"
  | "scarlet" | "uldaman" | "thanes" | "lordaeron" | "excavation" | "dalaran" | "zulfarrak" | "maraudon" | "blackrock" | "stratholme"
  | "scholomance" | "diremaul" | "sunken" | "forest" | "fortress";
export interface DungeonArtTheme { a: string; b: string; motif: DungeonMotif; seed: number; scene?: DungeonScene | undefined }

const W = 1200, H = 630;
type Rand = () => number;
interface Palette { sky: [string, string, string]; far: string; mid: string; near: string; glow: string; spark: string }
interface Ctx { rand: Rand; p: Palette; defs: string[]; id: (prefix: string) => string }

export const seededRandom = (seed: number): Rand => () => {
  seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const r1 = (v: number) => Math.round(v * 10) / 10;
const between = (rand: Rand, lo: number, hi: number) => lo + rand() * (hi - lo);

// ---- building blocks ----------------------------------------------------------------------------------------------

/** A smooth 1-D landscape function (three sines with random phases), roughly -1..1. */
function wave(rand: Rand, freq = 1): (x: number) => number {
  const p = [rand() * 6.283, rand() * 6.283, rand() * 6.283];
  return (x) => 0.55 * Math.sin(x * 0.0045 * freq + p[0]!) + 0.3 * Math.sin(x * 0.012 * freq + p[1]!) + 0.15 * Math.sin(x * 0.031 * freq + p[2]!);
}
/** A silhouette band across the card: hills (smooth) or rock (jagged), rising from the bottom or hanging from the top. */
function ridge(c: Ctx, base: number, amp: number, fill: string, o: { jag?: number; step?: number; top?: boolean; opacity?: number; freq?: number } = {}): string {
  const f = wave(c.rand, o.freq ?? 1), step = o.step ?? 20, jag = o.jag ?? 0;
  let d = "";
  for (let x = -40; x <= W + 40; x += step) d += `${d ? "L" : "M"}${x} ${r1(base + amp * f(x) + (c.rand() - 0.5) * jag)}`;
  const edge = o.top ? -10 : H + 10;
  return `<path d="${d}L${W + 40} ${edge}L-40 ${edge}Z" fill="${fill}"${o.opacity !== undefined ? ` fill-opacity="${o.opacity}"` : ""}/>`;
}
/** A rough rock wall down one side of the card (a cave mouth), its edge wandering around x = `base`. */
function wall(c: Ctx, base: number, amp: number, fill: string, right: boolean): string {
  const f = wave(c.rand, 2.2), edge = right ? W + 20 : -20, inward = right ? -1 : 1;
  let d = `M${edge} -20`;
  for (let y = -20; y <= H + 20; y += 18) d += `L${r1(base + amp * f(y * 1.7) + (c.rand() - 0.5) * 22 - inward * 40 * Math.sin((y / H) * Math.PI))} ${y}`;
  return `<path d="${d}L${edge} ${H + 20}Z" fill="${fill}" fill-opacity=".92"/>`;
}
/** Stalactites (from the top) or stalagmites/spires (from `base`), slightly curved. */
function spikes(c: Ctx, count: number, base: number, fill: string, o: { top?: boolean; h: [number, number]; w: [number, number]; opacity?: number; x?: [number, number] }): string {
  const out: string[] = [], [x0, x1] = o.x ?? [-20, W + 20];
  for (let i = 0; i < count; i++) {
    const x = x0 + ((i + c.rand() * 0.8) / count) * (x1 - x0), w = between(c.rand, ...o.w), h = between(c.rand, ...o.h), lean = (c.rand() - 0.5) * w * 0.6;
    const tip = o.top ? base + h : base - h;
    out.push(`<path d="M${r1(x)} ${base}Q${r1(x + w * 0.3)} ${r1((base + tip) / 2)} ${r1(x + w / 2 + lean)} ${r1(tip)}Q${r1(x + w * 0.7)} ${r1((base + tip) / 2)} ${r1(x + w)} ${base}Z" fill="${fill}"${o.opacity !== undefined ? ` fill-opacity="${o.opacity}"` : ""}/>`);
  }
  return out.join("");
}
/** A soft coloured light: an ellipse filled with a radial gradient. */
function glow(c: Ctx, cx: number, cy: number, rx: number, ry: number, color: string, opacity: number): string {
  const id = c.id("g");
  c.defs.push(`<radialGradient id="${id}"><stop offset="0" stop-color="${color}" stop-opacity="${opacity}"/><stop offset=".4" stop-color="${color}" stop-opacity="${r1(opacity * 4.5) / 10}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`);
  return `<ellipse cx="${r1(cx)}" cy="${r1(cy)}" rx="${r1(rx)}" ry="${r1(ry)}" fill="url(#${id})"/>`;
}
/** Floating particles (spores, embers, sparks, dust): a blurred halo under a crisp core. */
function motes(c: Ctx, count: number, area: [number, number, number, number], color: string, size: [number, number] = [0.8, 2.6], opacity: [number, number] = [0.35, 0.95]): string {
  const id = c.id("h"), out: string[] = [], [x, y, w, h] = area;
  c.defs.push(`<radialGradient id="${id}"><stop offset="0" stop-color="${color}" stop-opacity=".55"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`);
  for (let i = 0; i < count; i++) {
    const cx = r1(x + c.rand() * w), cy = r1(y + c.rand() * h), r = between(c.rand, ...size), o = between(c.rand, ...opacity);
    out.push(`<circle cx="${cx}" cy="${cy}" r="${r1(r * 4.5)}" fill="url(#${id})" fill-opacity="${r1(o * 10) / 10}"/>`, `<circle cx="${cx}" cy="${cy}" r="${r1(r)}" fill="${color}" fill-opacity="${r1(o * 10) / 10}"/>`);
  }
  return out.join("");
}
/** Drifting mist: wide soft ellipses around height `y` (radial gradients, cheaper to draw than a blur filter). */
function mist(c: Ctx, y: number, spread: number, color: string, opacity: number, count = 7): string {
  const id = c.id("m"), out: string[] = [];
  c.defs.push(`<radialGradient id="${id}"><stop offset="0" stop-color="${color}"/><stop offset=".5" stop-color="${color}" stop-opacity=".6"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`);
  for (let i = 0; i < count; i++) out.push(`<ellipse cx="${r1((i / count) * W + c.rand() * 160)}" cy="${r1(y + (c.rand() - 0.5) * spread)}" rx="${r1(between(c.rand, 200, 360))}" ry="${r1(between(c.rand, 34, 76))}" fill="url(#${id})" fill-opacity="${r1(opacity * between(c.rand, 0.6, 1) * 100) / 100}"/>`);
  return out.join("");
}
/** Shafts of light falling from the top edge. */
function rays(c: Ctx, count: number, color: string, opacity: number, x: [number, number], slant = 0.25): string {
  const id = c.id("r"), out: string[] = [];
  c.defs.push(`<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="${opacity}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient>`);
  for (let i = 0; i < count; i++) {
    const sx = between(c.rand, ...x), w = between(c.rand, 14, 60), len = between(c.rand, 300, 560), dx = len * slant;
    out.push(`<path d="M${r1(sx)} -10L${r1(sx + w)} -10L${r1(sx + w * 2.2 + dx)} ${r1(len)}L${r1(sx + dx)} ${r1(len)}Z" fill="url(#${id})"/>`);
  }
  return `<g filter="url(#da-b8)">${out.join("")}</g>`;
}
/** A night sky's stars. */
function stars(c: Ctx, count: number, maxY: number, color = "#ffffff"): string {
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(`<circle cx="${r1(c.rand() * W)}" cy="${r1(c.rand() * maxY)}" r="${r1(between(c.rand, 0.4, 1.5))}" fill="${color}" fill-opacity="${r1(between(c.rand, 0.25, 0.9) * 100) / 100}"/>`);
  return out.join("");
}
/** Short horizontal glints on still water. */
function shimmer(c: Ctx, count: number, top: number, bottom: number, color: string, x: [number, number] = [0, W]): string {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const y = between(c.rand, top, bottom), w = between(c.rand, 12, 70) * (0.5 + (y - top) / (bottom - top + 1));
    out.push(`<rect x="${r1(between(c.rand, ...x))}" y="${r1(y)}" width="${r1(w)}" height="${r1(between(c.rand, 1, 2.4))}" rx="1" fill="${color}" fill-opacity="${r1(between(c.rand, 0.12, 0.5) * 100) / 100}"/>`);
  }
  return out.join("");
}
/** A tower silhouette with a roof and a few lit windows. */
function tower(c: Ctx, x: number, base: number, w: number, h: number, roof: "cone" | "battlement" | "dome" | "spire" | "flat", fill: string, lit: string | null): string {
  const top = base - h, out = [`<rect x="${r1(x)}" y="${r1(top)}" width="${r1(w)}" height="${r1(h + 2)}" fill="${fill}"/>`];
  if (roof === "cone") out.push(`<path d="M${r1(x - w * 0.14)} ${r1(top)}L${r1(x + w / 2)} ${r1(top - w * 1.25)}L${r1(x + w * 1.14)} ${r1(top)}Z" fill="${fill}"/>`);
  else if (roof === "spire") out.push(`<path d="M${r1(x - w * 0.06)} ${r1(top)}L${r1(x + w / 2)} ${r1(top - w * 2.6)}L${r1(x + w * 1.06)} ${r1(top)}Z" fill="${fill}"/>`);
  else if (roof === "dome") out.push(`<path d="M${r1(x)} ${r1(top)}A${r1(w / 2)} ${r1(w * 0.55)} 0 0 1 ${r1(x + w)} ${r1(top)}Z" fill="${fill}"/>`, `<rect x="${r1(x + w / 2 - 1.5)}" y="${r1(top - w * 0.55 - 26)}" width="3" height="28" fill="${fill}"/>`);
  else if (roof === "battlement") for (let m = 0; m < w - 4; m += 12) out.push(`<rect x="${r1(x + m)}" y="${r1(top - 9)}" width="7" height="10" fill="${fill}"/>`);
  if (lit) for (let i = 0; i < Math.max(1, Math.floor(h / 70)); i++) if (c.rand() < 0.7) {
    const wy = top + 20 + c.rand() * (h - 40), wx = x + w / 2 - 3 + (c.rand() - 0.5) * (w - 14);
    out.push(`<rect x="${r1(wx)}" y="${r1(wy)}" width="6" height="10" rx="3" fill="${lit}" fill-opacity=".9"/>`, glow(c, wx + 3, wy + 5, 20, 20, lit, 0.35));
  }
  return out.join("");
}
/** A cog silhouette. */
function gear(cx: number, cy: number, r: number, teeth: number, fill: string, opacity: number, turn: number): string {
  let d = "";
  for (let i = 0; i < teeth * 2; i++) {
    const a0 = turn + (i * Math.PI) / teeth, a1 = turn + ((i + 1) * Math.PI) / teeth, rr = i % 2 ? r * 0.84 : r;
    d += `${d ? "L" : "M"}${r1(cx + rr * Math.cos(a0))} ${r1(cy + rr * Math.sin(a0))}L${r1(cx + rr * Math.cos(a1))} ${r1(cy + rr * Math.sin(a1))}`;
  }
  return `<path d="${d}Z M${r1(cx + r * 0.32)} ${cy}A${r1(r * 0.32)} ${r1(r * 0.32)} 0 1 0 ${r1(cx - r * 0.32)} ${cy}A${r1(r * 0.32)} ${r1(r * 0.32)} 0 1 0 ${r1(cx + r * 0.32)} ${cy}Z" fill="${fill}" fill-opacity="${opacity}" fill-rule="evenodd"/>`;
}
/** Hanging roots or vines: curved strands from the top edge, some ending in a glowing bulb. */
function roots(c: Ctx, count: number, color: string, bulb: string | null, x: [number, number] = [0, W]): string {
  const out: string[] = [], tips: string[] = [];
  for (let i = 0; i < count; i++) {
    const sx = between(c.rand, ...x), len = between(c.rand, 60, 230), sway = (c.rand() - 0.5) * 70, w = between(c.rand, 1.5, 5);
    const ex = sx + sway, ey = len;
    out.push(`<path d="M${r1(sx)} -5C${r1(sx - sway * 0.6)} ${r1(len * 0.35)} ${r1(ex + sway * 0.8)} ${r1(len * 0.65)} ${r1(ex)} ${r1(ey)}" fill="none" stroke="${color}" stroke-width="${r1(w)}" stroke-linecap="round"/>`);
    if (c.rand() < 0.45) out.push(`<path d="M${r1(sx + sway * 0.2)} ${r1(len * 0.4)}q${r1(14 * Math.sign(sway || 1))} 16 ${r1(8 * Math.sign(sway || 1))} 42" fill="none" stroke="${color}" stroke-width="${r1(w * 0.55)}" stroke-linecap="round"/>`);
    if (bulb && c.rand() < 0.5) tips.push(glow(c, ex, ey + 3, 16, 16, bulb, 0.55), `<circle cx="${r1(ex)}" cy="${r1(ey + 3)}" r="2.6" fill="${bulb}"/>`);
  }
  return out.join("") + tips.join("");
}
/** Thick bramble vines with thorns (Razorfen, forests). */
function brambles(c: Ctx, count: number, color: string, opacity: number): string {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const x = between(c.rand, -60, W + 60), up = c.rand() < 0.5, y0 = up ? H + 20 : -20, h = between(c.rand, 160, 380), bend = (c.rand() - 0.5) * 360, w = between(c.rand, 7, 18);
    const ey = up ? y0 - h : y0 + h;
    out.push(`<path d="M${r1(x)} ${y0}Q${r1(x + bend)} ${r1((y0 + ey) / 2)} ${r1(x + bend * 0.4)} ${r1(ey)}" fill="none" stroke="${color}" stroke-opacity="${opacity}" stroke-width="${r1(w)}" stroke-linecap="round"/>`);
    for (let t = 0.15; t < 0.95; t += 0.11) {
      const bx = (1 - t) ** 2 * x + 2 * (1 - t) * t * (x + bend) + t * t * (x + bend * 0.4), by = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * ((y0 + ey) / 2) + t * t * ey;
      const side = c.rand() < 0.5 ? -1 : 1, len = w * between(c.rand, 1.1, 2);
      out.push(`<path d="M${r1(bx - w * 0.3)} ${r1(by)}L${r1(bx + side * len)} ${r1(by - len * 0.6)}L${r1(bx + w * 0.3)} ${r1(by + 2)}Z" fill="${color}" fill-opacity="${opacity}"/>`);
    }
  }
  return out.join("");
}

// ---- scenes ------------------------------------------------------------------------------------------------------

type Painter = (c: Ctx) => string[];

/** A living cavern: hanging roots with glowing bulbs, stalactites, a still pool and drifting spores (Wailing Caverns, Maraudon). */
const cavern: Painter = (c) => {
  const { p } = c;
  return [
    glow(c, 470, 380, 620, 300, p.glow, 0.42),
    ridge(c, 330, 70, p.far, { opacity: 0.75, freq: 1.4 }),
    ridge(c, 120, 55, p.far, { top: true, opacity: 0.85, freq: 1.2 }),
    spikes(c, 18, 60, p.mid, { top: true, h: [40, 140], w: [26, 70], opacity: 0.9 }),
    mist(c, 330, 90, p.glow, 0.22),
    ridge(c, 470, 40, p.mid, { freq: 1.8 }),
    wall(c, 70, 55, p.near, false), wall(c, 1130, 55, p.near, true),
    roots(c, 22, p.near, p.spark),
    `<rect x="0" y="520" width="${W}" height="110" fill="${p.glow}" fill-opacity=".1"/>`,
    shimmer(c, 70, 528, 615, p.spark),
    ridge(c, 612, 22, p.near, { freq: 2.2 }),
    spikes(c, 9, H + 4, p.near, { h: [40, 120], w: [40, 90] }),
    mist(c, 515, 30, p.glow, 0.28, 8),
    motes(c, 70, [0, 40, W, 560], p.spark)
  ];
};
/** Magma: red rock spires over a glowing lava river, rising embers and smoke (Ragefire Chasm, Blackrock). */
const magma: Painter = (c) => {
  const { p } = c, river: string[] = [];
  for (let i = 0; i < 18; i++) {
    let d = `M${r1(c.rand() * W)} ${r1(between(c.rand, 545, 585))}`;
    for (let k = 0; k < 5; k++) d += `l${r1(between(c.rand, 12, 40))} ${r1((c.rand() - 0.5) * 18)}`;
    river.push(`<path d="${d}" fill="none" stroke="${p.spark}" stroke-width="${r1(between(c.rand, 1.2, 2.6))}" stroke-linecap="round" stroke-opacity=".85"/>`);
  }
  return [
    glow(c, 600, 640, 900, 360, p.glow, 0.85),
    mist(c, 70, 60, "#000000", 0.45, 8),
    ridge(c, 360, 90, p.far, { jag: 60, step: 34, opacity: 0.85 }),
    spikes(c, 12, 470, p.far, { h: [120, 300], w: [40, 90], opacity: 0.9 }),
    ridge(c, 465, 35, p.mid, { jag: 30, step: 26 }),
    `<path d="M-20 560Q300 520 600 552T1220 548L1220 600Q900 590 600 602T-20 596Z" fill="${p.glow}" fill-opacity=".85"/>`,
    glow(c, 600, 570, 700, 60, p.spark, 0.6),
    ...river,
    ridge(c, 612, 24, p.near, { jag: 18, step: 22 }),
    spikes(c, 7, H + 4, p.near, { h: [50, 130], w: [50, 110] }),
    motes(c, 90, [0, 120, W, 470], p.spark, [0.8, 2.4], [0.4, 1]),
    mist(c, 480, 50, p.glow, 0.18, 6)
  ];
};
/** A smugglers' cove: a wrecked ship in a timbered cave, lantern light on dark water (The Deadmines). */
const cove: Painter = (c) => {
  const { p } = c, sx = 120, sy = 500, ship: string[] = [];
  ship.push(`<path d="M${sx} ${sy - 46}L${sx + 50} ${sy - 62}L${sx + 330} ${sy - 56}L${sx + 410} ${sy - 96}L${sx + 398} ${sy - 50}Q${sx + 360} ${sy + 18} ${sx + 290} ${sy + 24}L${sx + 80} ${sy + 24}Q${sx + 20} ${sy + 8} ${sx} ${sy - 46}Z" fill="${p.near}"/>`,
    `<path d="M${sx + 398} ${sy - 82}L${sx + 500} ${sy - 128}" stroke="${p.near}" stroke-width="5"/>`);
  for (const [mx, mh] of [[sx + 100, 250], [sx + 205, 300], [sx + 310, 230]] as const) {
    ship.push(`<rect x="${mx - 3}" y="${sy - 56 - mh}" width="6" height="${mh}" fill="${p.near}"/>`);
    for (const yard of [0.22, 0.55]) {
      const yy = sy - 56 - mh * (1 - yard), span = 70 - yard * 30;
      ship.push(`<rect x="${mx - span}" y="${r1(yy)}" width="${span * 2}" height="4" fill="${p.near}"/>`);
      let rag = "";
      for (let k = 0; k <= 8; k++) rag += `L${r1(mx + span - 4 - (k * (span * 2 - 8)) / 8)} ${r1(yy + mh * 0.28 - c.rand() * 30)}`;
      ship.push(`<path d="M${mx - span + 4} ${r1(yy + 4)}L${mx + span - 4} ${r1(yy + 4)}${rag}Z" fill="${p.mid}" fill-opacity=".55"/>`);
    }
    ship.push(`<path d="M${mx} ${sy - 56 - mh}L${sx + 500} ${sy - 128}M${mx} ${sy - 56 - mh}L${sx + 10} ${sy - 50}" stroke="${p.near}" stroke-width="1.2" stroke-opacity=".8"/>`);
  }
  const beams: string[] = [];
  for (const x of [40, 560, 1150]) beams.push(`<rect x="${x}" y="0" width="22" height="${H}" fill="${p.near}" fill-opacity=".9"/>`, `<rect x="${x - 6}" y="${r1(between(c.rand, 40, 70))}" width="34" height="12" fill="${p.near}"/>`);
  beams.push(`<path d="M0 34L${W} 52L${W} 70L0 52Z" fill="${p.near}" fill-opacity=".9"/>`);
  return [
    glow(c, 640, 330, 520, 260, p.glow, 0.5),
    ridge(c, 150, 60, p.far, { top: true, jag: 30, step: 30 }),
    spikes(c, 14, 120, p.far, { top: true, h: [30, 110], w: [30, 70] }),
    ridge(c, 470, 40, p.far, { opacity: 0.9 }),
    `<rect x="0" y="500" width="${W}" height="130" fill="${p.mid}" fill-opacity=".45"/>`,
    shimmer(c, 80, 505, 625, p.spark),
    ...ship,
    glow(c, sx + 40, sy - 70, 60, 60, p.spark, 0.8), glow(c, sx + 400, sy - 100, 50, 50, p.spark, 0.7),
    `<circle cx="${sx + 40}" cy="${sy - 70}" r="4" fill="${p.spark}"/><circle cx="${sx + 400}" cy="${sy - 100}" r="3.5" fill="${p.spark}"/>`,
    ...beams,
    ridge(c, 618, 16, p.near, { jag: 10 }),
    motes(c, 30, [0, 80, W, 450], p.spark, [0.6, 1.6], [0.2, 0.6])
  ];
};
/** A keep on a crag under the moon: towers with lit windows, bats, fog (Shadowfang Keep, Scarlet, Stratholme, Scholomance). */
const keep = (opts: { fire?: boolean; spire?: boolean; moon?: boolean }): Painter => (c) => {
  const { p } = c, out: string[] = [stars(c, 120, 330)];
  const moon = opts.moon ?? true;
  if (moon) out.push(glow(c, 455, 250, 210, 210, p.glow, 0.55), `<circle cx="455" cy="250" r="50" fill="${p.spark}" fill-opacity=".92"/>`,
    `<circle cx="440" cy="238" r="9" fill="${p.glow}" fill-opacity=".25"/><circle cx="472" cy="266" r="12" fill="${p.glow}" fill-opacity=".2"/>`);
  if (opts.fire) out.push(glow(c, 600, 600, 900, 380, p.glow, 0.75));
  out.push(mist(c, 140, 60, p.mid, 0.45, 6), ridge(c, 430, 60, p.far, { opacity: 0.9 }));
  // The castle sits on a crag in the middle gutter and fills the skyline behind the panel.
  const crag = `<path d="M180 640L260 470Q330 430 400 452L560 440Q640 430 700 470L860 640Z" fill="${p.mid}"/>`;
  out.push(crag);
  const plan: [number, number, number, "cone" | "battlement" | "dome" | "spire" | "flat"][] = [[262, 60, 150, "battlement"], [318, 44, 230, opts.spire ? "spire" : "cone"], [362, 120, 120, "battlement"],
    [482, 40, 270, opts.spire ? "spire" : "cone"], [522, 110, 140, "battlement"], [630, 50, 200, "cone"], [680, 80, 110, "battlement"]];
  for (const [x, w, h, roof] of plan) out.push(tower(c, x, 462, w, h, roof, p.mid, "#ffcf6e"));
  if (opts.fire) out.push(motes(c, 80, [100, 160, 1000, 420], "#ffb347", [0.8, 2.4], [0.4, 1]));
  for (let i = 0; i < 9; i++) {
    const bx = between(c.rand, 380, 900), by = between(c.rand, 60, 240), s = between(c.rand, 5, 11);
    out.push(`<path d="M${r1(bx - s)} ${r1(by)}q${r1(s * 0.5)} ${r1(-s * 0.5)} ${r1(s)} 0q${r1(s * 0.5)} ${r1(-s * 0.5)} ${r1(s)} 0q${r1(-s * 0.5)} ${r1(s * 0.2)} ${r1(-s)} ${r1(s * 0.4)}q${r1(-s * 0.5)} ${r1(-s * 0.2)} ${r1(-s)} ${r1(-s * 0.4)}Z" fill="${p.near}"/>`);
  }
  out.push(mist(c, 470, 50, p.glow, 0.3, 8), ridge(c, 560, 50, p.near, { freq: 1.6 }));
  for (let i = 0; i < 7; i++) {
    const tx = between(c.rand, 0, W), ty = 560 + (c.rand() - 0.5) * 30, th = between(c.rand, 60, 150);
    out.push(`<path d="M${r1(tx)} ${r1(ty)}L${r1(tx + 3)} ${r1(ty - th)}M${r1(tx + 2)} ${r1(ty - th * 0.6)}l${r1(between(c.rand, 18, 36))} ${r1(-between(c.rand, 14, 30))}M${r1(tx + 2)} ${r1(ty - th * 0.4)}l${r1(-between(c.rand, 16, 30))} ${r1(-between(c.rand, 10, 24))}" stroke="${p.near}" stroke-width="4" stroke-linecap="round"/>`);
  }
  out.push(mist(c, 600, 30, p.glow, 0.25, 8));
  return out;
};
/** A stone gaol: brick walls, a barred window spilling cold light, chains and torches (The Stockade, Alcaz). */
const prison: Painter = (c) => {
  const { p } = c, bricks: string[] = [];
  for (let row = 0; row < 22; row++) for (let col = -1; col < 17; col++) {
    const x = col * 76 + (row % 2) * 38, y = row * 30, shade = between(c.rand, 0, 0.22);
    bricks.push(`<rect x="${x + 2}" y="${y + 2}" width="72" height="26" rx="3" fill="${p.mid}" fill-opacity="${r1((0.55 + shade) * 100) / 100}"/>`);
  }
  const bars: string[] = [`<rect x="380" y="70" width="170" height="120" rx="6" fill="${p.glow}" fill-opacity=".35"/>`];
  for (let i = 0; i < 6; i++) bars.push(`<rect x="${388 + i * 30}" y="66" width="7" height="128" rx="3" fill="${p.near}"/>`);
  bars.push(`<rect x="380" y="120" width="170" height="7" fill="${p.near}"/>`);
  const chains: string[] = [];
  for (const cx of [140, 760, 980]) { const len = between(c.rand, 120, 260); for (let y = 0; y < len; y += 13) chains.push(`<ellipse cx="${cx}" cy="${y}" rx="${y % 26 ? 2.4 : 5}" ry="7" fill="none" stroke="${p.near}" stroke-width="3"/>`); }
  const torch = (x: number, y: number) => [glow(c, x, y, 230, 230, p.spark, 0.5), `<rect x="${x - 5}" y="${y + 8}" width="10" height="34" rx="3" fill="${p.near}"/>`,
    `<path d="M${x} ${y - 22}Q${x + 12} ${y - 4} ${x + 7} ${y + 8}L${x - 7} ${y + 8}Q${x - 12} ${y - 4} ${x} ${y - 22}Z" fill="${p.spark}"/>`, `<path d="M${x} ${y - 10}Q${x + 5} ${y} ${x + 3} ${y + 8}L${x - 3} ${y + 8}Q${x - 5} ${y} ${x} ${y - 10}Z" fill="#fff6d0"/>`];
  return [...bricks, `<rect width="${W}" height="${H}" fill="${p.far}" fill-opacity=".45"/>`, rays(c, 4, p.glow, 0.35, [380, 520], 0.55), ...bars, ...chains,
    ...torch(300, 300), ...torch(1170, 260), `<rect x="0" y="560" width="${W}" height="70" fill="${p.near}" fill-opacity=".85"/>`, shimmer(c, 40, 566, 625, p.spark),
    motes(c, 30, [200, 100, 600, 480], p.glow, [0.5, 1.4], [0.2, 0.6])];
};
/** Under the water: light shafts from the surface, broken columns, kelp and bubbles (Blackfathom Deeps, the Drowned City, Sunken Temple). */
const sunken: Painter = (c) => {
  const { p } = c, ruins: string[] = [], kelp: string[] = [], bubbles: string[] = [];
  for (const [x, w, h, broken] of [[60, 46, 330, true], [190, 40, 240, false], [470, 52, 380, true], [560, 40, 190, true], [1080, 50, 300, false]] as const) {
    const top = 600 - h;
    ruins.push(`<rect x="${x}" y="${top}" width="${w}" height="${h}" fill="${p.mid}"/>`, `<rect x="${x - 8}" y="${top - 4}" width="${w + 16}" height="14" fill="${p.mid}"/>`);
    if (broken) ruins.push(`<path d="M${x - 8} ${top - 4}L${x + w * 0.4} ${top - 26}L${x + w * 0.7} ${top - 8}L${x + w + 8} ${top - 18}L${x + w + 8} ${top - 4}Z" fill="${p.mid}"/>`);
    for (let k = 1; k < 5; k++) ruins.push(`<rect x="${x + (w * k) / 5 - 1}" y="${top + 12}" width="2" height="${h - 12}" fill="${p.far}" fill-opacity=".5"/>`);
  }
  ruins.push(`<path d="M230 600L230 440A120 120 0 0 1 470 440L470 600L440 600L440 445A90 90 0 0 0 260 445L260 600Z" fill="${p.mid}" fill-opacity=".85"/>`);
  for (let i = 0; i < 26; i++) {
    const x = between(c.rand, -10, W + 10), h = between(c.rand, 90, 260), sway = between(c.rand, 10, 40);
    let d = `M${r1(x)} ${H + 5}`;
    for (let k = 1; k <= 4; k++) d += `Q${r1(x + (k % 2 ? sway : -sway))} ${r1(H - (h * (k - 0.5)) / 4)} ${r1(x)} ${r1(H - (h * k) / 4)}`;
    kelp.push(`<path d="${d}" fill="none" stroke="${p.near}" stroke-width="${r1(between(c.rand, 3, 7))}" stroke-linecap="round" stroke-opacity=".95"/>`);
  }
  for (let i = 0; i < 45; i++) bubbles.push(`<circle cx="${r1(c.rand() * W)}" cy="${r1(c.rand() * 600)}" r="${r1(between(c.rand, 1.5, 7))}" fill="${p.spark}" fill-opacity=".06" stroke="${p.spark}" stroke-opacity=".45" stroke-width="1"/>`);
  const caustics: string[] = [];
  for (let i = 0; i < 30; i++) { const x = c.rand() * W, y = between(c.rand, 0, 50); caustics.push(`<path d="M${r1(x)} ${r1(y)}q${r1(between(c.rand, 10, 30))} ${r1(between(c.rand, -8, 8))} ${r1(between(c.rand, 30, 60))} 0" fill="none" stroke="${p.spark}" stroke-opacity=".35" stroke-width="1.5"/>`); }
  return [glow(c, 600, 0, 800, 260, p.glow, 0.55), ...caustics, rays(c, 9, p.spark, 0.28, [0, 1100], 0.3), ridge(c, 420, 50, p.far, { opacity: 0.8 }), mist(c, 380, 80, p.glow, 0.2),
    ...ruins, ridge(c, 600, 18, p.near, { freq: 2 }), ...kelp, ...bubbles, motes(c, 50, [0, 0, W, 630], p.spark, [0.5, 1.5], [0.2, 0.6])];
};
/** Gnomish machinery: interlocking gears, pipes, rivets and a toxic glow (Gnomeregan). */
const machine: Painter = (c) => {
  const { p } = c, out: string[] = [glow(c, 420, 520, 600, 220, p.glow, 0.55)];
  for (const [cx, cy, r, t, o] of [[110, 120, 120, 14, 0.85], [300, 30, 70, 10, 0.75], [560, 560, 150, 18, 0.9], [980, 590, 110, 14, 0.85], [1150, 80, 140, 16, 0.85], [760, 20, 60, 10, 0.7]] as const)
    out.push(gear(cx, cy, r, t, p.mid, o, c.rand()));
  for (const y of [210, 470]) out.push(`<rect x="0" y="${y}" width="${W}" height="18" fill="${p.far}"/>`, `<rect x="0" y="${y + 3}" width="${W}" height="3" fill="${p.spark}" fill-opacity=".18"/>`);
  for (const x of [250, 580, 870]) { out.push(`<rect x="${x}" y="0" width="16" height="${H}" fill="${p.far}"/>`); for (const y of [210, 470]) out.push(`<rect x="${x - 6}" y="${y - 6}" width="28" height="30" rx="4" fill="${p.mid}"/>`); }
  for (let i = 0; i < 40; i++) out.push(`<circle cx="${r1(c.rand() * W)}" cy="${[219, 479][i % 2]}" r="2" fill="${p.spark}" fill-opacity=".35"/>`);
  out.push(ridge(c, 600, 16, p.near, { jag: 8 }), `<path d="M180 600Q420 560 660 600Z" fill="${p.glow}" fill-opacity=".7"/>`, glow(c, 420, 590, 300, 50, p.spark, 0.6),
    motes(c, 45, [0, 200, W, 400], p.spark, [0.6, 1.8], [0.4, 1]), mist(c, 560, 40, p.glow, 0.25));
  return out;
};
/** Giant brambles and tusks under a dusty sky (Razorfen Kraul, Razorfen Downs, Blackmaw Hold). */
const thorns: Painter = (c) => {
  const { p } = c, tusks: string[] = [];
  for (let i = 0; i < 6; i++) {
    const x = between(c.rand, 0, W), base = between(c.rand, 560, 620), h = between(c.rand, 120, 230), dir = c.rand() < 0.5 ? -1 : 1;
    tusks.push(`<path d="M${r1(x)} ${r1(base)}Q${r1(x + dir * 10)} ${r1(base - h * 0.6)} ${r1(x + dir * h * 0.45)} ${r1(base - h)}Q${r1(x + dir * 40)} ${r1(base - h * 0.5)} ${r1(x + 34)} ${r1(base)}Z" fill="${p.spark}" fill-opacity=".55"/>`);
  }
  return [glow(c, 520, 160, 640, 260, p.glow, 0.55), ridge(c, 380, 60, p.far, { opacity: 0.85 }), brambles(c, 9, p.far, 0.9), mist(c, 420, 60, p.glow, 0.22),
    ridge(c, 520, 40, p.mid), brambles(c, 12, p.near, 1), ...tusks, ridge(c, 612, 18, p.near), motes(c, 50, [0, 60, W, 520], p.spark, [0.5, 1.6], [0.25, 0.7])];
};
/** A carved titan or dwarven hall: a colonnade in perspective, a glowing rune disc and braziers (Uldaman, Hall of Thanes, Shaper's Terrace). */
const vault: Painter = (c) => {
  const { p } = c, out: string[] = [glow(c, 600, 260, 520, 300, p.glow, 0.55)];
  for (let i = 0; i < 11; i++) out.push(`<line x1="${600 + (i - 5) * 26}" y1="300" x2="${600 + (i - 5) * 260}" y2="${H}" stroke="${p.spark}" stroke-opacity=".12" stroke-width="1.5"/>`);
  for (let k = 0; k < 6; k++) { const y = 300 + (330 * (k / 6) ** 1.7); out.push(`<line x1="0" y1="${r1(y)}" x2="${W}" y2="${r1(y)}" stroke="${p.spark}" stroke-opacity=".08"/>`); }
  out.push(`<circle cx="600" cy="230" r="120" fill="none" stroke="${p.spark}" stroke-opacity=".45" stroke-width="3"/><circle cx="600" cy="230" r="94" fill="none" stroke="${p.spark}" stroke-opacity=".3" stroke-width="2" stroke-dasharray="14 9"/>`);
  for (let i = 0; i < 12; i++) { const a = (i * Math.PI) / 6; out.push(`<rect x="${r1(600 + 107 * Math.cos(a) - 4)}" y="${r1(230 + 107 * Math.sin(a) - 7)}" width="8" height="14" rx="2" fill="${p.spark}" fill-opacity=".55" transform="rotate(${r1((a * 180) / Math.PI + 90)} ${r1(600 + 107 * Math.cos(a))} ${r1(230 + 107 * Math.sin(a))})"/>`); }
  // Pillars on both sides, nearer ones larger and darker.
  for (let k = 0; k < 5; k++) {
    const s = 1 - k * 0.17, w = 70 * s, top = 40 + k * 34, h = H - top - (5 - k) * 6;
    for (const side of [-1, 1]) {
      const x = side < 0 ? 40 + k * 95 : W - 40 - k * 95 - w, fill = k < 2 ? p.near : p.mid;
      out.push(`<rect x="${r1(x)}" y="${r1(top)}" width="${r1(w)}" height="${r1(h)}" fill="${fill}"/>`, `<rect x="${r1(x - 8 * s)}" y="${r1(top)}" width="${r1(w + 16 * s)}" height="${r1(16 * s)}" fill="${fill}"/>`,
        `<rect x="${r1(x - 8 * s)}" y="${r1(top + h - 16 * s)}" width="${r1(w + 16 * s)}" height="${r1(16 * s)}" fill="${fill}"/>`);
    }
  }
  out.push(`<rect x="0" y="0" width="${W}" height="44" fill="${p.near}"/>`);
  for (const x of [230, 970]) out.push(glow(c, x, 520, 120, 140, p.spark, 0.65), `<path d="M${x - 26} 560L${x + 26} 560L${x + 14} 600L${x - 14} 600Z" fill="${p.near}"/>`,
    `<path d="M${x} 505Q${x + 18} 530 ${x + 14} 558L${x - 14} 558Q${x - 18} 530 ${x} 505Z" fill="${p.spark}" fill-opacity=".9"/>`);
  out.push(motes(c, 40, [100, 60, 1000, 480], p.spark, [0.5, 1.5], [0.3, 0.8]), mist(c, 560, 40, p.glow, 0.18));
  return out;
};
/** A fallen city at dusk: broken walls, a toppled spire, crows and plague mist (Ruins of Lordaeron, Dire Maul). */
const ruins: Painter = (c) => {
  const { p } = c, out: string[] = [glow(c, 600, 380, 700, 240, p.glow, 0.5), ridge(c, 400, 40, p.far, { opacity: 0.8 })];
  let x = -20;
  while (x < W) {
    const w = between(c.rand, 60, 150), h = between(c.rand, 60, 220);
    let d = `M${r1(x)} 520L${r1(x)} ${r1(520 - h)}`;
    for (let k = 1; k <= 5; k++) d += `L${r1(x + (w * k) / 5)} ${r1(520 - h + (c.rand() * 0.6 + (k === 5 ? 0.3 : 0)) * h * 0.5)}`;
    out.push(`<path d="${d}L${r1(x + w)} 520Z" fill="${p.mid}"/>`);
    if (c.rand() < 0.4) out.push(`<path d="M${r1(x + w * 0.3)} ${r1(520 - h * 0.6)}a${r1(w * 0.2)} ${r1(w * 0.25)} 0 0 1 ${r1(w * 0.4)} 0v${r1(h * 0.3)}h${r1(-w * 0.4)}Z" fill="${p.glow}" fill-opacity=".35"/>`);
    x += w + between(c.rand, 4, 30);
  }
  out.push(`<path d="M430 520L470 230L486 210L500 232L520 520Z" fill="${p.mid}"/>`, `<path d="M640 520L700 420L1000 300L1012 316L730 440L700 520Z" fill="${p.mid}" fill-opacity=".95"/>`);
  for (let i = 0; i < 8; i++) { const bx = between(c.rand, 300, 1000), by = between(c.rand, 60, 220), s = between(c.rand, 4, 9); out.push(`<path d="M${r1(bx - s)} ${r1(by - s * 0.3)}Q${r1(bx - s * 0.4)} ${r1(by - s * 0.5)} ${r1(bx)} ${r1(by)}Q${r1(bx + s * 0.4)} ${r1(by - s * 0.5)} ${r1(bx + s)} ${r1(by - s * 0.3)}" fill="none" stroke="${p.near}" stroke-width="2"/>`); }
  out.push(mist(c, 500, 50, p.glow, 0.4, 9), ridge(c, 580, 30, p.near, { jag: 14 }), spikes(c, 10, H + 4, p.near, { h: [20, 70], w: [30, 80] }), mist(c, 610, 20, p.glow, 0.3, 8),
    motes(c, 40, [0, 300, W, 300], p.spark, [0.5, 1.4], [0.2, 0.6]));
  return out;
};
/** A mage city at night: slender spires with domes and lit windows under a violet ward and arcane sparks (City of Dalaran). */
const city: Painter = (c) => {
  const { p } = c, out: string[] = [stars(c, 160, 360), glow(c, 600, 520, 760, 300, p.glow, 0.55)];
  out.push(`<path d="M80 560A520 520 0 0 1 1120 560" fill="${p.glow}" fill-opacity=".08" stroke="${p.spark}" stroke-opacity=".45" stroke-width="2.5"/>`,
    `<path d="M130 560A470 470 0 0 1 1070 560" fill="none" stroke="${p.spark}" stroke-opacity=".18" stroke-width="1.5" stroke-dasharray="3 9"/>`);
  for (let i = 0; i < 3; i++) out.push(`<path d="M${r1(between(c.rand, -100, 200))} ${r1(between(c.rand, 120, 260))}C${r1(between(c.rand, 300, 500))} ${r1(between(c.rand, 20, 120))} ${r1(between(c.rand, 700, 900))} ${r1(between(c.rand, 250, 330))} ${r1(between(c.rand, 1100, 1300))} ${r1(between(c.rand, 100, 200))}" fill="none" stroke="${p.spark}" stroke-opacity=".22" stroke-width="${r1(between(c.rand, 10, 26))}" filter="url(#da-b8)"/>`);
  const roofs = ["spire", "dome", "cone", "spire", "dome", "flat", "spire"] as const;
  let x = 60;
  while (x < 1140) {
    const w = between(c.rand, 24, 54), h = between(c.rand, 110, 300) * (1 - Math.abs(x - 600) / 1400);
    out.push(tower(c, x, 566, w, h, roofs[Math.floor(c.rand() * roofs.length)]!, p.mid, p.spark));
    x += w + between(c.rand, 2, 18);
  }
  out.push(`<path d="M40 560L1160 560L1100 590Q600 660 100 590Z" fill="${p.near}"/>`, motes(c, 80, [0, 40, W, 520], p.spark, [0.6, 2], [0.35, 1]), mist(c, 590, 30, p.glow, 0.3));
  return out;
};
/** A dig in the marsh: rain, reeds, scaffolding, a crane and lanterns over layered earth (Excavation Site: Wetlands). */
const dig: Painter = (c) => {
  const { p } = c, out: string[] = [mist(c, 80, 60, p.far, 0.5, 8), ridge(c, 330, 45, p.far, { opacity: 0.85 })];
  for (let k = 0; k < 5; k++) out.push(ridge(c, 430 + k * 34, 14, k % 2 ? p.mid : p.far, { opacity: 0.85, freq: 1.5 }));
  for (const [x, top] of [[320, 300], [420, 280], [520, 300]] as const) out.push(`<rect x="${x}" y="${top}" width="7" height="${600 - top}" fill="${p.near}"/>`);
  out.push(`<rect x="300" y="300" width="250" height="7" fill="${p.near}"/><rect x="300" y="400" width="250" height="7" fill="${p.near}"/>`,
    `<path d="M327 300L427 400M427 300L527 400M327 400L427 500M427 400L527 500" stroke="${p.near}" stroke-width="4"/>`,
    `<path d="M700 600L700 170L960 210L955 222L712 190L712 600Z" fill="${p.near}"/><line x1="930" y1="208" x2="930" y2="420" stroke="${p.near}" stroke-width="2"/>`,
    `<rect x="918" y="420" width="24" height="18" fill="${p.near}"/>`);
  for (const [x, y] of [[330, 292], [530, 292], [706, 200]] as const) out.push(glow(c, x, y, 70, 70, p.spark, 0.7), `<circle cx="${x}" cy="${y}" r="4" fill="${p.spark}"/>`);
  out.push(`<rect x="0" y="560" width="${W}" height="70" fill="${p.mid}" fill-opacity=".6"/>`, shimmer(c, 60, 566, 625, p.glow));
  for (let i = 0; i < 60; i++) { const x = between(c.rand, 0, W), h = between(c.rand, 30, 90); out.push(`<path d="M${r1(x)} 630Q${r1(x + between(c.rand, -8, 8))} ${r1(630 - h / 2)} ${r1(x + between(c.rand, -14, 14))} ${r1(630 - h)}" fill="none" stroke="${p.near}" stroke-width="2"/>`); }
  const rain: string[] = [];
  for (let i = 0; i < 160; i++) { const x = c.rand() * (W + 200), y = c.rand() * H; rain.push(`<line x1="${r1(x)}" y1="${r1(y)}" x2="${r1(x - 8)}" y2="${r1(y + 26)}"/>`); }
  out.push(`<g stroke="${p.glow}" stroke-opacity=".22" stroke-width="1">${rain.join("")}</g>`, mist(c, 540, 40, p.glow, 0.2));
  return out;
};
/** Desert heat: a pale sun, dunes and a stepped temple (Zul'Farrak). */
const desert: Painter = (c) => {
  const { p } = c, steps: string[] = [];
  for (let k = 0; k < 6; k++) steps.push(`<rect x="${380 + k * 26}" y="${470 - (k + 1) * 34}" width="${300 - k * 52}" height="36" fill="${p.mid}"/>`);
  return [glow(c, 520, 140, 360, 260, p.glow, 0.75), `<circle cx="520" cy="140" r="58" fill="${p.spark}" fill-opacity=".85"/>`, ridge(c, 400, 50, p.far, { opacity: 0.8, freq: 0.7 }), ...steps,
    `<rect x="514" y="230" width="32" height="40" fill="${p.mid}"/>`, mist(c, 450, 30, p.glow, 0.3), ridge(c, 500, 50, p.mid, { freq: 0.6 }), ridge(c, 580, 40, p.near, { freq: 0.8 }),
    motes(c, 50, [0, 300, W, 330], p.spark, [0.5, 1.3], [0.2, 0.5])];
};
/** An old forest: dark trunks, canopy and fireflies (Blackmaw Hold and other woodland dungeons). */
const forest: Painter = (c) => {
  const { p } = c, trunks: string[] = [];
  for (let layer = 0; layer < 3; layer++) for (let i = 0; i < 7; i++) {
    const x = between(c.rand, -40, W), w = (14 + layer * 16) * between(c.rand, 0.7, 1.3), fill = [p.far, p.mid, p.near][layer]!;
    trunks.push(`<path d="M${r1(x)} ${H}L${r1(x + w * 0.2)} -10L${r1(x + w * 0.8)} -10L${r1(x + w)} ${H}Z" fill="${fill}"/>`);
  }
  return [glow(c, 600, 300, 600, 300, p.glow, 0.5), rays(c, 6, p.spark, 0.18, [100, 1000], 0.2), ...trunks.slice(0, 7), mist(c, 380, 80, p.glow, 0.25), ...trunks.slice(7, 14),
    ridge(c, 80, 40, p.mid, { top: true }), ...trunks.slice(14), ridge(c, 600, 22, p.near), motes(c, 60, [0, 80, W, 480], p.spark, [0.6, 1.8], [0.4, 1])];
};
/** The generic fallback: layered peaks, a gate arch and stars in a colour taken from the dungeon's name. */
const fortress: Painter = (c) => {
  const { p } = c;
  return [stars(c, 90, 300), glow(c, 520, 300, 600, 280, p.glow, 0.5), ridge(c, 300, 80, p.far, { jag: 30, step: 40, opacity: 0.75 }), mist(c, 360, 60, p.glow, 0.25),
    ridge(c, 420, 60, p.mid, { jag: 20, step: 30 }),
    `<path d="M380 600L380 380L420 380L420 360L440 360L440 380L480 380L480 360L500 360L500 380L540 380L540 600L500 600L500 470A40 46 0 0 0 420 470L420 600Z" fill="${p.near}"/>`,
    glow(c, 460, 520, 40, 70, p.spark, 0.6), mist(c, 540, 40, p.glow, 0.3), ridge(c, 600, 24, p.near, { jag: 10 }), motes(c, 40, [0, 80, W, 480], p.spark, [0.5, 1.5], [0.25, 0.7])];
};

interface SceneDef { paint: Painter; palette: Palette }
const pal = (sky: [string, string, string], far: string, mid: string, near: string, glowColor: string, spark: string): Palette => ({ sky, far, mid, near, glow: glowColor, spark });
const SCENES: Record<DungeonScene, SceneDef> = {
  wailing: { paint: cavern, palette: pal(["#04140f", "#0c3324", "#103a28"], "#0a2a1d", "#071d14", "#030c08", "#3fae6a", "#c9f27a") },
  maraudon: { paint: cavern, palette: pal(["#120a1e", "#2a1640", "#1c2a1a"], "#22143a", "#140c24", "#08050e", "#9a5ad8", "#b8f28a") },
  ragefire: { paint: magma, palette: pal(["#0c0302", "#3a0d05", "#6e1a08"], "#2a0a05", "#1a0603", "#0a0201", "#ff5a1a", "#ffc24a") },
  blackrock: { paint: magma, palette: pal(["#08070a", "#24100c", "#5a1c0c"], "#1c1210", "#120c0a", "#060404", "#e8501c", "#ffb040") },
  deadmines: { paint: cove, palette: pal(["#0a0806", "#2a1d10", "#3a2814"], "#1e150c", "#2c3640", "#0b0805", "#d08a3a", "#ffc66a") },
  shadowfang: { paint: keep({}), palette: pal(["#07071a", "#1c1640", "#3a2f5e"], "#1a1530", "#100c20", "#06040c", "#8a86d8", "#e9ecff") },
  scarlet: { paint: keep({ spire: true }), palette: pal(["#12040a", "#45101e", "#8a2a2a"], "#2a0a12", "#1a060c", "#0a0205", "#e0503a", "#ffe2c8") },
  stratholme: { paint: keep({ fire: true, moon: false }), palette: pal(["#0a0606", "#2a1210", "#6a2a14"], "#24120e", "#140a08", "#070303", "#ff7a2a", "#ffd8a0") },
  scholomance: { paint: keep({ spire: true }), palette: pal(["#050a0c", "#132a2a", "#2a3a32"], "#10201e", "#0a1412", "#030807", "#5adaa0", "#e0fff0") },
  stockade: { paint: prison, palette: pal(["#0c0e12", "#1a1f28", "#202630"], "#0c0f14", "#3a4250", "#07090c", "#8fb4d8", "#ffb24a") },
  blackfathom: { paint: sunken, palette: pal(["#0a3a48", "#062634", "#020c14"], "#06303e", "#04202c", "#021018", "#2ab8c8", "#bff6ff") },
  sunken: { paint: sunken, palette: pal(["#14361e", "#0a2418", "#030c08"], "#0c2a18", "#081c10", "#030a06", "#4ac07a", "#d8ffcc") },
  gnomeregan: { paint: machine, palette: pal(["#081214", "#12262a", "#18302c"], "#0c1a1c", "#1e3236", "#060c0c", "#7aef4a", "#c8ff8a") },
  razorfen: { paint: thorns, palette: pal(["#1a0f06", "#4a2a10", "#6e4a1c"], "#2e1a0a", "#1e1006", "#0c0603", "#e09a3a", "#f6e2b8") },
  forest: { paint: forest, palette: pal(["#060c06", "#122414", "#1a2a14"], "#14241a", "#0c160e", "#040804", "#7ab84a", "#e8ff8a") },
  uldaman: { paint: vault, palette: pal(["#0e0c0a", "#2a2418", "#3a2e1c"], "#2a2216", "#1c160e", "#0a0805", "#d8a84a", "#ffe6a0") },
  thanes: { paint: vault, palette: pal(["#0a0a0e", "#1e1a1a", "#3a2414"], "#24201c", "#18140f", "#080605", "#ff9a3a", "#ffd890") },
  zulfarrak: { paint: desert, palette: pal(["#3a1e0a", "#9a5a20", "#d8a050"], "#8a5a2a", "#5a3416", "#2a1608", "#ffd890", "#fff4d0") },
  lordaeron: { paint: ruins, palette: pal(["#0c100c", "#2a3226", "#5a5a3a"], "#262c22", "#161a14", "#070806", "#a0c870", "#e0f0b0") },
  diremaul: { paint: ruins, palette: pal(["#061210", "#123230", "#2a4a3a"], "#10282a", "#0a1a1a", "#040a0a", "#5adab0", "#d8fff0") },
  excavation: { paint: dig, palette: pal(["#141812", "#2a3024", "#3a3a2a"], "#262c20", "#2c2618", "#0a0c08", "#a8b8a0", "#ffc860") },
  dalaran: { paint: city, palette: pal(["#0a0618", "#2a1450", "#4a2a6a"], "#1e1238", "#140a28", "#06030e", "#b070ff", "#f0d8ff") },
  fortress: { paint: fortress, palette: pal(["#0c0c10", "#1e1e28", "#2a2a34"], "#1a1a22", "#121218", "#060608", "#8a8ab0", "#e0e0ff") }
};
/** Older queued cards carry only a motif: map it to the closest scene. */
const MOTIF_SCENE: Record<DungeonMotif, DungeonScene> = { cave: "wailing", fire: "ragefire", sea: "blackfathom", keep: "shadowfang", mine: "deadmines", thorn: "razorfen" };

/** Hex colour for a hue/saturation/lightness triple (the fallback palette is derived from the dungeon name). */
function hsl(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l), f = (n: number) => { const k = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, "0"); };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** The scene and palette a theme paints: its own scene, the scene for its motif, or the name-coloured fallback. */
function sceneFor(theme: DungeonArtTheme): SceneDef {
  if (theme.scene && theme.scene !== "fortress" && SCENES[theme.scene]) return SCENES[theme.scene];
  if (!theme.scene && /^#/.test(theme.a) && MOTIF_SCENE[theme.motif]) return SCENES[MOTIF_SCENE[theme.motif]];
  const hue = theme.seed % 360;
  return { paint: fortress, palette: pal([hsl(hue, 0.4, 0.04), hsl(hue, 0.35, 0.12), hsl((hue + 20) % 360, 0.35, 0.2)], hsl(hue, 0.3, 0.1), hsl(hue, 0.3, 0.07), hsl(hue, 0.3, 0.03), hsl((hue + 20) % 360, 0.55, 0.5), hsl((hue + 40) % 360, 0.7, 0.85)) };
}

/** The full painted backdrop for a theme, as SVG markup (1200x630, ids prefixed `da-`). */
export function dungeonArt(theme: DungeonArtTheme): string {
  const { paint, palette } = sceneFor(theme);
  let next = 0;
  const c: Ctx = { rand: seededRandom(theme.seed), p: palette, defs: [], id: (prefix) => `da-${prefix}${next++}` };
  const body = paint(c).join("");
  const blur = (id: string, sd: number) => `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${sd}"/></filter>`;
  return `<defs><linearGradient id="da-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${palette.sky[0]}"/><stop offset=".55" stop-color="${palette.sky[1]}"/><stop offset="1" stop-color="${palette.sky[2]}"/></linearGradient>`
    + `<radialGradient id="da-vignette" cx="50%" cy="50%" r="75%"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".65"/></radialGradient>`
    + `${blur("da-b8", 8)}${c.defs.join("")}</defs>`
    + `<rect width="${W}" height="${H}" fill="url(#da-sky)"/>${body}<rect width="${W}" height="${H}" fill="url(#da-vignette)"/>`;
}
