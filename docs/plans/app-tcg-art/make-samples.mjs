// Renders the Guilded Collection sample cards for docs/plans/APP_TCG_ART.md (style A, "Gold and stone", art pass 2).
// Every illustration is original, generated here as layered SVG (sky, distant ridges, fog, silhouettes, rim light,
// embers, grain). No Blizzard art, logos, icons, screenshots or traced shapes. Run from the repo root:
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
// The art window (card coordinates) and its size.
const AX = 34, AY = 84, AW = W - 68, AH = 320;

// Small deterministic random generator so every render is identical.
const rng = (seed) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
const f = (n) => n.toFixed(1);

/** Ember or star particles inside the art window. */
function particles(seed, count, { x0 = 0, x1 = AW, y0 = 0, y1 = AH, color = "#ffb050", rMin = 0.6, rMax = 2.2, opacity = 0.9, glow = true }) {
  const r = rng(seed);
  let s = "";
  for (let i = 0; i < count; i++) {
    const x = x0 + r() * (x1 - x0), y = y0 + r() * (y1 - y0), rad = rMin + r() * (rMax - rMin);
    s += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(rad)}" fill="${color}" opacity="${f(opacity * (0.35 + r() * 0.65))}"${glow ? ` filter="url(#soft)"` : ""}/>`;
  }
  return s;
}
/** A soft fog band: stacked blurred ellipses. */
function fog(y, color, opacity, seed = 3, bands = 5) {
  const r = rng(seed);
  let s = "";
  for (let i = 0; i < bands; i++) s += `<ellipse cx="${f(r() * AW)}" cy="${f(y + (r() - 0.5) * 24)}" rx="${f(90 + r() * 120)}" ry="${f(10 + r() * 16)}" fill="${color}" opacity="${f(opacity * (0.5 + r() * 0.5))}" filter="url(#fogblur)"/>`;
  return s;
}
/** A jagged mountain/ridge silhouette across the window. */
function ridge(seed, baseY, amp, color, opacity = 1, step = 26) {
  const r = rng(seed);
  let d = `M-10 ${AH + 10} L-10 ${f(baseY)}`;
  for (let x = -10; x <= AW + 30; x += step) d += ` L${x} ${f(baseY - r() * amp)}`;
  return `<path d="${d} L${AW + 30} ${AH + 10} Z" fill="${color}" opacity="${opacity}"/>`;
}
/** A glyph-like rune made of a few straight strokes, deterministic per index. */
function rune(i, size, color, width = 1.6) {
  const r = rng(i * 977 + 13);
  const pts = Array.from({ length: 4 }, () => [(r() - 0.5) * size, (r() - 0.5) * size * 1.4]);
  return `<path d="M0 ${f(-size * 0.7)} L0 ${f(size * 0.7)} M${f(pts[0][0])} ${f(pts[0][1])} L0 ${f(pts[1][1])} L${f(pts[2][0])} ${f(pts[2][1])}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
}
function runeRing(cx, cy, radius, count, size, color, width = 1.6, start = 0) {
  let s = "";
  for (let i = 0; i < count; i++) {
    const a = start + (i * 2 * Math.PI) / count;
    s += `<g transform="translate(${f(cx + Math.cos(a) * radius)} ${f(cy + Math.sin(a) * radius)}) rotate(${f((a * 180) / Math.PI + 90)})">${rune(i, size, color, width)}</g>`;
  }
  return s;
}

// ---- the three scenes (each is drawn in 0..AW x 0..AH local coordinates) ----

function warriorScene() {
  const shield = (cx, cy, rad, rim) => `<g transform="translate(${cx} ${cy})"><circle r="${rad}" fill="#241a12"/><circle r="${rad}" fill="url(#steel)" opacity="0.55"/><circle r="${rad}" fill="none" stroke="${rim}" stroke-width="${f(rad * 0.09)}"/><circle r="${f(rad * 0.62)}" fill="none" stroke="#000" stroke-opacity="0.35" stroke-width="2"/><circle r="${f(rad * 0.22)}" fill="${rim}" opacity="0.85"/><circle r="${f(rad * 0.22)}" fill="none" stroke="#000" stroke-opacity="0.5"/></g>`;
  const axe = (flip) => `<g transform="translate(${AW / 2} 168) scale(${flip ? -0.9 : 0.9} 0.9) rotate(-52)">
      <rect x="-5" y="-135" width="10" height="270" rx="3" fill="#4a2f1a"/><rect x="-5" y="-135" width="3" height="270" fill="#8a5b34" opacity="0.8"/>
      <path d="M5 -128 Q80 -150 84 -92 Q70 -70 5 -60 Z" fill="url(#steel)"/><path d="M5 -128 Q80 -150 84 -92" fill="none" stroke="#ffe9a0" stroke-width="2.5"/>
      <path d="M-5 -122 L-22 -112 L-5 -100 Z" fill="#6f7a86"/></g>`;
  const banner = (x, colorA) => `<g transform="translate(${x} 44)"><rect x="-1.5" y="0" width="3" height="200" fill="#2a1d12"/><path d="M1.5 6 L52 14 Q44 30 52 46 L1.5 40 Z" fill="${colorA}"/><path d="M1.5 6 L52 14" stroke="#ffd100" stroke-opacity="0.6" stroke-width="1.5"/></g>`;
  return `
  <rect width="${AW}" height="${AH}" fill="url(#skyW)"/>
  <circle cx="${AW * 0.5}" cy="188" r="120" fill="#ff8a3a" opacity="0.28" filter="url(#fogblur)"/>
  <circle cx="${AW * 0.5}" cy="188" r="46" fill="#ffd9a0"/><circle cx="${AW * 0.5}" cy="188" r="46" fill="#ff9a3a" opacity="0.35"/>
  ${ridge(11, 196, 38, "#3a1f16", 0.9, 34)}${fog(206, "#ffb070", 0.35, 5)}
  ${ridge(23, 226, 30, "#24130d", 1, 28)}
  ${banner(62, "#8a1c1c")}${banner(AW - 114, "#8a1c1c")}
  ${axe(false)}${axe(true)}
  <g transform="translate(${AW / 2} 182) scale(0.86)"><path d="M0 -92 L64 -66 L64 10 Q64 66 0 94 Q-64 66 -64 10 L-64 -66 Z" fill="#2c2118"/><path d="M0 -92 L64 -66 L64 10 Q64 66 0 94 Q-64 66 -64 10 L-64 -66 Z" fill="url(#steel)" opacity="0.5"/>
    <path d="M0 -92 L64 -66 L64 10 Q64 66 0 94 Q-64 66 -64 10 L-64 -66 Z" fill="none" stroke="#ffd100" stroke-width="5"/>
    <path d="M0 -70 L0 76 M-46 -22 L46 -22" stroke="#ffd100" stroke-opacity="0.8" stroke-width="5"/><circle r="12" cy="-22" fill="#ffd100"/><circle r="12" cy="-22" fill="none" stroke="#000" stroke-opacity="0.45"/>
    <path d="M-60 -64 L-4 -88 L-4 -70 L-56 -48 Z" fill="#fff" opacity="0.12"/></g>
  ${fog(268, "#c9805a", 0.3, 9)}
  <rect y="262" width="${AW}" height="60" fill="#0b0705"/>
  ${shield(40, 292, 44, "#b08a3a")}${shield(118, 304, 40, "#9a7a32")}${shield(AW - 118, 304, 40, "#9a7a32")}${shield(AW - 40, 292, 44, "#b08a3a")}
  ${Array.from({ length: 7 }, (_, i) => `<path d="M${40 + i * 55} 300 L${40 + i * 55} ${222 + (i % 2) * 14}" stroke="#120b07" stroke-width="3"/><path d="M${40 + i * 55} ${214 + (i % 2) * 14} l-5 12 h10 z" fill="#120b07"/>`).join("")}
  ${particles(31, 46, { y0: 40, y1: 290, color: "#ffb050", rMax: 2.4 })}`;
}

function mageScene() {
  return `
  <rect width="${AW}" height="${AH}" fill="url(#skyM)"/>
  ${particles(5, 90, { y1: 200, color: "#dff1ff", rMin: 0.4, rMax: 1.5, glow: false })}
  <circle cx="${AW - 98}" cy="70" r="30" fill="#e8f3ff"/><circle cx="${AW - 108}" cy="62" r="27" fill="#12294a"/>
  <circle cx="${AW - 98}" cy="70" r="60" fill="#7fb6ff" opacity="0.18" filter="url(#fogblur)"/>
  ${ridge(7, 222, 52, "#0d1d38", 0.95, 30)}
  <g fill="#0a1830"><rect x="64" y="130" width="26" height="110"/><path d="M60 130 L77 88 L94 130 Z"/><rect x="90" y="160" width="20" height="80"/><path d="M88 160 L100 130 L112 160 Z"/>
  <rect x="${AW - 170}" y="150" width="30" height="100"/><path d="M${AW - 174} 150 L${AW - 155} 104 L${AW - 136} 150 Z"/></g>
  <g fill="#ffd27a" opacity="0.85"><rect x="72" y="150" width="4" height="9"/><rect x="${AW - 160}" y="170" width="4" height="9"/></g>
  ${fog(232, "#6f9fe0", 0.28, 12)}
  <circle cx="${AW / 2}" cy="182" r="96" fill="url(#orbGlow)"/>
  <g transform="translate(${AW / 2} 0)">
    <path d="M-52 300 Q-58 190 -20 116 L20 116 Q58 190 52 300 Z" fill="#1a2d52"/><path d="M20 116 Q58 190 52 300 L40 300 Q46 200 14 120 Z" fill="#7fb6ff" opacity="0.28"/><path d="M-52 300 Q-58 190 -20 116 L-8 116 Q-30 200 -30 300 Z" fill="#1b3156" opacity="0.8"/>
    <path d="M-20 116 Q0 96 20 116 L10 100 Q0 70 -10 100 Z" fill="#0e182f"/><ellipse cx="0" cy="98" rx="17" ry="20" fill="#1a2d52"/><ellipse cx="0" cy="104" rx="9" ry="10" fill="#050a14"/>
    <path d="M-17 92 Q0 66 17 92 L4 62 Q0 56 -4 62 Z" fill="#101c36"/>
    <path d="M-34 128 Q-48 170 -18 182" stroke="#14233f" stroke-width="15" fill="none" stroke-linecap="round"/><path d="M34 128 Q48 170 18 182" stroke="#14233f" stroke-width="15" fill="none" stroke-linecap="round"/>
    <path d="M-34 128 Q-48 170 -18 182" stroke="#9fd0ff" stroke-opacity="0.35" stroke-width="2" fill="none"/>
    <circle cy="182" r="30" fill="#9fe3ff" opacity="0.4" filter="url(#fogblur)"/><circle cy="182" r="17" fill="url(#orb)"/><circle cx="-5" cy="176" r="5" fill="#fff" opacity="0.9"/>
    <ellipse cy="182" rx="40" ry="11" fill="none" stroke="#bfe6ff" stroke-opacity="0.85" stroke-width="1.6" transform="rotate(-18)"/><ellipse cy="182" rx="40" ry="11" fill="none" stroke="#bfe6ff" stroke-opacity="0.5" stroke-width="1.2" transform="rotate(26)"/>
    <rect x="62" y="70" width="5" height="232" rx="2" fill="#2a1c10"/><path d="M64.5 70 L52 52 L64.5 30 L77 52 Z" fill="#9fe3ff"/><path d="M64.5 70 L52 52 L64.5 30 Z" fill="#fff" opacity="0.5"/>
    <circle cx="64.5" cy="52" r="28" fill="#7fd6ff" opacity="0.35" filter="url(#fogblur)"/>
  </g>
  ${runeRing(AW / 2, 182, 76, 10, 11, "#bfe6ff", 1.5, 0.3)}
  ${particles(41, 40, { x0: 120, x1: 290, y0: 70, y1: 270, color: "#9fe3ff", rMax: 2, opacity: 0.9 })}
  <!-- the tower window: stone arch in the foreground -->
  <path fill-rule="evenodd" fill="#0b0806" d="M0 0 H${AW} V${AH} H0 Z M26 ${AH} V120 Q26 22 ${AW / 2} 14 Q${AW - 26} 22 ${AW - 26} 120 V${AH} Z"/>
  <path d="M26 ${AH} V120 Q26 22 ${AW / 2} 14 Q${AW - 26} 22 ${AW - 26} 120 V${AH}" fill="none" stroke="#4a3b2a" stroke-width="5"/>
  <path d="M26 ${AH} V120 Q26 22 ${AW / 2} 14 Q${AW - 26} 22 ${AW - 26} 120 V${AH}" fill="none" stroke="#ffd100" stroke-opacity="0.3" stroke-width="1.5" transform="translate(5 5) scale(0.975)"/>
  <g stroke="#1d1610" stroke-width="2" opacity="0.8">${Array.from({ length: 9 }, (_, i) => `<path d="M0 ${40 + i * 34} H24 M${AW - 24} ${40 + i * 34} H${AW}"/>`).join("")}</g>
  <rect y="${AH - 18}" width="${AW}" height="18" fill="#0b0806"/>`;
}

function paladinScene() {
  const rays = Array.from({ length: 22 }, (_, i) => { const a = (i * Math.PI * 2) / 22; return `<path d="M${AW / 2} 130 L${f(AW / 2 + Math.cos(a - 0.05) * 420)} ${f(130 + Math.sin(a - 0.05) * 420)} L${f(AW / 2 + Math.cos(a + 0.05) * 420)} ${f(130 + Math.sin(a + 0.05) * 420)} Z"/>`; }).join("");
  return `
  <rect width="${AW}" height="${AH}" fill="url(#skyP)"/>
  <g fill="#ffe9a0" opacity="0.2">${rays}</g>
  <circle cx="${AW / 2}" cy="130" r="150" fill="url(#halo)"/>
  <ellipse cx="90" cy="86" rx="110" ry="22" fill="#5a2a86" opacity="0.7" filter="url(#fogblur)"/><ellipse cx="${AW - 70}" cy="60" rx="120" ry="20" fill="#7a3aa6" opacity="0.6" filter="url(#fogblur)"/>
  ${ridge(17, 226, 40, "#241038", 0.95, 32)}${fog(240, "#c58cff", 0.3, 4)}
  <g transform="translate(${AW / 2} 50)">
    <path d="M-30 120 Q-70 220 -86 304 L90 304 Q74 220 30 120 Z" fill="#2a1146"/><path d="M-30 120 Q-70 220 -86 304 L-60 304 Q-40 210 -22 126 Z" fill="#4a2278" opacity="0.8"/>
    <path d="M-20 196 L-30 304 L-6 304 L0 214 Z M20 196 L30 304 L6 304 L0 214 Z" fill="#3a3f55"/><path d="M-20 196 L-30 304 L-24 304 L-12 200 Z" fill="#8f9bc0" opacity="0.7"/>
    <path d="M-34 124 L34 124 L44 196 L-44 196 Z" fill="#4a5070"/><path d="M-34 124 L-6 124 L-14 196 L-44 196 Z" fill="#8f9bc0" opacity="0.55"/>
    <path d="M0 130 L0 192 M-26 150 H26" stroke="#ffd100" stroke-width="5"/><circle cy="150" r="6" fill="#ffd100"/>
    <ellipse cx="-40" cy="126" rx="26" ry="18" fill="#59607f"/><ellipse cx="40" cy="126" rx="26" ry="18" fill="#59607f"/><path d="M-62 120 Q-40 104 -18 122" fill="none" stroke="#ffd100" stroke-width="3"/><path d="M62 120 Q40 104 18 122" fill="none" stroke="#ffd100" stroke-width="3"/>
    <path d="M-17 92 Q0 58 17 92 L18 112 Q0 126 -18 112 Z" fill="#4a5070"/><path d="M-17 92 Q0 58 17 92 L10 70 Q0 56 -10 70 Z" fill="#8f9bc0" opacity="0.6"/>
    <rect x="-10" y="94" width="20" height="5" fill="#0a0612"/><path d="M0 56 Q26 28 36 62 Q20 58 4 66 Z" fill="#c0262d"/>
    <path d="M44 128 Q70 96 74 40" stroke="#4a5070" stroke-width="16" fill="none" stroke-linecap="round"/><path d="M44 128 Q70 96 74 40" stroke="#ffd100" stroke-opacity="0.4" stroke-width="2" fill="none"/>
    <rect x="70" y="-10" width="8" height="196" rx="3" fill="#6a4a2a"/><rect x="68" y="-2" width="12" height="190" rx="3" fill="none" stroke="#ffd100" stroke-opacity="0.35"/>
    <rect x="44" y="-30" width="62" height="44" rx="5" fill="#6d7494"/><rect x="44" y="-30" width="62" height="44" rx="5" fill="none" stroke="#ffd100" stroke-width="3"/>
    <rect x="48" y="-26" width="54" height="9" fill="#c9d0ee" opacity="0.5"/><circle cx="75" cy="-8" r="9" fill="#ffd100"/>
    <circle cx="75" cy="-8" r="44" fill="#ffe9a0" opacity="0.4" filter="url(#fogblur)"/>
    <path d="M-34 124 H-40 M-18 304 H-90" stroke="#ffd100" stroke-opacity="0.0"/>
  </g>
  <ellipse cx="${AW / 2}" cy="292" rx="150" ry="22" fill="#d9b8ff" opacity="0.35" filter="url(#fogblur)"/>
  <path d="M-10 ${AH} L-10 288 Q60 270 120 290 Q190 306 ${AW / 2} 296 Q300 286 360 290 Q420 280 ${AW + 10} 296 L${AW + 10} ${AH} Z" fill="#0d0716"/>
  ${runeRing(AW / 2, 300, 120, 9, 10, "#ffd100", 1.6, 0.1).replace(/<g /g, `<g opacity="0.7" `)}
  ${particles(51, 70, { y0: 20, y1: 300, color: "#ffe27a", rMax: 2.6 })}`;
}

const scenes = { warrior: warriorScene, mage: mageScene, paladin: paladinScene };

const defs = `
  <filter id="soft"><feGaussianBlur stdDeviation="1.1"/></filter>
  <filter id="fogblur" x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="14"/></filter>
  <filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n"/><feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.55 -0.12"/></filter>
  <filter id="paint" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.02 0.035" numOctaves="3" seed="3"/><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 0.92  0 0 0 0 0.75  0 0 0 0.55 -0.2"/></filter>
  <linearGradient id="steel" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#cfd8e8"/><stop offset="0.5" stop-color="#6f7a90"/><stop offset="1" stop-color="#2a3040"/></linearGradient>
  <linearGradient id="skyW" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a0f1a"/><stop offset="0.45" stop-color="#8a2e1a"/><stop offset="0.75" stop-color="#f08a3a"/><stop offset="1" stop-color="#3a1810"/></linearGradient>
  <linearGradient id="skyM" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050b1e"/><stop offset="0.6" stop-color="#14305e"/><stop offset="1" stop-color="#2d5a9a"/></linearGradient>
  <linearGradient id="skyP" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#150a2a"/><stop offset="0.5" stop-color="#4a1f7a"/><stop offset="1" stop-color="#a0509a"/></linearGradient>
  <radialGradient id="orb" cx="0.4" cy="0.35" r="0.7"><stop offset="0" stop-color="#ffffff"/><stop offset="0.4" stop-color="#8fe0ff"/><stop offset="1" stop-color="#1c72d8"/></radialGradient>
  <radialGradient id="orbGlow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#8fe0ff" stop-opacity="0.65"/><stop offset="1" stop-color="#8fe0ff" stop-opacity="0"/></radialGradient>
  <radialGradient id="halo" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff3b0" stop-opacity="0.95"/><stop offset="0.4" stop-color="#ffc94a" stop-opacity="0.45"/><stop offset="1" stop-color="#ffc94a" stop-opacity="0"/></radialGradient>
  <radialGradient id="vig" cx="0.5" cy="0.5" r="0.75"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.65"/></radialGradient>`;

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

async function card({ file, klass, rarity, name, type, text, flavour, number }) {
  const r = rarities[rarity];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>${defs}
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a1d10"/><stop offset="1" stop-color="${BROWN}"/></linearGradient>
    <linearGradient id="edge" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${r.edge}"/><stop offset="0.5" stop-color="${r.edge2}"/><stop offset="1" stop-color="${r.edge}"/></linearGradient>
    <filter id="blur"><feGaussianBlur stdDeviation="14"/></filter>
    <clipPath id="win"><rect x="${AX}" y="${AY}" width="${AW}" height="${AH}" rx="10"/></clipPath>
  </defs>
  ${r.glow ? `<rect x="6" y="6" width="${W - 12}" height="${H - 12}" rx="24" fill="none" stroke="${r.edge}" stroke-opacity="${r.glow}" stroke-width="10" filter="url(#blur)"/>` : ""}
  <rect x="6" y="6" width="${W - 12}" height="${H - 12}" rx="24" fill="url(#edge)"/>
  <rect x="16" y="16" width="${W - 32}" height="${H - 32}" rx="18" fill="url(#bg)"/>
  <rect x="16" y="16" width="${W - 32}" height="${H - 32}" rx="18" fill="none" stroke="${GOLD}" stroke-opacity="0.45" stroke-width="1.5"/>
  <g clip-path="url(#win)"><g transform="translate(${AX} ${AY})">
    ${scenes[klass]()}
    <rect width="${AW}" height="${AH}" filter="url(#paint)" opacity="0.5" style="mix-blend-mode:soft-light"/>
    <rect width="${AW}" height="${AH}" fill="url(#vig)"/>
    <rect width="${AW}" height="${AH}" filter="url(#grain)" opacity="0.5"/>
  </g></g>
  <rect x="${AX}" y="${AY}" width="${AW}" height="${AH}" rx="10" fill="none" stroke="${r.edge}" stroke-width="3"/>
  <rect x="${AX}" y="${AY}" width="${AW}" height="${AH}" rx="10" fill="none" stroke="#000" stroke-opacity="0.5" stroke-width="1"/>
  <path d="M26 30 H${W - 26} V74 L${W - 38} 80 H38 L26 74 Z" fill="${PANEL}" stroke="${GOLD}" stroke-opacity="0.7" stroke-width="2"/>
  <rect x="34" y="412" width="${W - 68}" height="34" rx="6" fill="${PANEL}" stroke="${r.edge}" stroke-opacity="0.8" stroke-width="1.5"/>
  <circle cx="${W - 58}" cy="429" r="9" fill="${r.gem}" stroke="${GOLD}" stroke-width="1.5"/>
  <rect x="34" y="456" width="${W - 68}" height="170" rx="8" fill="#17100a" stroke="#6b5322" stroke-width="1.5"/>
  <path d="M60 ${H - 44} H${W - 60}" stroke="${GOLD}" stroke-opacity="0.35" stroke-width="1"/>
  ${r.corners ? corner(24, 24, false, false, GOLD) + corner(W - 24, 24, true, false, GOLD) + corner(24, H - 24, false, true, GOLD) + corner(W - 24, H - 24, true, true, GOLD) : ""}
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

/** Shared by the back and the pack: a gold sunburst medallion with a rune ring and the Guilded shield. */
function medallion(cx, cy, scale = 1) {
  const rays = Array.from({ length: 24 }, (_, i) => { const a = (i * Math.PI) / 12; const r2 = i % 2 ? 128 : 150; return `<path d="M${f(Math.cos(a) * 62)} ${f(Math.sin(a) * 62)} L${f(Math.cos(a) * r2)} ${f(Math.sin(a) * r2)}" stroke-width="${i % 2 ? 2 : 4}" stroke-opacity="0.8"/>`; }).join("");
  return `<g transform="translate(${cx} ${cy}) scale(${scale})" fill="none" stroke="${GOLD}" stroke-linecap="round">
    <circle r="160" fill="url(#halo)" stroke="none" opacity="0.5"/>
    <circle r="152" stroke-width="3" stroke-opacity="0.85"/><circle r="124" stroke-width="1.5" stroke-opacity="0.6"/>${rays}
    <g stroke-opacity="0.75">${runeRing(0, 0, 138, 28, 9, GOLD, 1.5)}</g>
    <path d="M0 -62 L52 -34 L52 22 Q52 54 0 72 Q-52 54 -52 22 L-52 -34 Z" stroke-width="6" fill="#2a1d10"/><path d="M0 -62 L52 -34 L52 22 Q52 54 0 72 Q-52 54 -52 22 L-52 -34 Z" stroke="none" fill="url(#steel)" opacity="0.35"/>
    <path d="M-24 -4 L-7 14 L26 -22" stroke-width="10" stroke-linejoin="round"/></g>`;
}

async function back() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs>${defs}
  <linearGradient id="e" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd100"/><stop offset="0.5" stop-color="#8a6a2b"/><stop offset="1" stop-color="#ffd100"/></linearGradient>
  <radialGradient id="c" cx="0.5" cy="0.5" r="0.75"><stop offset="0" stop-color="#4a3418"/><stop offset="1" stop-color="${BROWN}"/></radialGradient></defs>
  <rect x="6" y="6" width="${W - 12}" height="${H - 12}" rx="24" fill="url(#e)"/>
  <rect x="16" y="16" width="${W - 32}" height="${H - 32}" rx="18" fill="url(#c)"/>
  <rect x="16" y="16" width="${W - 32}" height="${H - 32}" rx="18" filter="url(#paint)" opacity="0.35"/>
  ${medallion(W / 2, H / 2 - 16)}
  <g fill="none" stroke="${GOLD}" stroke-opacity="0.55" stroke-width="2">${[[44, 44, 1, 1], [W - 44, 44, -1, 1], [44, H - 44, 1, -1], [W - 44, H - 44, -1, -1]].map(([x, y, sx, sy]) => `<g transform="translate(${x} ${y}) scale(${sx} ${sy})"><path d="M0 40 V0 H40"/><path d="M12 30 V12 H30"/><circle cx="4" cy="4" r="4" fill="${GOLD}" stroke="none"/></g>`).join("")}</g>
  ${particles(77, 40, { x0: 30, x1: W - 30, y0: 30, y1: H - 30, color: "#ffd27a", rMax: 2 })}
  <rect x="16" y="16" width="${W - 32}" height="${H - 32}" rx="18" fill="url(#vig)"/>
  <rect x="28" y="28" width="${W - 56}" height="${H - 56}" rx="12" fill="none" stroke="${GOLD}" stroke-opacity="0.4" stroke-width="1.5" stroke-dasharray="3 7"/></svg>`;
  const l = await label(span(GOLD, "GUILDED", "bold"), 34, 300, { center: true });
  await sharp(Buffer.from(svg)).composite([{ input: l.input, left: Math.round((W - l.w) / 2), top: H - 112 }]).png().toFile(`${out}card-back.png`);
}

async function pack() {
  const PW = 360, PH = 560;
  const crimp = (top) => { let d = ""; for (let i = 0; i <= 17; i++) d += `${i === 0 ? "M" : "L"}${10 + i * 20} ${top ? (i % 2 ? 14 : 26) : PH - (i % 2 ? 14 : 26)} `; return d; };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PW}" height="${PH}"><defs>${defs}
  <linearGradient id="p" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8a6420"/><stop offset="0.45" stop-color="#3a2813"/><stop offset="1" stop-color="#150e07"/></linearGradient>
  <linearGradient id="foil" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8a6a2b"/><stop offset="0.5" stop-color="#fff0a0"/><stop offset="1" stop-color="#8a6a2b"/></linearGradient>
  <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1"><stop offset="0.3" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.22"/><stop offset="0.7" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
  <path d="${crimp(true)} L350 ${PH - 26} ${crimp(false).replace("M", "L").split(" ").reverse().join(" ")}" fill="none"/>
  <path d="M10 26 ${Array.from({ length: 17 }, (_, i) => `L${10 + (i + 1) * 20} ${i % 2 ? 26 : 14}`).join(" ")} L350 ${PH - 26} ${Array.from({ length: 17 }, (_, i) => `L${350 - (i + 1) * 20} ${i % 2 ? PH - 26 : PH - 14}`).join(" ")} Z" fill="url(#p)" stroke="url(#foil)" stroke-width="4" stroke-linejoin="round"/>
  <rect x="12" y="30" width="${PW - 24}" height="${PH - 60}" filter="url(#paint)" opacity="0.3"/>
  <rect x="30" y="60" width="${PW - 60}" height="${PH - 120}" rx="14" fill="none" stroke="${GOLD}" stroke-opacity="0.55" stroke-width="2"/>
  ${medallion(PW / 2, 262, 0.82)}
  ${particles(91, 30, { x0: 30, x1: PW - 30, y0: 70, y1: PH - 80, color: "#ffd27a", rMax: 2 })}
  <rect x="48" y="${PH - 150}" width="${PW - 96}" height="56" rx="8" fill="#120d08" stroke="${GOLD}" stroke-opacity="0.7" stroke-width="2"/>
  <path d="M10 26 ${Array.from({ length: 17 }, (_, i) => `L${10 + (i + 1) * 20} ${i % 2 ? 26 : 14}`).join(" ")} L350 ${PH - 26} L10 ${PH - 26} Z" fill="url(#sheen)"/></svg>`;
  const t1 = await label(span(GOLD, "GUILDED", "bold"), 40, 300, { center: true });
  const t2 = await label(span(PARCH, "DAILY PACK · 5 CARDS"), 17, 260, { center: true });
  await sharp(Buffer.from(svg)).composite([
    { input: t1.input, left: Math.round((PW - t1.w) / 2), top: 76 },
    { input: t2.input, left: Math.round((PW - t2.w) / 2), top: PH - 133 }
  ]).png().toFile(`${out}pack.png`);
}

await card({ file: "card-common-warrior.png", klass: "warrior", rarity: "common", name: "Warrior", type: "Class · Forever", number: "C 001/009",
  text: "Holds the line. Shows on your profile once you reach level 10 on a warrior.", flavour: "Someone has to stand in front." });
await card({ file: "card-rare-mage.png", klass: "mage", rarity: "rare", name: "Mage", type: "Class · Forever", number: "R 004/009",
  text: "Arcane focus. A Rare drop; sets up your showcase with a blue frame.", flavour: "Do not stand in the fire. Or the frost." });
await card({ file: "card-epic-paladin.png", klass: "paladin", rarity: "epic", name: "Paladin", type: "Class · Forever", number: "E 007/009",
  text: "Light made solid. An Epic drop, guaranteed within 10 packs.", flavour: "The light does not ask twice." });
await back();
await pack();
console.log("rendered into", out);
