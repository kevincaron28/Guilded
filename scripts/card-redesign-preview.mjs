// Card redesign PROPOSAL renders (13 Nov 2026). Nothing here ships: it draws five sample cards in three layout directions
// with the same stack the bot uses (sharp, Pango text with the Source Serif font, SVG shapes, the approved site/card-art
// paintings) so the owner can compare like with like. It does not import or change score-card.ts / end-cards.ts.
//   node scripts/card-redesign-preview.mjs [outDir]      default C:\Users\Kev\Desktop\Guilded-Art\card-redesign
// Output: <direction>-<card>.png (1200x630), <direction>-sheet.png, compare-all.png, contrast-and-size.txt.
// Rules checked on every string: size >= MIN_SIZE (24 px = 8 px when Discord shows the card 400 px wide) and contrast >= 4.5:1
// against the brightest 5 % of the pixels behind the text (painting + overlays + panels, before the text is drawn).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
// Faces: the shipped Source Serif (italic only) for card titles; Carlito (SIL OFL, Calibri-metric, upright) is the PROPOSED upright face
// for hero lines, names and numbers: it would be added to site/fonts/ with its licence (Regular + Bold, about 1.2 MB, bot image only).
const FONTS = { serif: join(repo, "site", "fonts", "source-serif-latin.ttf"), sans: "C:/Windows/Fonts/Carlito-Regular.ttf", bold: "C:/Windows/Fonts/Carlito-Bold.ttf" };
const FAMILY = { serif: "Source Serif 4", sans: "Carlito", bold: "Carlito Bold" };
const out = process.argv[2] ?? "C:\\Users\\Kev\\Desktop\\Guilded-Art\\card-redesign";
const W = 1200, H = 630, MIN_SIZE = 24, MIN_RATIO = 4.5;
const INK = "#f8f1e1", SUB = "#ddd4c0", DIM = "#cfc5ad", GREEN = "#86e66a";

// ---------- sample data (sample names only) ----------
const WAR = "#c79c6e", MAGE = "#69ccf0", PRIEST = "#ffffff", ROGUE = "#fff569", HUNTER = "#abd473", PAL = "#f58cba", LOCK = "#9482c9", DRU = "#ff7d0a", SHAM = "#4d9cff", PRI = "#ffffff";
const ladderNames = [["Aldric Stormvale", WAR], ["Brenna Ironwood", MAGE], ["Cedric Dawnhollow", PAL], ["Dara Nightbloom", DRU], ["Edric Thornfield", HUNTER], ["Fenna Ashgrove", LOCK],
  ["Garrick Moonwell", PRI], ["Hilda Redcliff", ROGUE], ["Ivor Stonebrook", SHAM], ["Jora Whitefen", MAGE], ["Kell Duskmantle", WAR], ["Lysa Brightwater", PAL]];
const ladder = ladderNames.map(([name, color], i) => ({ rank: i + 1, name, color, score: 300 - i * 17, w: 20 - i, l: 2 + i, pct: Math.round(((20 - i) / (22 + 0)) * 100 - i * 3) }));
const CARDS = {
  duel: { type: "duel", accent: "#ff4d4d", tint: "#ff8f80", art: "board/duel", emblem: "duel", label: "DUEL", title: "Duel result", hero: "Victory", heroColor: GREEN, heroNote: "+14 score",
    names: [["Aldric Stormvale", WAR], ["beat Brenna Ironwood", MAGE]], stats: [["21-2", "record"], ["W3", "streak"], ["#1", "guild rank"]], strip: "Level 60 vs 58  \u00b7  13 Nov 2026" },
  battleground: { type: "battleground", accent: "#e0265a", tint: "#ff7fa6", art: "board/battlegrounds", emblem: "flag", label: "BATTLEGROUND", title: "Warsong Gulch", hero: "Victory", heroColor: GREEN,
    names: [], stats: [["20:10", "match time"], ["10v10", "bracket 60"], ["Party", "confirmed"]], strip: "Private to you  \u00b7  12 Nov 2026" },
  weekly: { type: "weekly", accent: "#ffd100", tint: "#ffd100", art: "board/hall-of-fame", emblem: "cup", label: "WEEKLY REPORT", title: "This week", hero: "24 players", heroColor: INK,
    names: [], stats: [["+18%", "vs last week"]], rows: [{ name: "Aldric", color: WAR, right: "1250" }, { name: "Brenna", color: MAGE, right: "980" }, { name: "Cedric", color: PRIEST, right: "740" }],
    strip: "Week 46  \u00b7  7 to 13 Nov 2026" },
  ladder: { type: "ladder", accent: "#ff4d4d", tint: "#ff8f80", art: "board/duel", emblem: "bars", label: "DUEL LADDER  \u00b7  13 NOV", title: "Guild duels", hero: "Aldric Stormvale", heroColor: WAR, heroNote: "leads with 300",
    names: [], stats: [], ladder, strip: "160 duels  \u00b7  12 duellists  \u00b7  13 Nov 2026" },
  raid: { type: "raid", accent: "#ff9a2e", tint: "#ffb366", art: "raid/default", emblem: "flame", label: "RAID NIGHT", title: "Molten Core", hero: "10/10 bosses", heroColor: GREEN,
    names: [], stats: [["38", "raiders"], ["3h 00m", "duration"], ["2", "items"]], rows: [{ name: "Sample Sword", color: "#f2c94c", sub: "Aldric", right: "100 GP" }],
    strip: "100 EP each  \u00b7  2 late  \u00b7  1 absent  \u00b7  9 Dec" }
};

