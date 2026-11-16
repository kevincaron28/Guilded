import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { drawable, type ScoreCard } from "./score-card.js";

// The officer member-trend card (member-trend.ts): up to three lines over 30 or 90 days on the left, one tile per series on
// the right with the current value and the change over 7, 30 and 90 days. Same WoW tooltip palette and font as score-card.ts.
// Kept in its own file, like record-card.ts, so the shared renderer stays untouched apart from one dispatch line.

const fontfile = fileURLToPath(new URL("../../site/fonts/source-serif-latin.ttf", import.meta.url));
const C = { bg: "#120d08", bar: "#ffd100", panel: "#21180f", ink: "#f5e6c0", muted: "#b9a77f", gold: "#ffd100", edge: "#6b5322", frame: "#8a6a2b", green: "#6fdc4f", red: "#ff6a52" };
const esc = (value: string) => drawable(value).replace(/\p{Cc}/gu, " ").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
const clip = (value: string, max: number) => { const chars = [...drawable(value)]; return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : chars.join(""); };
const span = (color: string, body: string, extra = "") => `<span foreground="${color}"${extra}>${esc(body || " ")}</span>`;
async function text(markup: string, size: number, maxWidth: number) {
  if (!markup.replace(/<[^>]*>/g, "").trim()) {
    const blank = await sharp({ create: { width: 1, height: Math.round(size * 1.3), channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    return { input: blank, width: 1, height: Math.round(size * 1.3) };
  }
  const { data, info } = await sharp({ text: { text: markup, font: `Source Serif 4 ${size}`, fontfile, width: maxWidth, rgba: true, wrap: "none" } }).png().toBuffer({ resolveWithObject: true });
  return { input: data, width: info.width, height: info.height };
}

/** Pure: the polyline segments of one series; a missing day breaks the line instead of being drawn as zero. */
export function segments(values: readonly (number | null)[]): number[][] {
  const out: number[][] = [];
  let run: number[] = [];
  values.forEach((v, i) => { if (v === null) { if (run.length) out.push(run); run = []; } else run.push(i); });
  if (run.length) out.push(run);
  return out;
}

/** Pure: round axis for values between lo0 and hi0 (a 1, 2 or 5 step), at most 6 gridlines; a single value gets a band around it. */
export function niceAxis(lo0: number, hi0: number): { lo: number; hi: number; step: number; ticks: number[] } {
  const span = Math.max(hi0 - lo0, Math.max(2, Math.abs(hi0) * 0.1));
  const raw = span / 3, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
  const lo = Math.max(0, Math.floor((lo0 - (hi0 - lo0) * 0.1) / step) * step);
  let hi = Math.ceil((hi0 + (hi0 - lo0) * 0.1) / step) * step;
  if (hi <= lo) hi = lo + step;
  if (hi - lo < step * 2) hi = lo + step * 2;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 1e6 && ticks.length < 8; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { lo, hi: ticks[ticks.length - 1]!, step, ticks };
}

export async function renderTrendCard(card: ScoreCard): Promise<Buffer> {
  const trend = card.trend!, layers: { input: Buffer; left: number; top: number }[] = [];
  const put = async (markup: string, size: number, left: number, top: number, maxWidth = 1080, align: "left" | "right" = "left") => {
    const t = await text(markup, size, maxWidth);
    layers.push({ input: t.input, left: Math.round(align === "right" ? left - t.width : left), top: Math.round(top) });
  };
  const shapes = [`<rect width="1200" height="630" fill="${C.bg}"/>`, `<rect width="12" height="630" fill="${C.bar}"/>`,
    `<rect x="26" y="14" width="1160" height="602" rx="6" fill="none" stroke="${C.frame}" stroke-width="2"/>`];
  await put(span(C.gold, clip(card.eyebrow ?? "", 44).toUpperCase(), ' letter_spacing="1800"'), 20, 60, 40);
  await put(span(C.ink, clip(card.title, 40)), 52, 58, 64);
  await put(span(C.muted, clip(card.subtitle, 60)), 24, 60, 134);

  // Chart panel.
  const px = 60, py = 176, pw = 740, ph = 384, cx = px + 56, cw = pw - 56 - 24, cy = py + 52, ch = ph - 52 - 40;
  shapes.push(`<rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="14" fill="${C.panel}" stroke="${C.edge}" stroke-width="1.5"/>`);
  for (const [i, s] of trend.series.entries()) {
    const lx = px + 24 + i * 232;
    shapes.push(`<rect x="${lx}" y="${py + 20}" width="22" height="6" rx="3" fill="${s.color}"/>`);
    await put(span(C.muted, clip(s.label, 22)), 16, lx + 30, py + 12, 190);
  }
  const known = trend.series.flatMap(s => s.values.filter((v): v is number => v !== null));
  if (trend.days.length < 1 || !known.length) {
    await put(span(C.muted, clip(trend.emptyNote ?? "—", 60)), 30, px + pw / 2 - 170, py + ph / 2 - 10, 340);
  } else {
    const { lo, hi, ticks } = niceAxis(Math.min(...known), Math.max(...known)), range = Math.max(1, hi - lo);
    // One day of history: the point sits in the middle of the chart instead of dividing by zero.
    const x = (i: number) => trend.days.length < 2 ? cx + cw / 2 : cx + (i * cw) / (trend.days.length - 1), y = (v: number) => cy + ch * (1 - (v - lo) / range);
    for (const v of ticks) {
      const gy = y(v);
      shapes.push(`<line x1="${cx}" x2="${cx + cw}" y1="${gy.toFixed(1)}" y2="${gy.toFixed(1)}" stroke="${C.edge}" stroke-opacity=".5"/>`);
      await put(span(C.muted, String(Math.round(v))), 15, cx - 8, gy - 10, 60, "right");
    }
    for (const s of trend.series) for (const run of segments(s.values)) {
      const pts = run.map(i => `${x(i).toFixed(1)},${y(s.values[i]!).toFixed(1)}`);
      shapes.push(run.length > 1 ? `<polyline fill="none" stroke="${s.color}" stroke-width="3" stroke-linejoin="round" points="${pts.join(" ")}"/>` : "",
        ...(run.length <= 45 || run.length === 1 ? run.map(i => `<circle cx="${x(i).toFixed(1)}" cy="${y(s.values[i]!).toFixed(1)}" r="${run.length === 1 ? 6 : 3.5}" fill="${s.color}"/>`) : []));
      // A lone point (the first day, or a gap on both sides) carries its value so it is not read as an empty chart.
      if (run.length === 1) await put(span(s.color, String(Math.round(s.values[run[0]!]!))), 18, x(run[0]!) + 10, y(s.values[run[0]!]!) - 28, 80);
    }
    if (trend.emptyNote) await put(span(C.muted, clip(trend.emptyNote, 60)), 20, cx + 12, cy + 6, cw - 24);
    await put(span(C.muted, trend.days[0]!), 15, cx, cy + ch + 10, 200);
    await put(span(C.muted, trend.days[trend.days.length - 1]!), 15, cx + cw, cy + ch + 10, 200, "right");
  }

  // Tiles: current value and 7 / 30 / 90 day changes.
  const tx = 824, tw = 316, th = 118, gap = 15;
  for (const [i, tile] of trend.tiles.entries()) {
    const ty = py + i * (th + gap);
    shapes.push(`<rect x="${tx}" y="${ty}" width="${tw}" height="${th}" rx="12" fill="${C.panel}" stroke="${C.edge}" stroke-width="1.5"/>`, `<rect x="${tx}" y="${ty + 14}" width="5" height="${th - 28}" rx="2" fill="${tile.color}"/>`);
    await put(span(C.muted, clip(tile.label, 26)), 17, tx + 20, ty + 10, tw - 40);
    await put(span(C.ink, tile.value), 40, tx + 20, ty + 34, 120);
    for (const [j, d] of tile.deltas.entries()) {
      const dx = tx + 20 + j * 92, color = d.tone === "green" ? C.green : d.tone === "red" ? C.red : C.muted;
      await put(span(C.muted, d.label), 14, dx, ty + 82, 80);
      await put(span(color, d.text), 19, dx + 34, ty + 79, 56);
    }
  }
  shapes.push(`<rect x="60" y="578" width="1080" height="1" fill="${C.edge}"/>`);
  await put(span(C.muted, clip(card.footer, 160)), 17, 60, 588);
  const base = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">${shapes.join("")}</svg>`);
  return sharp(base).composite(layers).png().toBuffer();
}
