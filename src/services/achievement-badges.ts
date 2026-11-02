import type { AchievementDef, AchievementGame, AchievementTier } from "./achievements-catalogue.js";
import { TIER_LABEL } from "./achievements-catalogue.js";

// Badge artwork for the achievements, generated as SVG from this one module (original shapes, no game
// or publisher artwork). Tier picks the frame shape and metal, the game picks the colours of the centre
// plate and glyph, and each achievement id picks a glyph. Locked badges are dark greyscale silhouettes.
// The same markup is drawn on the share card (via sharp/librsvg) and inlined on the website, so it uses
// only plain attributes: no scripts, fonts, external references or CSS.

type Lines = (n: number) => string;
const star = (cx: number, cy: number, r: number) => {
  const pts = Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + (i * Math.PI) / 5, d = i % 2 ? r * 0.45 : r; return `${(cx + d * Math.cos(a)).toFixed(1)},${(cy + d * Math.sin(a)).toFixed(1)}`; });
  return `<polygon points="${pts.join(" ")}" fill="currentColor"/>`;
};
const chevrons: Lines = n => Array.from({ length: n }, (_, i) => `<path d="M5 ${19 - i * 5}l7-5 7 5"/>`).join("");

// Glyphs on a 24x24 grid, drawn with the badge's glyph colour (currentColor).
export const GLYPHS = {
  chevron1: chevrons(1), chevron2: chevrons(2), chevron3: chevrons(3), chevron4: chevrons(4),
  star: star(12, 12.5, 10), stars: star(12, 8, 6.5) + star(6, 17, 5) + star(18, 17, 5),
  hammer: `<path d="M13 4l7 7M9 8l7 7-2.500 2.500-7-7zM11 12L4 20"/>`,
  anvil: `<path d="M3 6h17v3h-6l-2 2.500V15h3v4H8v-4h3v-3.500L8.500 9H3z"/>`,
  door: `<path d="M6 21V9a6 6 0 0 1 12 0v12zM4 21h16"/><circle cx="14.500" cy="14.500" r="1" fill="currentColor"/>`,
  key: `<circle cx="8" cy="8" r="4"/><path d="M11 11l9 9M17 17l2.500-2.500M14 14l2-2"/>`,
  torch: `<path d="M12 2c1 3.500 5 5.500 5 9a5 5 0 0 1-10 0c0-1.800 1-3 2-4 0 1.500 1 2.500 2 2.500-.5-2.500-1-4.500 1-7.500zM10 16l-1 6h6l-1-6"/>`,
  swords: `<path d="M4 4l11 11M20 4L9 15M13 17l-3 3 2 2M11 17l3 3-2 2M6 15l-3 3M18 15l3 3"/>`,
  skull: `<path d="M12 3a8 8 0 0 0-5 14.200V20h10v-2.800A8 8 0 0 0 12 3z"/><circle cx="9" cy="11" r="1.700" fill="currentColor"/><circle cx="15" cy="11" r="1.700" fill="currentColor"/><path d="M10 20v-2.500M14 20v-2.500"/>`,
  compass: `<circle cx="12" cy="12" r="9"/><path d="M16 8l-2.500 5.500L8 16l2.500-5.500z" fill="currentColor"/>`,
  banner: `<path d="M6 3v18M6 4h12l-3 4 3 4H6"/>`,
  shield: `<path d="M12 3l8 3v6c0 5-3.500 8-8 9-4.500-1-8-4-8-9V6z"/>`,
  horn: `<path d="M3 10v4h4l10 5V5L7 10zM20 9a4 4 0 0 1 0 6"/>`,
  tower: `<path d="M5 9V4h2v2h2V4h6v2h2V4h2v5zM7 9v12h10V9M10 21v-4a2 2 0 0 1 4 0v4"/>`,
  crown: `<path d="M3 18l1.500-11 5 5L12 5l2.500 7 5-5L21 18zM4 21h16"/>`,
  trophy: `<path d="M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3M12 14v4M8 21h8M10 18h4"/>`,
  sword: `<path d="M20 4L9 15M7 13l4 4M9 15l-5 5"/><path d="M20 4l-2 .5L19.500 6z" fill="currentColor"/>`,
  flame: `<path d="M12 3c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3.500 2-4.500 0 1.500 1 2.500 2 2.500-.5-3-.5-5 1-9z"/>`,
  speech: `<path d="M4 5h16v11h-9l-5 4v-4H4z"/>`,
  calendar: `<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/>`,
  heart: `<path d="M12 20S4 15 4 9.500A4.500 4.500 0 0 1 12 7a4.500 4.500 0 0 1 8 2.500C20 15 12 20 12 20z"/>`,
  gem: `<path d="M6 4h12l4 6-10 11L2 10zM2 10h20M9 4l-2 6 5 11 5-11-2-6"/>`,
  orb: `<circle cx="12" cy="12" r="8.500"/><path d="M8 10a5 5 0 0 1 4-3"/><circle cx="12" cy="12" r="2.500" fill="currentColor"/>`,
  ascend: `<path d="M12 21V5M5 12l7-7 7 7M7 21h10"/>`,
  sun: `<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>`,
  map: `<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14"/>`,
  pin: `<path d="M12 21s-6-5.500-6-11a6 6 0 0 1 12 0c0 5.500-6 11-6 11z"/><circle cx="12" cy="10" r="2" fill="currentColor"/>`
} as const;
export type GlyphName = keyof typeof GLYPHS;