// ---------- drawing kit ----------
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const lum = (hex) => { const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

async function raw(markup, size, face = "serif") {
  const { data, info } = await sharp({ text: { text: markup, font: `${FAMILY[face]} ${size}`, fontfile: FONTS[face], rgba: true, wrap: "none" } }).png().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}
const markupOf = (str, o) => {
  return `<span foreground="${o.color ?? INK}"${o.spacing ? ` letter_spacing="${o.spacing}"` : ""}>${esc(str)}</span>`;
};

function kit() {
  const c = { shapes: "", texts: [], n: 0, minSize: 999, bounds: { r: 0, b: 0 } };
  c.id = (p) => `${p}${c.n++}`;
  c.rect = (x, y, w, h, fill, o = {}) => { c.shapes += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${o.rx ?? 0}" fill="${fill}"${o.stroke ? ` stroke="${o.stroke}" stroke-width="${o.sw ?? 2}"` : ""}${o.op != null ? ` fill-opacity="${o.op}"` : ""}/>`; };
  c.gradient = (x, y, w, h, dir, stops) => {
    const id = c.id("g"), [x2, y2] = dir === "h" ? [1, 0] : [0, 1];
    c.shapes += `<defs><linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(([o, col, a]) => `<stop offset="${o}" stop-color="${col}" stop-opacity="${a}"/>`).join("")}</linearGradient></defs><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${id})"/>`;
  };
  c.emblem = (kind, x, y, size, color) => {
    const paths = {
      duel: '<path d="M10 54 L46 14 M54 54 L18 14 M6 46 L22 58 M58 46 L42 58"/><path d="M46 14 L54 8 M18 14 L10 8"/>',
      flag: '<path d="M16 8 V58"/><path d="M16 10 H52 L43 22 L52 34 H16 Z"/>',
      cup: '<path d="M20 10 H44 V26 Q44 40 32 42 Q20 40 20 26 Z"/><path d="M32 42 V52 M22 57 H42 M20 14 H10 Q10 28 20 30 M44 14 H54 Q54 28 44 30"/>',
      bars: '<rect x="8" y="34" width="14" height="22"/><rect x="25" y="14" width="14" height="42"/><rect x="42" y="26" width="14" height="30"/>',
      flame: '<path d="M32 5 C40 20 52 26 50 42 C48 54 40 59 32 59 C22 59 14 53 14 42 C14 32 22 28 26 18 C28 24 30 26 32 29 C35 20 32 12 32 5 Z"/>'
    };
    c.shapes += `<g transform="translate(${x} ${y}) scale(${size / 64})" fill="none" stroke="${color}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round">${paths[kind]}</g>`;
  };
  // Text: o = { size, color, bold, italic, maxW, anchor: "l" | "r" | "c" }. Never below MIN_SIZE: shrinks to it, then ends with an ellipsis.
  c.text = async (str, x, y, o) => {
    let size = o.size, s = str;
    if (size < MIN_SIZE) throw new Error(`"${str}" is ${size}px, below the ${MIN_SIZE}px floor`);
    let r = await raw(markupOf(s, o), size, faceOf(o));
    while (o.maxW && r.w > o.maxW && size > MIN_SIZE) { size = Math.max(MIN_SIZE, size - 2); r = await raw(markupOf(s, o), size, faceOf(o)); }
    while (o.maxW && r.w > o.maxW && s.length > 2) { s = `${s.slice(0, -2).trimEnd()}\u2026`; r = await raw(markupOf(s, o), size, faceOf(o)); }
    const left = o.anchor === "r" ? x - r.w : o.anchor === "c" ? x - r.w / 2 : x;
    c.texts.push({ data: r.data, left: Math.round(left), top: Math.round(y), w: r.w, h: r.h, color: o.color ?? INK, size, str: s, bold: !!o.bold });
    c.minSize = Math.min(c.minSize, size);
    c.bounds.r = Math.max(c.bounds.r, left + r.w); c.bounds.b = Math.max(c.bounds.b, y + r.h);
    return { w: r.w, h: r.h, right: left + r.w, bottom: y + r.h };
  };
  return c;
}

const artCache = new Map();
async function art(key, fit = {}) {
  const id = `${key}${JSON.stringify(fit)}`;
  if (!artCache.has(id)) artCache.set(id, await sharp(join(repo, "site", "card-art", `${key}.jpg`)).resize(fit.w ?? W, fit.h ?? H, { fit: "cover", position: fit.pos ?? "centre" }).removeAlpha().toBuffer());
  return artCache.get(id);
}

/** Composes background + shapes, then text; returns the PNG and the contrast report of every string. */
async function finish(c, backdrops) {
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${c.shapes}</svg>`);
  const baseLayers = [...backdrops, { input: svg, left: 0, top: 0 }];
  const base = await sharp({ create: { width: W, height: H, channels: 3, background: "#0b0907" } }).composite(baseLayers).png().toBuffer();
  const px = await sharp(base).removeAlpha().raw().toBuffer();
  const report = [];
  for (const t of c.texts) {
    const lums = [];
    for (let y = Math.max(0, t.top); y < Math.min(H, t.top + t.h); y += 2) for (let x = Math.max(0, t.left); x < Math.min(W, t.left + t.w); x += 2) {
      const i = (y * W + x) * 3; lums.push(lum(`#${[px[i], px[i + 1], px[i + 2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`));
    }
    lums.sort((a, b) => a - b);
    const bg = lums.length ? lums[Math.floor(lums.length * 0.95)] : 0;
    report.push({ str: t.str, size: t.size, ratio: ratio(lum(t.color), bg) });
  }
  const png = await sharp(base).composite(c.texts.map((t) => ({ input: t.data, left: t.left, top: t.top }))).png().toBuffer();
  return { png, report };
}

