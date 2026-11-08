// Renders the sample Guilded Collection card designs for docs/plans/APP_TCG_ART.md.
// Original vector iconography only (no Blizzard art). Run from the repo root:
//   node docs/plans/app-tcg-art/make-samples.mjs
// If `sharp` is not installed in this checkout, point REPO_NODE_MODULES at one that has it.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const require = createRequire(process.env.REPO_NODE_MODULES ? `${process.env.REPO_NODE_MODULES}/x.js` : import.meta.url);
const sharp = require("sharp");
const fontfile = fileURLToPath(new URL("../../../site/fonts/source-serif-latin.ttf", import.meta.url));
const out = fileURLToPath(new URL("./", import.meta.url));
mkdirSync(out, { recursive: true });

const W = 480, H = 680;
const GOLD = "#ffd100", PARCH = "#f5e6c0", MUTED = "#b9a77f", BROWN = "#120d08", PANEL = "#21180f";

// Class emblems, drawn around (0,0) in a ~130 px box. Simple geometric shapes, original to Guilded.
const emblems = {
  warrior: (c) => `<g fill="none" stroke="${c}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">
    <path d="M0 -62 L50 -42 L50 8 Q50 46 0 66 Q-50 46 -50 8 L-50 -42 Z" fill="${c}" fill-opacity="0.16"/>
    <path d="M-30 -22 L30 38 M30 -22 L-30 38"/><path d="M-38 -30 L-24 -16 M38 -30 L24 -16" stroke-width="9"/></g>`,
  mage: (c) => `<g fill="none" stroke="${c}" stroke-width="6" stroke-linejoin="round" stroke-linecap="round">
    <circle r="58" fill="${c}" fill-opacity="0.12"/><circle r="40" stroke-width="3"/>
    <path d="M0 -52 L12 -12 L52 0 L12 12 L0 52 L-12 12 L-52 0 L-12 -12 Z" fill="${c}" fill-opacity="0.35"/>
    <path d="M-36 -36 L36 36 M36 -36 L-36 36" stroke-width="3"/></g>`,
  paladin: (c) => `<g fill="none" stroke="${c}" stroke-width="6" stroke-linejoin="round" stroke-linecap="round">
    <circle r="30" fill="${c}" fill-opacity="0.25"/>
    ${Array.from({ length: 12 }, (_, i) => { const a = (i * Math.PI) / 6, r1 = 40, r2 = i % 2 ? 56 : 68; return `<path d="M${(Math.cos(a) * r1).toFixed(1)} ${(Math.sin(a) * r1).toFixed(1)} L${(Math.cos(a) * r2).toFixed(1)} ${(Math.sin(a) * r2).toFixed(1)}"/>`; }).join("")}
    <path d="M0 -22 L0 22 M-16 -8 L16 -8" stroke-width="9"/></g>`
};

// Rarity frames: colour, glow and corner ornament count rise with rarity (same colours as WoW item quality).
const rarities = {
  common: { name: "COMMON", edge: "#9d9d9d", edge2: "#5c5c5c", glow: 0, corners: 0, gem: "#cfcfcf" },
  rare: { name: "RARE", edge: "#3b8fe8", edge2: "#17508f", glow: 0.35, corners: 1, gem: "#5aa9ff" },
  epic: { name: "EPIC", edge: "#b25cf0", edge2: "#5f2a8a", glow: 0.7, corners: 2, gem: "#c987ff" }
};

async function label(markup, size, width, opts = {}) {
  const { data, info } = await sharp({ text: { text: markup, font: `Source Serif 4 ${size}`, fontfile, width, rgba: true, wrap: opts.wrap ?? "none", align: opts.align ?? "left" } }).png().toBuffer({ resolveWithObject: true });
  return { input: data, w: info.width, h: info.height };
}
const span = (color, text, weight = "normal") => `<span foreground="${color}" weight="${weight}">${text.replace(/&/g, "&amp;")}</span>`;