/** One glyph per achievement id. The test suite requires every catalogue id to appear here. */
export const GLYPH_BY_ID: Record<string, GlyphName> = {
  "wow-level-20": "chevron1", "wow-level-40": "chevron2", "wow-level-60": "chevron3", "wow-level-80": "chevron4",
  "wow-max-level": "star", "wow-max-level-3": "stars",
  "profession-150": "hammer", "profession-300": "anvil",
  "dungeon-runs-1": "door", "dungeon-runs-10": "key", "dungeon-runs-25": "torch", "dungeon-runs-50": "swords", "dungeon-runs-100": "crown",
  "dungeon-variety-5": "compass",
  "raids-1": "banner", "raids-5": "shield", "raids-10": "horn", "raids-25": "tower", "raids-50": "trophy",
  "raid-clears-1": "sword", "raid-clears-5": "skull", "raid-clears-10": "flame",
  "active-days-7": "speech", "active-days-30": "calendar", "active-days-100": "heart",
  "poe2-level-75": "gem", "poe2-level-90": "orb", "poe2-level-99": "ascend", "poe2-level-100": "sun",
  "poe2-maps-100": "map", "poe2-maps-500": "pin"
};

// Frame outlines on a 64x64 grid, one per tier: circle, hexagon, shield, spiked star.
const spiked = Array.from({ length: 16 }, (_, i) => { const a = -Math.PI / 2 + (i * Math.PI) / 8, d = i % 2 ? 24.500 : 30.500; return `${(32 + d * Math.cos(a)).toFixed(1)},${(32 + d * Math.sin(a)).toFixed(1)}`; }).join(" ");
const hex = Array.from({ length: 6 }, (_, i) => { const a = -Math.PI / 2 + (i * Math.PI) / 3; return `${(32 + 29.500 * Math.cos(a)).toFixed(1)},${(32 + 29.500 * Math.sin(a)).toFixed(1)}`; }).join(" ");
const FRAME: Record<AchievementTier, string> = {
  bronze: `<circle cx="32" cy="32" r="29"/>`,
  silver: `<polygon points="${hex}" stroke-linejoin="round"/>`,
  gold: `<path d="M32 3l25 8v23c0 13-11 23-25 27C18 57 7 47 7 34V11z" stroke-linejoin="round"/>`,
  epic: `<polygon points="${spiked}" stroke-linejoin="round"/>`
};
// Metal gradients (top, middle, bottom) and edge colour per tier.
const METAL: Record<AchievementTier, [string, string, string, string]> = {
  bronze: ["#f0b27a", "#c0763a", "#7a4218", "#4d2810"], silver: ["#f4f7fa", "#b4bdc8", "#707b88", "#454d58"],
  gold: ["#fff3a6", "#e3ae1c", "#8a6508", "#5a4204"], epic: ["#efc0ff", "#a54be0", "#52207f", "#2e1048"]
};
// Per game: centre plate (top, bottom) and glyph colour. WoW gold on blue, guild green, PoE2 ember on dark red.
const GAME: Record<AchievementGame, { plate: [string, string]; glyph: string }> = {
  wow: { plate: ["#24518a", "#0c1c36"], glyph: "#ffd45c" }, guild: { plate: ["#1f5a34", "#0b2214"], glyph: "#8ff0a0" }, poe2: { plate: ["#661616", "#240606"], glyph: "#ff8a4a" }
};
const LOCKED = { metal: ["#4a4f58", "#33373e", "#24272c", "#181a1e"], plate: ["#16181c", "#0b0c0e"], glyph: "#5e6268" };