// ---------- Direction A: art first ----------
async function dirA(card) {
  const c = kit(), x = 56, colW = 410;
  c.gradient(0, 0, 720, H, "h", [[0, "#000", 0.88], [0.6, "#000", 0.7], [1, "#000", 0]]);
  c.rect(0, 548, W, 82, "#060504", { op: 0.66 });
  c.rect(0, 546, W, 3, card.accent, { op: 0.9 });
  c.emblem(card.emblem, x, 36, 44, card.tint);
  await c.text(card.label, x + 58, 42, { size: 26, bold: true, color: card.tint, spacing: 1500 });
  await c.text(card.title, x, 96, { size: 44, italic: true, maxW: colW });
  const dense = !!card.ladder;
  let y = 154;
  const hero = await c.text(card.hero, x, y, { size: dense ? 50 : 84, bold: true, color: card.heroColor, maxW: colW });
  y += hero.h + (dense ? 8 : 2);
  if (card.heroNote) { const n = await c.text(card.heroNote, x, y, { size: 30, color: SUB, maxW: colW }); y += n.h + 8; }
  for (const [name, color] of card.names) { const n = await c.text(name, x, y, { size: 32, color, maxW: colW }); y += n.h + 4; }
  y += 12;
  for (const [v, l] of card.stats.slice(0, 3)) {
    const a = await c.text(v, x, y, { size: 40, bold: true, maxW: 200 });
    await c.text(l, x + a.w + 14, y + 9, { size: 26, color: SUB, maxW: colW - a.w - 14 });
    y += 50;
  }
  if (card.rows) for (const r of card.rows) {
    const rn = await c.text(r.name, x, y, { size: 32, color: r.color, bold: true, maxW: 240 });
    if (r.sub) await c.text(r.sub, x + rn.w + 12, y + 3, { size: 28, color: SUB, maxW: 130 });
    await c.text(r.right, x + colW, y, { size: 32, anchor: "r", bold: true, color: INK });
    y += 44;
  }
  let strip = card.strip;
  if (card.ladder) {
    const next = card.ladder.slice(1, 6);
    for (const r of next) {
      await c.text(`${r.rank}`, x, y, { size: 30, color: SUB });
      await c.text(r.name, x + 40, y, { size: 30, color: r.color, maxW: 260 });
      await c.text(`${r.score}`, x + colW, y, { size: 30, bold: true, anchor: "r" });
      y += 40;
    }
    // ranks 7-12 in the slim bottom strip, two lines of three
    const rest = card.ladder.slice(6);
    for (let line = 0; line < 2; line++) {
      let sx = 56;
      for (const r of rest.slice(line * 3, line * 3 + 3)) {
        const t = await c.text(`${r.rank} ${r.name.split(" ")[0]}`, sx, 554 + line * 34, { size: 26, color: r.color, maxW: 250 });
        await c.text(`${r.score}`, sx + t.w + 10, 554 + line * 34, { size: 26, bold: true, color: INK });
        sx += 330;
      }
    }
    strip = null;
  }
  if (strip) await c.text(strip, x, 575, { size: 26, color: SUB, maxW: W - 112 });
  return finish(c, [{ input: await art(card.art), left: 0, top: 0 }]);
}

