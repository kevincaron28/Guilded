import { CardCanvas, CARD_H, CARD_W, INK, SUB } from "./card-kit.js";
import type { ScoreCard } from "./score-card.js";

// The officer member-trend card (member-trend.ts): up to three lines over 30 or 90 days on the left, one tile per series on
// the right with the current value and the change over 7, 30 and 90 days. 22 Nov 2026 audit: redrawn on the shared card kit
// (CardCanvas: the gothic title face, Carlito text, 24 px floor and the contrast check) so it matches every other card.

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

const C = { bg: "#120d08", panel: "#1d160f", edge: "#5d4a26", gold: "#ffd100", green: "#86e66a", red: "#ff7a66" };

export async function renderTrendCard(card: ScoreCard): Promise<Buffer> {
  const trend = card.trend!, c = new CardCanvas();
  c.rect(0, 0, CARD_W, CARD_H, C.bg);
  c.rect(0, 0, CARD_W, 6, C.gold);
  await c.text((card.eyebrow ?? "").toUpperCase(), 48, 22, { size: 24, face: "title", color: C.gold, spacing: 600, maxW: 700 });
  await c.text(card.title, 48, 50, { size: 56, face: "title", maxW: 720 });
  await c.text(card.subtitle, CARD_W - 48, 70, { size: 26, color: SUB, anchor: "r", maxW: 380 });

  // Chart panel, legend inside its top edge.
  const px = 40, py = 132, pw = 760, ph = 430, cx = px + 70, cw = pw - 70 - 28, cy = py + 64, ch = ph - 64 - 56;
  c.rect(px, py, pw, ph, C.panel, { rx: 14, stroke: C.edge, strokeWidth: 1.5 });
  let lx = px + 24;
  for (const s of trend.series) {
    c.rect(lx, py + 30, 22, 6, s.color, { rx: 3 });
    const drawn = await c.text(s.label, lx + 30, py + 18, { size: 24, color: SUB, maxW: 200 });
    lx = drawn.right + 28;
  }
  const known = trend.series.flatMap(s => s.values.filter((v): v is number => v !== null));
  if (trend.days.length < 1 || !known.length) {
    await c.text(trend.emptyNote ?? "—", px + pw / 2, py + ph / 2 - 16, { size: 30, color: SUB, anchor: "c", maxW: pw - 60 });
  } else {
    const { lo, hi, ticks } = niceAxis(Math.min(...known), Math.max(...known)), range = Math.max(1, hi - lo);
    const x = (i: number) => trend.days.length < 2 ? cx + cw / 2 : cx + (i * cw) / (trend.days.length - 1), y = (v: number) => cy + ch * (1 - (v - lo) / range);
    // At most four labelled gridlines at this text size: every other one when the axis has more.
    const every = ticks.length > 4 ? 2 : 1;
    for (const [k, v] of ticks.entries()) {
      const gy = y(v);
      c.raw(`<line x1="${cx}" x2="${cx + cw}" y1="${gy.toFixed(1)}" y2="${gy.toFixed(1)}" stroke="${C.edge}" stroke-opacity=".6"/>`);
      if (k % every === 0) await c.text(String(Math.round(v)), cx - 12, gy - 15, { size: 24, color: SUB, anchor: "r" });
    }
    for (const s of trend.series) for (const run of segments(s.values)) {
      const pts = run.map(i => `${x(i).toFixed(1)},${y(s.values[i]!).toFixed(1)}`);
      if (run.length > 1) c.raw(`<polyline fill="none" stroke="${s.color}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round" points="${pts.join(" ")}"/>`);
      if (run.length <= 45) for (const i of run) c.raw(`<circle cx="${x(i).toFixed(1)}" cy="${y(s.values[i]!).toFixed(1)}" r="${run.length === 1 ? 7 : 4}" fill="${s.color}"/>`);
      // A lone point (the first day, or a gap on both sides) carries its value so it is not read as an empty chart.
      if (run.length === 1) await c.text(String(Math.round(s.values[run[0]!]!)), x(run[0]!) + 12, y(s.values[run[0]!]!) - 34, { size: 24, color: s.color });
    }
    if (trend.emptyNote) await c.text(trend.emptyNote, cx + 12, cy + 4, { size: 24, color: SUB, maxW: cw - 24 });
    await c.text(trend.days[0]!, cx, cy + ch + 14, { size: 24, color: SUB });
    if (trend.days.length > 1) await c.text(trend.days[trend.days.length - 1]!, cx + cw, cy + ch + 14, { size: 24, color: SUB, anchor: "r" });
  }

  // Tiles: current value, then the 7 / 30 / 90 day changes on one line.
  const tx = 824, tw = 336, th = 132, gap = 17;
  for (const [i, tile] of trend.tiles.entries()) {
    const ty = py + i * (th + gap);
    c.rect(tx, ty, tw, th, C.panel, { rx: 12, stroke: C.edge, strokeWidth: 1.5 });
    c.rect(tx, ty + 16, 6, th - 32, tile.color, { rx: 3 });
    await c.text(tile.label, tx + 24, ty + 12, { size: 24, color: SUB, maxW: tw - 48 });
    await c.text(tile.value, tx + 24, ty + 40, { size: 48, face: "bold", color: INK, maxW: 130 });
    // Right-aligned inside the tile, last change first, so a wide value never pushes them past the edge.
    let right = tx + tw - 20;
    for (const d of [...tile.deltas].reverse()) {
      const color = d.tone === "green" ? C.green : d.tone === "red" ? C.red : SUB;
      const value = await c.text(d.text, right, ty + 52, { size: 24, face: "bold", color, anchor: "r" });
      const label = await c.text(d.label, value.right - value.w - 5, ty + 52, { size: 24, color: SUB, anchor: "r" });
      right = label.right - label.w - 14;
    }
  }
  c.rect(40, 580, CARD_W - 80, 1, C.edge);
  await c.text(card.footer, 48, 590, { size: 24, color: SUB, maxW: CARD_W - 96 });
  return (await c.finish([])).png;
}