/** The badge's elements on a 64x64 grid (no outer svg), with ids unique to this def and state. */
export function badgeInner(def: AchievementDef, earned: boolean): string {
  const id = `ab-${def.id}-${earned ? "e" : "l"}`;
  const [m0, m1, m2, edge] = earned ? METAL[def.tier] : (LOCKED.metal as [string, string, string, string]);
  const [p0, p1] = earned ? GAME[def.game].plate : (LOCKED.plate as [string, string]);
  const glyph = earned ? GAME[def.game].glyph : LOCKED.glyph;
  const frame = FRAME[def.tier];
  const gloss = earned ? `<ellipse cx="25" cy="17" rx="13" ry="6" fill="#fff" opacity=".18" transform="rotate(-20 25 17)"/>` : "";
  const gem = def.tier === "epic" ? `<circle cx="32" cy="6.500" r="3.200" fill="${earned ? "#ff5ad0" : "#2a2d33"}" stroke="${edge}" stroke-width="1"/>` : "";
  const body = GLYPHS[GLYPH_BY_ID[def.id] ?? "star"];
  return `<defs><linearGradient id="${id}-m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${m0}"/><stop offset=".5" stop-color="${m1}"/><stop offset="1" stop-color="${m2}"/></linearGradient>`
    + `<linearGradient id="${id}-p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p0}"/><stop offset="1" stop-color="${p1}"/></linearGradient></defs>`
    + `<g fill="url(#${id}-m)" stroke="${edge}" stroke-width="2">${frame}</g>`
    + `<g transform="translate(32 32) scale(.74) translate(-32 -32)" fill="url(#${id}-p)" stroke="${edge}" stroke-width="2.500" stroke-opacity=".8">${frame}</g>`
    + gloss + gem
    + `<g transform="translate(18.200 18.800) scale(1.150)" color="${glyph}" fill="none" stroke="currentColor" stroke-width="1.900" stroke-linecap="round" stroke-linejoin="round"${earned ? "" : ` opacity=".7"`}>${body}</g>`;
}

/**
 * A standalone badge. With `label` it is an image with that accessible name; without, it is decorative
 * (aria-hidden), for lists that already carry the name and status in text.
 */
export function badgeSvg(def: AchievementDef, earned: boolean, options: { size?: number; label?: string } = {}): string {
  const size = options.size ?? 64;
  const name = options.label === undefined ? ` aria-hidden="true" focusable="false"` : ` role="img" aria-label="${escapeAttr(options.label)}"`;
  const title = options.label === undefined ? "" : `<title>${escapeAttr(options.label)}</title>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}"${name}>${title}${badgeInner(def, earned)}</svg>`;
}

/** Accessible name in both languages, e.g. "Dungeon Regular: Bronze, unlocked". */
export function badgeLabel(def: AchievementDef, earned: boolean, lang: "en" | "fr"): string {
  return `${def[lang].name}: ${TIER_LABEL[def.tier][lang]}, ${earned ? (lang === "fr" ? "débloqué" : "unlocked") : (lang === "fr" ? "verrouillé" : "locked")}`;
}

function escapeAttr(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