// ---------- Direction B: glass panel ----------
async function dirB(card) {
  const c = kit(), px = 40, py = 40, pad = 30, ix = px + pad;
  let y = py + pad - 4, innerW = 470;
  c.gradient(0, 0, 760, H, "h", [[0, "#000", 0.5], [1, "#000", 0]]);
  const emblemY = y;
  await c.text(card.label, ix + 58, y + 6, { size: 26, bold: true, color: card.tint, spacing: 1500 });
  y += 58;
  if (card.ladder) {
    innerW = 470;
    await c.text(card.title, ix, y - 2, { size: 40, italic: true });
    await c.text("12 duellists", ix + innerW, y + 6, { size: 26, color: SUB, anchor: "r" });
    y += 50;
    for (const r of card.ladder) {
      c.rect(ix - 8, y - 1, innerW + 16, 34, "#ffffff", { op: r.rank % 2 ? 0.06 : 0, rx: 6 });
      await c.text(`${r.rank}`, ix + 30, y - 2, { size: 26, color: r.rank <= 3 ? card.tint : SUB, bold: r.rank <= 3, anchor: "r" });
      await c.text(r.name, ix + 48, y - 3, { size: 28, color: r.color, maxW: 230 });
      await c.text(`${r.w}-${r.l}`, ix + 370, y - 2, { size: 26, color: SUB, anchor: "r" });
      await c.text(`${r.score}`, ix + innerW, y - 3, { size: 30, bold: true, anchor: "r" });
      y += 36;
    }
    y += 4;
  } else {
    await c.text(card.title, ix, y, { size: 44, italic: true, maxW: innerW });
    y += 58;
    const h = await c.text(card.hero, ix, y, { size: 76, bold: true, color: card.heroColor, maxW: innerW });
    y += h.h + 2;
    if (card.heroNote) { const n = await c.text(card.heroNote, ix, y, { size: 30, color: SUB }); y += n.h + 6; }
    for (const [name, color] of card.names) { const n = await c.text(name, ix, y, { size: 32, color, maxW: innerW }); y += n.h + 4; }
    y += 14;
    if (card.rows) for (const r of card.rows) {
      const rn = await c.text(r.name, ix, y, { size: 32, color: r.color, bold: true, maxW: 240 });
      if (r.sub) await c.text(r.sub, ix + rn.w + 12, y + 3, { size: 28, color: SUB, maxW: 110 });
      await c.text(r.right, ix + innerW, y, { size: 32, bold: true, anchor: "r" });
      y += 42;
    }
    if (card.stats.length) {
      y += 8;
      const colw = Math.floor(innerW / Math.max(3, card.stats.length));
      let maxH = 0;
      for (const [i, [v, l]] of card.stats.entries()) {
        const a = await c.text(v, ix + i * colw, y, { size: 46, bold: true, maxW: colw - 12 });
        const b = await c.text(l, ix + i * colw, y + a.h + 4, { size: 26, color: SUB, maxW: colw - 12 });
        maxH = Math.max(maxH, a.h + b.h + 2);
      }
      y += maxH;
    }
    y += 14;
    await c.text(card.strip, ix, y, { size: 24, color: SUB, maxW: innerW });
    y += 36;
  }
  c.rect(px, py, innerW + pad * 2, y - py + pad - 6, "#0b0907", { op: 0.66, rx: 18, stroke: card.accent, sw: 2 });
  c.emblem(card.emblem, ix, emblemY, 44, card.tint); // after the panel, or the glass would dim it
  return finish(c, [{ input: await art(card.art), left: 0, top: 0 }]);
}