function corner(x, y, flipX, flipY, color) {
  return `<g transform="translate(${x} ${y}) scale(${flipX ? -1 : 1} ${flipY ? -1 : 1})" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round"><path d="M0 26 L0 0 L26 0"/><path d="M8 20 L8 8 L20 8" stroke-width="2"/><circle cx="3" cy="3" r="3" fill="${color}"/></g>`;
}

async function card({ file, klass, rarity, name, type, text, flavour, art, number }) {
  const r = rarities[rarity];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a1d10"/><stop offset="1" stop-color="${BROWN}"/></linearGradient>
    <linearGradient id="edge" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${r.edge}"/><stop offset="0.5" stop-color="${r.edge2}"/><stop offset="1" stop-color="${r.edge}"/></linearGradient>
    <radialGradient id="art" cx="0.5" cy="0.45" r="0.7"><stop offset="0" stop-color="${art.glow}" stop-opacity="0.85"/><stop offset="0.6" stop-color="${art.deep}"/><stop offset="1" stop-color="#0c0804"/></radialGradient>
    <filter id="blur"><feGaussianBlur stdDeviation="14"/></filter>
  </defs>
  <rect width="${W}" height="${H}" rx="26" fill="#000" fill-opacity="0"/>
  ${r.glow ? `<rect x="6" y="6" width="${W - 12}" height="${H - 12}" rx="24" fill="none" stroke="${r.edge}" stroke-opacity="${r.glow}" stroke-width="10" filter="url(#blur)"/>` : ""}
  <rect x="6" y="6" width="${W - 12}" height="${H - 12}" rx="24" fill="url(#edge)"/>
  <rect x="16" y="16" width="${W - 32}" height="${H - 32}" rx="18" fill="url(#bg)"/>
  <rect x="16" y="16" width="${W - 32}" height="${H - 32}" rx="18" fill="none" stroke="${GOLD}" stroke-opacity="0.45" stroke-width="1.5"/>
  <!-- art window -->
  <rect x="34" y="84" width="${W - 68}" height="320" rx="10" fill="url(#art)" stroke="${r.edge}" stroke-width="3"/>
  <g transform="translate(${W / 2} 244)" opacity="0.18" stroke="${art.line}" stroke-width="2">${Array.from({ length: 18 }, (_, i) => { const a = (i * Math.PI) / 9; return `<path d="M0 0 L${(Math.cos(a) * 260).toFixed(0)} ${(Math.sin(a) * 260).toFixed(0)}"/>`; }).join("")}</g>
  <rect x="34" y="84" width="${W - 68}" height="320" rx="10" fill="none" stroke="#000" stroke-opacity="0.5" stroke-width="1"/>
  <g transform="translate(${W / 2} 244) scale(1.55)">${emblems[klass](art.line)}</g>
  <!-- name banner -->
  <path d="M26 30 H${W - 26} V74 L${W - 38} 80 H38 L26 74 Z" fill="${PANEL}" stroke="${GOLD}" stroke-opacity="0.7" stroke-width="2"/>
  <!-- type line -->
  <rect x="34" y="412" width="${W - 68}" height="34" rx="6" fill="${PANEL}" stroke="${r.edge}" stroke-opacity="0.8" stroke-width="1.5"/>
  <circle cx="${W - 58}" cy="429" r="9" fill="${r.gem}" stroke="${GOLD}" stroke-width="1.5"/>
  <!-- text box -->
  <rect x="34" y="456" width="${W - 68}" height="170" rx="8" fill="#17100a" stroke="#6b5322" stroke-width="1.5"/>
  <path d="M60 ${H - 44} H${W - 60}" stroke="${GOLD}" stroke-opacity="0.35" stroke-width="1"/>
  ${[...Array(r.corners)].length ? corner(24, 24, false, false, GOLD) + corner(W - 24, 24, true, false, GOLD) + corner(24, H - 24, false, true, GOLD) + corner(W - 24, H - 24, true, true, GOLD) : ""}
  ${r.corners > 1 ? `<path d="M${W / 2 - 60} 84 L${W / 2} 70 L${W / 2 + 60} 84" fill="none" stroke="${GOLD}" stroke-width="2"/>` : ""}
</svg>`;
  const base = await sharp(Buffer.from(svg)).png().toBuffer();
  const layers = [];
  const put = async (markup, size, x, y, width, opts) => { const l = await label(markup, size, width, opts); layers.push({ input: l.input, left: Math.round(x + (opts?.center ? (width - l.w) / 2 : 0)), top: Math.round(y) }); };
  await put(span(GOLD, name.toUpperCase(), "bold"), 30, 40, 36, W - 80, { center: true });
  await put(span(PARCH, type), 19, 46, 417, W - 120);
  await put(span(r.gem, r.name, "bold"), 13, 40, 640, 140);
  await put(span(MUTED, `Guilded Collection · ${number}`), 13, W - 230, 640, 190, { align: "right", center: false });
  await put(span(PARCH, text), 20, 50, 468, W - 100, { wrap: "word" });
  await put(span(MUTED, `<i>${flavour}</i>`), 16, 50, 560, W - 100, { wrap: "word" });
  await sharp(base).composite(layers).png().toFile(`${out}${file}`);
}

async function back() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs><linearGradient id="e" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd100"/><stop offset="0.5" stop-color="#8a6a2b"/><stop offset="1" stop-color="#ffd100"/></linearGradient>
  <radialGradient id="c" cx="0.5" cy="0.5" r="0.7"><stop offset="0" stop-color="#3a2813"/><stop offset="1" stop-color="${BROWN}"/></radialGradient></defs>
  <rect x="6" y="6" width="${W - 12}" height="${H - 12}" rx="24" fill="url(#e)"/>
  <rect x="16" y="16" width="${W - 32}" height="${H - 32}" rx="18" fill="url(#c)"/>
  <g transform="translate(${W / 2} ${H / 2})" fill="none" stroke="${GOLD}" stroke-linecap="round">
    <circle r="150" stroke-width="3" stroke-opacity="0.8"/><circle r="128" stroke-width="1.5" stroke-opacity="0.6"/>
    ${Array.from({ length: 16 }, (_, i) => { const a = (i * Math.PI) / 8; return `<path d="M${(Math.cos(a) * 60).toFixed(0)} ${(Math.sin(a) * 60).toFixed(0)} L${(Math.cos(a) * (i % 2 ? 128 : 146)).toFixed(0)} ${(Math.sin(a) * (i % 2 ? 128 : 146)).toFixed(0)}" stroke-width="${i % 2 ? 2 : 4}" stroke-opacity="0.75"/>`; }).join("")}
    <path d="M0 -58 L50 -30 L50 22 Q50 50 0 66 Q-50 50 -50 22 L-50 -30 Z" stroke-width="6" fill="${GOLD}" fill-opacity="0.12"/>
    <path d="M-22 -8 L-6 8 L24 -22" stroke-width="9" stroke-linejoin="round"/>
  </g>
  <rect x="28" y="28" width="${W - 56}" height="${H - 56}" rx="12" fill="none" stroke="${GOLD}" stroke-opacity="0.4" stroke-width="1.5" stroke-dasharray="3 7"/></svg>`;
  const l = await label(span(GOLD, "GUILDED", "bold"), 34, 300, { center: true });
  await sharp(Buffer.from(svg)).composite([{ input: l.input, left: Math.round((W - l.w) / 2), top: H - 120 }]).png().toFile(`${out}card-back.png`);
}