// ---------- Direction C: banner and body ----------
async function dirC(card) {
  const c = kit();
  if (!card.ladder && !card.rows) {
    // Result cards: the painting takes the whole card; hero low on the dark left, the three stats in a row along the bottom.
    c.gradient(0, 0, 700, H, "h", [[0, "#000", 0.8], [0.7, "#000", 0.35], [1, "#000", 0]]);
    c.gradient(0, 330, W, 300, "v", [[0, "#000", 0], [1, "#000", 0.86]]);
    c.emblem(card.emblem, 56, 40, 48, card.tint);
    await c.text(card.label, 118, 48, { size: 28, bold: true, color: card.tint, spacing: 1500 });
    await c.text(card.title, 56, 104, { size: 54, italic: true, maxW: 520 });
    let y = 226;
    const h = await c.text(card.hero, 56, y, { size: 120, bold: true, color: card.heroColor, maxW: 560 });
    y += h.h + 2;
    if (card.heroNote) { const n = await c.text(card.heroNote, 62, y, { size: 32, color: SUB }); y += n.h + 8; }
    for (const [name, color] of card.names) { const n = await c.text(name, 62, y, { size: 34, color, maxW: 520 }); y += n.h + 4; }
    c.rect(56, 478, W - 112, 2, card.accent, { op: 0.8 });
    const colw = Math.floor((W - 112) / 3);
    for (const [i, [v, l]] of card.stats.entries()) {
      const a = await c.text(v, 56 + i * colw, 486, { size: 48, bold: true, maxW: colw - 20 });
      await c.text(l, 56 + i * colw + a.w + 14, 500, { size: 26, color: SUB, maxW: colw - a.w - 30 });
    }
    await c.text(card.strip, 56, 570, { size: 26, color: SUB, maxW: W - 112 });
    return finish(c, [{ input: await art(card.art), left: 0, top: 0 }]);
  }
  // Data cards: a banner (45 % of the height; a dense ladder shrinks it to 30 %), then a flat body.
  const bh = card.ladder ? 190 : 285;
  c.gradient(0, 0, 760, bh, "h", [[0, "#000", 0.82], [0.7, "#000", 0.4], [1, "#000", 0]]);
  c.rect(0, bh, W, H - bh, "#15110d");
  c.rect(0, bh, W, 5, card.accent);
  c.emblem(card.emblem, 56, 28, 44, card.tint);
  await c.text(card.label, 116, 34, { size: 26, bold: true, color: card.tint, spacing: 1500 });
  if (card.ladder) {
    await c.text(card.title, 56, 84, { size: 46, italic: true, maxW: 420 });
    const lh = await c.text(card.hero, 56, 130, { size: 40, bold: true, color: card.heroColor, maxW: 420 });
    await c.text(card.heroNote, 56 + lh.w + 16, 140, { size: 28, color: SUB, maxW: 330 });
    const colw = 560, rowh = 56;
    for (const r of card.ladder) {
      const col = r.rank <= 6 ? 0 : 1, i = (r.rank - 1) % 6, x = 56 + col * (colw + 24), y = bh + 22 + i * rowh;
      c.rect(x - 8, y - 4, colw, rowh - 6, "#ffffff", { op: i % 2 ? 0 : 0.05, rx: 8 });
      await c.text(`${r.rank}`, x + 30, y + 2, { size: 30, bold: true, color: r.rank <= 3 ? card.tint : SUB, anchor: "r" });
      await c.text(r.name, x + 50, y + 2, { size: 32, color: r.color, maxW: 270 });
      await c.text(`${r.w}-${r.l}`, x + 430, y + 6, { size: 26, color: SUB, anchor: "r" });
      await c.text(`${r.score}`, x + colw - 24, y + 2, { size: 34, bold: true, anchor: "r" });
    }
    await c.text(card.strip, 56, 586, { size: 24, color: SUB, maxW: W - 112 });
  } else {
    await c.text(card.title, 56, 84, { size: 54, italic: true, maxW: 560 });
    await c.text(card.hero, 56, 154, { size: 76, bold: true, color: card.heroColor, maxW: 560 });
    // body: rows on the left, stats on the right
    let y = bh + 28;
    for (const r of card.rows ?? []) {
      c.rect(48, y - 8, 660, 66, "#ffffff", { op: 0.05, rx: 10 });
      const rn = await c.text(r.name, 66, y, { size: 38, bold: true, color: r.color, maxW: 330 });
      if (r.sub) await c.text(r.sub, 66 + rn.w + 14, y + 8, { size: 28, color: SUB, maxW: 150 });
      await c.text(r.right, 690, y, { size: 38, bold: true, anchor: "r" });
      y += 80;
    }
    let sy = bh + 28;
    for (const [v, l] of card.stats) {
      const a = await c.text(v, 760, sy - 4, { size: 60, bold: true, maxW: 220 });
      await c.text(l, 760 + a.w + 16, sy + 16, { size: 30, color: SUB, maxW: 1144 - 760 - a.w - 16 });
      sy += 92;
    }
    await c.text(card.strip, 56, 580, { size: 26, color: SUB, maxW: W - 112 });
  }
  const banner = await art(card.art, { w: W, h: bh, pos: card.ladder ? "centre" : "centre" });
  return finish(c, [{ input: banner, left: 0, top: 0 }]);
}

// ---------- run ----------
mkdirSync(out, { recursive: true });
const DIRS = { A: ["A-art-first", dirA], B: ["B-glass-panel", dirB], C: ["C-banner-and-body", dirC] };
const faceOf = (o) => (o.italic ? "serif" : o.bold ? "bold" : "sans");
const lines = [`Rules: min text ${MIN_SIZE}px (= ${(MIN_SIZE * 400 / W).toFixed(1)}px when Discord shows the card 400px wide); contrast >= ${MIN_RATIO}:1 against the brightest 5% of pixels behind each string.`, ""];
const files = {};
for (const [dkey, [name, fn]] of Object.entries(DIRS)) for (const [ckey, card] of Object.entries(CARDS)) {
  const { png, report } = await fn(card);
  const file = join(out, `${name}-${ckey}.png`);
  writeFileSync(file, png); (files[dkey] ??= []).push(file);
  const worst = report.reduce((a, b) => (b.ratio < a.ratio ? b : a));
  const min = Math.min(...report.map((r) => r.size));
  lines.push(`${name}-${ckey}: strings ${report.length}, min size ${min}px, worst contrast ${worst.ratio.toFixed(2)}:1 ("${worst.str}")${worst.ratio < MIN_RATIO ? "  <-- BELOW 4.5" : ""}`);
}
// contact sheets
async function sheet(file, paths, cols, tw, label) {
  const th = Math.round(tw * H / W), gap = 18, rows = Math.ceil(paths.length / cols);
  const layers = [];
  for (const [i, p] of paths.entries()) layers.push({ input: await sharp(p).resize(tw, th).toBuffer(), left: gap + (i % cols) * (tw + gap), top: 70 + gap + Math.floor(i / cols) * (th + gap) });
  const t = await raw(markupOf(label, { color: "#f8f1e1" }), 36, "bold");
  layers.push({ input: t.data, left: gap, top: 16 });
  await sharp({ create: { width: gap + cols * (tw + gap), height: 70 + gap + rows * (th + gap), channels: 3, background: "#1a1613" } }).composite(layers).png().toFile(file);
}
for (const [dkey, [name]] of Object.entries(DIRS)) await sheet(join(out, `${name}-sheet.png`), files[dkey], 2, 590, `Direction ${name.replace(/-/g, " ")}`);
const all = [];
for (let i = 0; i < 5; i++) for (const d of ["A", "B", "C"]) all.push(files[d][i]);
await sheet(join(out, "compare-all.png"), all, 3, 390, "A art first | B glass panel | C banner and body");
writeFileSync(join(out, "contrast-and-size.txt"), `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