async function pack() {
  const PW = 360, PH = 560;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PW}" height="${PH}">
  <defs><linearGradient id="p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7a5a1d"/><stop offset="0.5" stop-color="#3a2813"/><stop offset="1" stop-color="#1a1209"/></linearGradient>
  <linearGradient id="foil" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8a6a2b"/><stop offset="0.5" stop-color="#ffe27a"/><stop offset="1" stop-color="#8a6a2b"/></linearGradient></defs>
  <path d="M10 26 L28 14 L46 26 L64 14 L82 26 L100 14 L118 26 L136 14 L154 26 L172 14 L190 26 L208 14 L226 26 L244 14 L262 26 L280 14 L298 26 L316 14 L334 26 L350 14 V${PH - 26} L334 ${PH - 14} L316 ${PH - 26} L298 ${PH - 14} L280 ${PH - 26} L262 ${PH - 14} L244 ${PH - 26} L226 ${PH - 14} L208 ${PH - 26} L190 ${PH - 14} L172 ${PH - 26} L154 ${PH - 14} L136 ${PH - 26} L118 ${PH - 14} L100 ${PH - 26} L82 ${PH - 14} L64 ${PH - 26} L46 ${PH - 14} L28 ${PH - 26} L10 ${PH - 14} Z" fill="url(#p)" stroke="url(#foil)" stroke-width="4" stroke-linejoin="round"/>
  <rect x="30" y="60" width="${PW - 60}" height="${PH - 120}" rx="14" fill="none" stroke="${GOLD}" stroke-opacity="0.55" stroke-width="2"/>
  <g transform="translate(${PW / 2} 250)" fill="none" stroke="${GOLD}" stroke-linecap="round">
    <circle r="96" stroke-width="3" stroke-opacity="0.7"/>
    ${Array.from({ length: 16 }, (_, i) => { const a = (i * Math.PI) / 8; return `<path d="M${(Math.cos(a) * 100).toFixed(0)} ${(Math.sin(a) * 100).toFixed(0)} L${(Math.cos(a) * (i % 2 ? 118 : 134)).toFixed(0)} ${(Math.sin(a) * (i % 2 ? 118 : 134)).toFixed(0)}" stroke-width="3" stroke-opacity="0.7"/>`; }).join("")}
    <path d="M0 -70 L56 -44 L56 18 Q56 56 0 76 Q-56 56 -56 18 L-56 -44 Z" stroke-width="6" fill="${GOLD}" fill-opacity="0.14"/>
    <path d="M-26 -6 L-8 12 L28 -26" stroke-width="10" stroke-linejoin="round"/></g>
  <rect x="48" y="${PH - 150}" width="${PW - 96}" height="56" rx="8" fill="#120d08" stroke="${GOLD}" stroke-opacity="0.7" stroke-width="2"/></svg>`;
  const t1 = await label(span(GOLD, "GUILDED", "bold"), 40, 300, { center: true });
  const t2 = await label(span(PARCH, "DAILY PACK · 5 CARDS"), 17, 260, { center: true });
  await sharp(Buffer.from(svg)).composite([
    { input: t1.input, left: Math.round((PW - t1.w) / 2), top: 78 },
    { input: t2.input, left: Math.round((PW - t2.w) / 2), top: PH - 133 }
  ]).png().toFile(`${out}pack.png`);
}

await card({ file: "card-common-warrior.png", klass: "warrior", rarity: "common", name: "Warrior", type: "Class · Forever", number: "C 001/009",
  text: "Holds the line. Shows on your profile once you reach level 10 on a warrior.", flavour: "Someone has to stand in front.",
  art: { glow: "#8a6a4a", deep: "#2b2016", line: "#d8c7a3" } });
await card({ file: "card-rare-mage.png", klass: "mage", rarity: "rare", name: "Mage", type: "Class · Forever", number: "R 004/009",
  text: "Arcane focus. A Rare drop; sets up your showcase with a blue frame.", flavour: "Do not stand in the fire. Or the frost.",
  art: { glow: "#3b8fe8", deep: "#10243f", line: "#bfe0ff" } });
await card({ file: "card-epic-paladin.png", klass: "paladin", rarity: "epic", name: "Paladin", type: "Class · Forever", number: "E 007/009",
  text: "Light made solid. An Epic drop, guaranteed within 10 packs.", flavour: "The light does not ask twice.",
  art: { glow: "#b25cf0", deep: "#2a1040", line: "#ffe27a" } });
await back();
await pack();
console.log("rendered into", out);
